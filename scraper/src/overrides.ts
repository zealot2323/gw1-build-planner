/**
 * Manual data corrections, applied by parse.ts on top of what the wiki
 * parsers produce. Each entry documents WHY it exists — keep it that way.
 */

/** Wiki typos/variants -> canonical location page name. */
export const LOCATION_ALIASES: Record<string, string> = {
  // Trainer list page heading says "Fisherman's Haven"; the location page
  // (next to Stingray Strand) is "Fishermen's Haven".
  "Fisherman's Haven": "Fishermen's Haven",
};

/**
 * Pages that are not actual planner locations despite appearing in the
 * wiki's location lists. Dropped from the dataset AND silently removed from
 * neighbor lists.
 */
export const EXCLUDED_LOCATIONS = new Set<string>([
  "Lion's Gate", // not an explorable zone
  "Ascalon Academy", // pre-Searing event area, not a planner location
]);

/**
 * Progression-gated connections the wiki doesn't express as exits: you can
 * only reach these outposts by completing the listed mission. Modeled as
 * extra neighbor edges. (Ring of Fire itself additionally requires the
 * Final Blow quest — quest gating is not modeled yet.)
 */
export const EXTRA_NEIGHBORS: Record<string, string[]> = {
  "Abaddon's Mouth (outpost)": ["Ring of Fire (outpost)"],
  "Hell's Precipice (outpost)": ["Abaddon's Mouth (outpost)"],
};

/**
 * Skills a trainer verifiably sells that are missing from their wiki
 * /Skills subpage. Trainer lists are the source of truth for skill
 * acquisition, so corrections belong here, on the trainer.
 */
export const TRAINER_EXTRA_SKILLS: Record<string, string[]> = {
  // Restore Life's own page (correctly) lists Captain Osric; his subpage
  // omits it.
  "Captain Osric": ["Restore Life"],
};

/** "(monster skill)" variant pages are not learnable player skills. */
export const isExcludedSkillPage = (title: string): boolean => / \(monster skill\)$/.test(title);

/**
 * Monsters whose infobox level has no hard-mode value in parentheses are
 * pre-Searing creatures — pre-Searing is out of scope for now.
 */
export const isPreSearingMonster = (levelRaw: string | undefined): boolean =>
  levelRaw !== undefined && !levelRaw.includes("(");
