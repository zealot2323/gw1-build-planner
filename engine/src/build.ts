/**
 * Build validation. Pure — no I/O.
 */
import type { DataIndex } from "./data.js";
import type { Build, SkillRef } from "./types.js";

export type BuildErrorCode =
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
      message: `Your secondary can't also be ${build.primary} — that's your primary profession.`,
      fix: "Pick a different secondary, or set it to none.",
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
        message: `${ref} is in slot ${firstSlot + 1} already.`,
        fix: `Remove one of them — a skill can only be equipped once.`,
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
        message: `${ref} isn't in the Prophecies skill list.`,
        fix: "It may be a Factions/Nightfall skill or a monster-only skill.",
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
          message: `You can only equip one elite skill, and ${ref} is a second one.`,
          fix: "Drop one of the elites (marked ★).",
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
            ? `${ref} is a ${skill.profession} skill, but this build is ${build.primary} with no secondary.`
            : `${ref} is a ${skill.profession} skill, which a ${build.primary}/${build.secondary} can't use.`,
        fix:
          build.secondary === null
            ? `Set your secondary to ${skill.profession} to use it.`
            : `Either switch your secondary to ${skill.profession}, or remove the skill.`,
        slot,
        skill: ref,
      });
    }
  });

  return errors;
}
