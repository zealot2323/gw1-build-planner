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
  message: string;
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
      message: `secondary profession cannot equal primary (${build.primary})`,
    });
  }

  if (!Array.isArray(build.skills) || build.skills.length !== 8) {
    errors.push({
      code: "WRONG_SLOT_COUNT",
      message: `a build has exactly 8 slots, got ${Array.isArray(build.skills) ? build.skills.length : "none"}`,
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
        message: `"${ref}" appears in slots ${firstSlot + 1} and ${slot + 1}`,
        slot,
        skill: ref,
      });
    } else {
      seen.set(ref, slot);
    }

    const skill = index.skillByPage.get(ref);
    if (!skill) {
      errors.push({ code: "UNKNOWN_SKILL", message: `"${ref}" is not in the dataset`, slot, skill: ref });
      return;
    }
    if (skill.isElite && firstSlot === undefined) {
      elites++;
      if (elites === 2) {
        errors.push({ code: "TOO_MANY_ELITES", message: "a build may contain at most 1 elite skill", slot, skill: ref });
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
        message: `"${ref}" is a ${skill.profession} skill; build is ${build.primary}/${build.secondary ?? "none"}`,
        slot,
        skill: ref,
      });
    }
  });

  return errors;
}
