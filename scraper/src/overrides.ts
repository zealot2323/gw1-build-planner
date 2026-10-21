/**
 * Manual data corrections, applied by parse.ts on top of what the wiki
 * parsers produce. Each entry documents WHY it exists — keep it that way.
 */
import type { LocationGate } from "@gw1/engine";

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
  "Rollerbeetle Racing (outpost)", // festival minigame, not a PvE outpost
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
  // The three continents are joined only by the ferries between their
  // capitals. Without these the campaigns are disconnected islands and
  // travel distance reports "no route" for anything abroad. They only
  // matter for characters who own more than one campaign — the dataset is
  // scoped per character, so a Tyrian never sees the far end anyway.
  "Lion's Arch": ["Kaineng Center", "Kamadan, Jewel of Istan"],
  "Kaineng Center": ["Lion's Arch", "Kamadan, Jewel of Istan"],
  "Kamadan, Jewel of Istan": ["Lion's Arch", "Kaineng Center"],
  // Eye of the North is entered from each campaign through its own portal
  // and everyone arrives at Boreal Station, so it hangs off all three
  // capitals. Only reachable for characters who own the expansion — the
  // dataset is scoped per character, so the edge is inert otherwise.
  "Boreal Station": ["Lion's Arch", "Kaineng Center", "Kamadan, Jewel of Istan"],
};

/**
 * Explorable areas next to an outpost that the outpost does NOT open by
 * itself. Without these, standing in the outpost counted the area as
 * "reachable now", so its bosses read as capturable and its quests as
 * available. Only explorables are listed: outposts and missions are
 * settled by the character's own unlocks. Each note follows the wiki.
 *
 * Mission gates are checked against completed missions. Quest completion
 * is not tracked (GWToolbox does not record it), so a quest-gated area
 * counts as open once the character has been in it — the completion file
 * does record every explorable area entered.
 */
export const AREA_GATES: Record<string, LocationGate> = {
  // "The only way to reach this explorable area is to speak to Guard Lae
  // Fao in Seitung Harbor, after completing the Zen Daijun mission."
  "Zen Daijun (explorable area)": {
    missions: ["Zen Daijun"],
    note: "Opens after the Zen Daijun mission",
  },
  // "only accessible after completion of the Raisu Palace mission"
  "Raisu Palace (explorable area)": {
    missions: ["Raisu Palace"],
    note: "Opens after the Raisu Palace mission",
  },
  // "The character must have completed either the Dasha Vestibule mission
  // or the Dzagonur Bastion mission."
  "The Hidden City of Ahdashim": {
    missions: ["Dasha Vestibule", "Dzagonur Bastion"],
    note: "Opens after the Dasha Vestibule or Dzagonur Bastion mission",
  },
  // "Completion of Grand Court of Sebelkeh opens access to this area, but
  // only until the completion of Abaddon's Gate." The closing half is not
  // modelled.
  "Nightfallen Garden": {
    missions: ["Grand Court of Sebelkeh"],
    note: "Opens after the Grand Court of Sebelkeh mission",
  },
  // "only accessible after completing the primary quest Hunted!" — and it
  // borders five areas, so without this it looked open from all of them.
  "Command Post": {
    quest: "Hunted!",
    note: "Opens after the quest Hunted!",
  },
};

/**
 * Where a character from ANOTHER campaign starts a campaign's story. A
 * Tyrian or Elonian who takes the ferry to Kaineng Center never sees Shing
 * Jea Island: "Welcome to Cantha" sends them through Bukdek Byway into
 * Vizunah Square (Foreign Quarter), and the story runs on from there. The
 * Foreign Quarter is closed to Canthan characters until after Nahpui
 * Quarter, so it is only linked to the mission for foreign characters.
 * Prophecies and Nightfall outposts can be walked to, so they need none.
 */
export const FOREIGN_MISSION_OUTPOSTS: Record<string, string> = {
  "Vizunah Square": "Vizunah Square (Foreign Quarter)",
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

/**
 * Pages that sit in the skill categories but are not learnable skills:
 * "(monster skill)" variants, and subpages such as "<Skill>/Skill history"
 * (which carry the parent's id and would collide with it).
 */
export const isExcludedSkillPage = (title: string): boolean =>
  / \(monster skill\)$/.test(title) ||
  // Spirit attacks, e.g. "Bloodsong (attack)". Not always the last
  // disambiguator: "Pain (attack) (Signet of Spirits)" has a second one, and
  // with no profession it leaked in as a common skill named "Pain" that
  // every build could slot.
  / \(attack\)( |$)/.test(title) ||
  title.includes("/");

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
