/**
 * Per-campaign wiki entry points. Every campaign follows the same page
 * layout — a skills category, blocks in the Town/Outpost templates, an
 * explorables subpage, a trainer list and a mission list — so discovery is
 * the same routine with different names.
 */
export type CampaignName = "Prophecies" | "Factions" | "Nightfall" | "Eye of the North";

export interface CampaignConfig {
  name: CampaignName;
  /** Label used inside the Town / Outposts-by-continent templates. */
  templateBlock: string;
  /**
   * Professions a character created in this campaign can be. NOT the set
   * used to enumerate skills: later campaigns add skills for earlier
   * campaigns' professions (Nightfall ships Assassin and Ritualist skills),
   * so discovery walks all ten regardless.
   */
  professions: string[];
  /** "Guild Wars <X>/Explorable areas" — the transcluded region table. */
  explorablesPage: string;
  trainerListPage: string;
  /**
   * null for Eye of the North: it has no numbered missions, only dungeons
   * and storyline quests, so there is no mission list to parse.
   */
  missionListPage: string | null;
  /** Regions to skip on the explorables page (PvP / cross-campaign areas). */
  excludeRegions: string[];
  /**
   * Categories of learnable skills that sit outside every profession tree.
   * Eye of the North's PvE-only skills have no profession at all — they are
   * gated on title rank instead — so the profession walk cannot see them.
   * These are the categories the wiki's own list page queries.
   */
  extraSkillCategories?: string[];
  /** Rough per-profession skill count, for the discovery sanity check. */
  expectedPerProfession: [min: number, max: number];
  /**
   * Expected total unique skill pages (campaign + core). A ratio against
   * the raw category does not work: Eye of the North's category is mostly
   * dungeon environment effects, Norn brawling moves and quest siege
   * skills, so only ~40% of it is learnable — which is correct, not a bug.
   */
  expectedSkillTotal: [min: number, max: number];
  /**
   * Page listing this campaign's instanced content when it isn't missions.
   * Eye of the North has 18 dungeons instead, in a sortable table.
   */
  dungeonListPage?: string;
  /**
   * An expansion rather than a campaign: no characters start here, so it
   * never appears as a character's home campaign — only as one they own.
   */
  expansion?: boolean;
}

const CORE = ["Warrior", "Ranger", "Monk", "Necromancer", "Mesmer", "Elementalist"];

export const CAMPAIGNS: CampaignConfig[] = [
  {
    name: "Prophecies",
    templateBlock: "Prophecies",
    professions: CORE,
    explorablesPage: "Guild Wars Prophecies/Explorable areas",
    trainerListPage: "List of Prophecies skill trainers",
    missionListPage: "List of Prophecies missions and primary quests",
    excludeRegions: ["The Mists"],
    expectedPerProfession: [70, 85],
    expectedSkillTotal: [420, 520],
  },
  {
    name: "Factions",
    templateBlock: "Factions",
    professions: [...CORE, "Assassin", "Ritualist"],
    explorablesPage: "Guild Wars Factions/Explorable areas",
    trainerListPage: "List of Factions skill trainers",
    missionListPage: "List of Factions missions and primary quests",
    excludeRegions: [],
    expectedPerProfession: [40, 110],
    expectedSkillTotal: [560, 680],
  },
  {
    name: "Nightfall",
    templateBlock: "Nightfall",
    professions: [...CORE, "Paragon", "Dervish"],
    explorablesPage: "Guild Wars Nightfall/Explorable areas",
    trainerListPage: "List of Nightfall skill trainers",
    missionListPage: "List of Nightfall missions and primary quests",
    excludeRegions: [],
    expectedPerProfession: [40, 110],
    expectedSkillTotal: [560, 700],
  },
  {
    name: "Eye of the North",
    templateBlock: "Eye of the North",
    // an expansion: any profession can play it, and its skills are PvE-only
    professions: [...CORE, "Assassin", "Ritualist", "Paragon", "Dervish"],
    explorablesPage: "Guild Wars Eye of the North/Explorable areas",
    trainerListPage: "List of Eye of the North skill trainers",
    missionListPage: null,
    extraSkillCategories: [
      "Asura rank skills",
      "Deldrimor rank skills",
      "Ebon Vanguard rank skills",
      "Norn rank skills",
    ],
    dungeonListPage: "Dungeon",
    expansion: true,
    excludeRegions: [],
    expectedPerProfession: [10, 90],
    expectedSkillTotal: [380, 470],
  },
];

export const campaignByName = (name: string): CampaignConfig | undefined =>
  CAMPAIGNS.find((c) => c.name === name);
