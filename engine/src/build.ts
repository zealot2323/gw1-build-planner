/**
 * Build validation. Pure — no I/O.
 */
import {
  ATTRIBUTE_POINTS_AT_20,
  attributesForBuild,
  MAX_RANK_FROM_POINTS,
  MAX_RANK_WITH_GEAR,
  pointsSpent,
  primaryAttributeOf,
} from "./attributes.js";
import { skillAvailability, type SkillAvailabilityEntry } from "./availability.js";
import type { DataIndex } from "./data.js";
import { planForSkill, type SkillPlan, type TravelGraph } from "./travel.js";
import type { Build, Character, Skill, SkillRef } from "./types.js";

export type BuildErrorCode =
  | "ATTRIBUTE_NOT_AVAILABLE"
  | "ATTRIBUTE_RANK_TOO_HIGH"
  | "ATTRIBUTE_POINTS_OVERSPENT"
  | "WRONG_SLOT_COUNT"
  | "TOO_MANY_ELITES"
  | "DUPLICATE_SKILL"
  | "ILLEGAL_PROFESSION"
  | "UNKNOWN_SKILL"
  | "PRIMARY_EQUALS_SECONDARY";

export interface BuildError {
  code: BuildErrorCode;
  /** Plain-language explanation, written for a player not a developer. */
  message: string;
  /** What to do about it, when there's an obvious fix. */
  fix?: string;
  /** 0-based slot index, where the error is tied to one slot. */
  slot?: number;
  skill?: SkillRef;
}

/**
 * A build is exactly 8 slots (nullable), at most 1 elite, no duplicates,
 * and every skill must belong to the primary, the selected secondary, or be
 * a no-profession/common skill. The primary can never equal the secondary.
 */
export function validateBuild(build: Build, index: DataIndex): BuildError[] {
  const errors: BuildError[] = [];

  if (build.secondary !== null && build.secondary === build.primary) {
    errors.push({
      code: "PRIMARY_EQUALS_SECONDARY",
      message: `${build.primary} is this character's primary profession, so it can't also be the secondary.`,
      fix: "Choose a different secondary profession, or set it to none.",
    });
  }

  if (!Array.isArray(build.skills) || build.skills.length !== 8) {
    errors.push({
      code: "WRONG_SLOT_COUNT",
      message: `A build needs exactly 8 slots, but this one has ${
        Array.isArray(build.skills) ? build.skills.length : "none"
      }.`,
    });
    return errors; // slot-indexed checks below assume 8 slots
  }

  const seen = new Map<SkillRef, number>();
  let elites = 0;
  build.skills.forEach((ref, slot) => {
    if (ref === null) return;

    const firstSlot = seen.get(ref);
    if (firstSlot !== undefined) {
      errors.push({
        code: "DUPLICATE_SKILL",
        message: `${ref} is already in slot ${firstSlot + 1}.`,
        fix: "Remove one copy. A skill can only be equipped once.",
        slot,
        skill: ref,
      });
    } else {
      seen.set(ref, slot);
    }

    const skill = index.skillByPage.get(ref);
    if (!skill) {
      errors.push({
        code: "UNKNOWN_SKILL",
        message: `${ref} isn't in this planner's skill data.`,
        fix: "It may be a PvP-only version, a monster skill, or newer than the last data update.",
        slot,
        skill: ref,
      });
      return;
    }
    if (skill.isElite && firstSlot === undefined) {
      elites++;
      if (elites === 2) {
        errors.push({
          code: "TOO_MANY_ELITES",
          message: `A build can include only one elite skill, and ${ref} is a second.`,
          fix: "Remove one of the elite skills (marked ★).",
          slot,
          skill: ref,
        });
      }
    }
    if (
      skill.profession !== null &&
      skill.profession !== undefined &&
      skill.profession !== build.primary &&
      skill.profession !== build.secondary
    ) {
      errors.push({
        code: "ILLEGAL_PROFESSION",
        message:
          build.secondary === null
            ? `${ref} is a ${skill.profession} skill, and this build has no secondary profession.`
            : `${ref} is a ${skill.profession} skill, which a ${build.primary}/${build.secondary} cannot use.`,
        fix:
          build.secondary === null
            ? `Set the secondary profession to ${skill.profession}, or remove the skill.`
            : `Change the secondary profession to ${skill.profession}, or remove the skill.`,
        slot,
        skill: ref,
      });
    }
  });

  // --- attributes ---
  const attributes = build.attributes ?? {};
  const allowed = new Set(attributesForBuild(build));
  for (const [attribute, rank] of Object.entries(attributes)) {
    if (rank <= 0) continue;
    if (!allowed.has(attribute)) {
      // The commonest case is the secondary's own primary attribute, which
      // belongs to that profession's primaries only.
      const secondaryPrimary =
        build.secondary !== null && primaryAttributeOf(build.secondary) === attribute;
      errors.push({
        code: "ATTRIBUTE_NOT_AVAILABLE",
        message: secondaryPrimary
          ? `${attribute} is ${build.secondary}'s primary attribute, so only a ${build.secondary} primary can use it.`
          : `${attribute} doesn't belong to ${build.primary}${build.secondary ? `/${build.secondary}` : ""}.`,
        fix: `Set ${attribute} back to 0.`,
      });
    }
    // 13-16 is a normal gear-boosted rank, which build sites quote; only
    // above 16 is unreachable.
    if (rank > MAX_RANK_WITH_GEAR) {
      errors.push({
        code: "ATTRIBUTE_RANK_TOO_HIGH",
        message: `${attribute} is at ${rank}. The highest reachable rank is ${MAX_RANK_WITH_GEAR} — ${MAX_RANK_FROM_POINTS} from attribute points, plus headgear and a superior rune.`,
        fix: `Lower it to ${MAX_RANK_WITH_GEAR} or less.`,
      });
    }
  }
  const spent = pointsSpent(attributes);
  if (spent > ATTRIBUTE_POINTS_AT_20) {
    errors.push({
      code: "ATTRIBUTE_POINTS_OVERSPENT",
      message: `This spread costs ${spent} attribute points. A level 20 character has ${ATTRIBUTE_POINTS_AT_20}.`,
      fix: `Reduce a rank to free up ${spent - ATTRIBUTE_POINTS_AT_20} point(s).`,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Readiness: can this character actually run this build yet?
// ---------------------------------------------------------------------------

/** One slot of a build, as it stands for a particular character. */
export interface BuildSlot {
  skill: Skill | null;
  /** The slot names a skill the dataset doesn't have (or is empty). */
  ref: SkillRef | null;
  known: boolean;
  /** Availability for this character, absent when the skill is unknown to us. */
  entry?: SkillAvailabilityEntry;
  plan?: SkillPlan;
}

export interface BuildReadiness {
  slots: BuildSlot[];
  filled: number;
  known: number;
  /** Slots the character still has to go and get, nearest first. */
  missing: BuildSlot[];
  ready: boolean;
  errors: BuildError[];
}

/**
 * What stands between this character and running this build: which slots
 * they already know, and for the rest, how they'd get each one.
 *
 * The build's own secondary decides which skills are usable, so availability
 * is computed against it rather than the character's whole unlocked set.
 */
export function buildReadiness(
  build: Build,
  character: Character,
  index: DataIndex,
  graph?: TravelGraph,
): BuildReadiness {
  const availability = new Map(
    skillAvailability(character, build.secondary, index).map((e) => [e.skill.wikiPage, e]),
  );
  const known = new Set(character.knownSkills);

  const slots: BuildSlot[] = build.skills.map((ref) => {
    if (ref === null) return { skill: null, ref: null, known: false };
    const skill = index.skillByPage.get(ref) ?? null;
    const entry = availability.get(ref);
    return {
      skill,
      ref,
      known: known.has(ref),
      entry,
      plan: entry && graph ? planForSkill(entry, graph) : undefined,
    };
  });

  const filled = slots.filter((s) => s.ref !== null).length;
  const missing = slots
    .filter((s) => s.ref !== null && !s.known)
    .sort((a, b) => (a.plan?.distance ?? Infinity) - (b.plan?.distance ?? Infinity));

  return {
    slots,
    filled,
    known: slots.filter((s) => s.known).length,
    missing,
    ready: filled > 0 && missing.length === 0,
    errors: validateBuild(build, index),
  };
}
