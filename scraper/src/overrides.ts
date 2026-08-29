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
  // PvP arenas: outposts you only enter to fight other players, with no
  // explorables, trainers, or PvE content behind them.
  "Ascalon Arena (outpost)",
  "Shiverpeak Arena (outpost)",
  // April Fools event zone (2010): a joke re-run of pre-Searing Lakeside
  // County with inflated levels. Not real content.
  "Lakeside County: 1070 AE",
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
 * usually pre-Searing creatures — pre-Searing is out of scope for now.
 * The level cap guards against false positives: some high-level boss pages
 * also omit the hard-mode level (e.g. Pell Glitterglatter "24, 28"), and
 * nothing in pre-Searing exceeds ~12.
 */
export const isPreSearingMonster = (levelRaw: string | undefined, level: number | null): boolean =>
  levelRaw !== undefined && !levelRaw.includes("(") && (level ?? 0) <= 12;

/**
 * Pre-Searing Ascalon locations. The wiki lists them in separate
 * ":''pre-Searing''" blocks that the discovery job flattens, and the names
 * alone don't always say (Lakeside County, The Catacombs). Ascalon is the
 * only region with both halves, so the app can offer a toggle.
 */
export const PRE_SEARING_LOCATIONS = new Set<string>([
  "Ascalon City (pre-Searing)",
  "Ashford Abbey",
  "Foible's Fair",
  "Fort Ranik (pre-Searing)",
  "The Barradin Estate",
  "Piken Square (pre-Searing)",
  "Green Hills County",
  "Lakeside County",
  "Regent Valley (pre-Searing)",
  "The Catacombs",
  "The Northlands",
  "Wizard's Folly",
]);

/**
 * Locations discovery skips but that are still reachable in Prophecies.
 * The Mists column of the wiki's explorable list is excluded wholesale
 * (PvP/core areas), but The Underworld is entered from Tomb of the Primeval
 * Kings and is ordinary PvE, so it earns a place.
 */
export const EXTRA_EXPLORABLES = ["The Underworld (explorable area)"];
