/**
 * Core domain types + JSON Schemas for the GW1 build planner.
 *
 * All cross-entity references are by wiki page name (the stable key),
 * e.g. "Healing Breeze", "Yak's Bend".
 *
 * Scope: Prophecies campaign, normal mode only. Skill state is modeled at
 * character level; account-wide unlocks are out of scope for the PoC.
 */

// ---------------------------------------------------------------------------
// Refs — all by wiki page name
// ---------------------------------------------------------------------------

export type SkillRef = string;
export type LocationRef = string;
export type TrainerRef = string;
export type QuestRef = string;
export type BossRef = string;
export type MonsterRef = string;
export type MissionRef = string;

// ---------------------------------------------------------------------------
// Professions
// ---------------------------------------------------------------------------

/** The 6 core + 4 expansion professions. */
export enum Profession {
  Warrior = "Warrior",
  Ranger = "Ranger",
  Monk = "Monk",
  Necromancer = "Necromancer",
  Mesmer = "Mesmer",
  Elementalist = "Elementalist",
  Assassin = "Assassin",
  Ritualist = "Ritualist",
  Paragon = "Paragon",
  Dervish = "Dervish",
}

export const PROFESSIONS: readonly Profession[] = Object.values(Profession);

export type Campaign = "Prophecies" | "Factions" | "Nightfall" | "Eye of the North" | "Core";

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export interface SkillAcquisition {
  trainers: TrainerRef[];
  quests: QuestRef[];
  /** Bosses the skill can be captured from (Signet of Capture) that always spawn. */
  captureBosses: BossRef[];
  /** Capture bosses that only spawn during a quest/event (gating not modeled yet). */
  conditionalCaptureBosses?: BossRef[];
  /** Where each quest is given, per the wiki acquisition line. */
  questLocations?: Record<QuestRef, LocationRef | null>;
  /** Where each capture boss spawns, per the wiki acquisition line. */
  captureLocations?: Record<BossRef, LocationRef | null>;
}

export interface Skill {
  name: string;
  wikiPage: string;
  /** Numeric in-game skill id from the wiki infobox — needed for template codes. */
  gwSkillId: number;
  /** null = no-profession / common skill. */
  profession: Profession | null;
  /** null = unlinked (no attribute). */
  attribute: string | null;
  isElite: boolean;
  campaign: Campaign | null;
  /** Energy cost; null when the skill costs adrenaline instead. */
  energyCost: number | null;
  /** Adrenaline cost in strikes; null for energy skills. */
  adrenalineCost: number | null;
  /** Health sacrificed to cast, as a percent (Blood Magic and friends). */
  sacrificePercent?: number | null;
  /** Energy degeneration while maintained ("upkeep"), in pips. */
  upkeep?: number | null;
  /** Activation time in seconds (0 = instant, null = weapon-speed attack). */
  activation: number | null;
  /** Recharge time in seconds. */
  recharge: number;
  description: string;
  acquisition: SkillAcquisition;
}

// ---------------------------------------------------------------------------
// Locations, trainers, monsters, missions
// ---------------------------------------------------------------------------

export type LocationKind = "town" | "outpost" | "mission-outpost" | "explorable";

export interface Location {
  kind: LocationKind;
  name: string;
  wikiPage: string;
  campaign: Campaign | null;
  region: string | null;
  /** Exits / connected areas. */
  neighbors: LocationRef[];
  /** Skill trainer stationed here, if any (towns/outposts). */
  trainer?: TrainerRef;
  /** Monsters found here (explorables/missions). */
  foes: MonsterRef[];
  /** Bosses found here (subset context from the wiki's Bosses sections). */
  bosses?: MonsterRef[];
  /** Pre-Searing Ascalon — the region has both halves, so views can split them. */
  preSearing?: boolean;
}

export interface Trainer {
  name: string;
  wikiPage: string;
  location: LocationRef;
  skillsOffered: SkillRef[];
}

/**
 * One row of a monster's armor table. Some wiki pages break armor out by
 * damage type, so we keep the raw table as structured data.
 */
export interface ArmorEntry {
  /** e.g. "base", "Slashing damage", "Fire damage". */
  damageType: string;
  rating: number;
}

/**
 * One stat/skill block from a monster page. Creatures listed with several
 * blocks (by encounter level, by zone, or by loadout) get one variant each;
 * `variantForLocation` picks the one that applies in a given place.
 */
export interface MonsterVariant {
  /** Block label as written on the wiki; null for an unlabelled block. */
  label: string | null;
  /** Levels named by the label, e.g. "Level 4, 5, 10, 12" -> [4,5,10,12]. */
  levels: number[];
  /** Normal-mode skill bar. */
  skills: SkillRef[];
  /** Skills this creature only has in hard mode. */
  hardModeSkills?: SkillRef[];
  eliteSkill?: SkillRef;
  hardModeEliteSkill?: SkillRef;
  /** The whole block is hard-mode content (e.g. "During Hard mode Titan quests"). */
  hardMode?: boolean;
}

export interface Monster {
  name: string;
  wikiPage: string;
  species: string;
  /** Highest normal-mode level; null when unparseable. */
  level: number | null;
  /** Raw level string from the infobox, e.g. "7, 9 (23)". */
  levelRaw?: string;
  /** Hard-mode level — the parenthesized infobox value. */
  levelHard?: number | null;
  /** Base armor rating (normal mode); most pages only give the per-damage-type table. */
  armor: number | null;
  /** Raw armor table from the wiki, kept structured (may break out by damage type). */
  armorTable: ArmorEntry[];
  skills: SkillRef[];
  isBoss: boolean;
  /** The elite this boss can be captured for, if any. */
  bossElite?: SkillRef;
  locations: LocationRef[];
  profession?: Profession | null;
  /** Infobox "affiliation": faction / creature type ("Undead", "Titans"). */
  affiliation?: string | null;
  /** Present only when the wiki page splits skills into more than one block. */
  variants?: MonsterVariant[];
  /** Encounter level per location, from the wiki's "(level N)" annotations. */
  locationLevels?: Record<LocationRef, number>;
}

export interface Mission {
  name: string;
  wikiPage: string;
  /** The mission outpost the mission starts from. */
  outpost: LocationRef;
  region?: string | null;
  foes: MonsterRef[];
  bosses: MonsterRef[];
}

// ---------------------------------------------------------------------------
// Character & Build
// ---------------------------------------------------------------------------

/** Manual-entry save format for a character's progression state. */
export interface Character {
  name: string;
  primaryProfession: Profession;
  /** Must never include primaryProfession (enforced in logic, not schema). */
  unlockedSecondaries: Profession[];
  knownSkills: SkillRef[];
  unlockedLocations: LocationRef[];
  completedMissions: MissionRef[];
}

/**
 * A build: exactly 8 slots (null = empty), at most 1 elite, and every skill
 * must belong to primary, selected secondary, or be a common skill
 * (enforced in logic, not schema).
 */
export interface Build {
  name: string;
  /** Owning character's name. */
  character: string;
  primary: Profession;
  secondary: Profession | null;
  /** Exactly 8 entries; null = empty slot. */
  skills: [
    SkillRef | null, SkillRef | null, SkillRef | null, SkillRef | null,
    SkillRef | null, SkillRef | null, SkillRef | null, SkillRef | null,
  ];
}

// ---------------------------------------------------------------------------
// JSON Schemas (draft-07, Ajv-compatible)
// ---------------------------------------------------------------------------

const refArray = { type: "array", items: { type: "string" } } as const;

export const professionSchema = {
  $id: "gw1-profession",
  type: "string",
  enum: PROFESSIONS,
} as const;

export const campaignSchema = {
  $id: "gw1-campaign",
  type: "string",
  enum: ["Prophecies", "Factions", "Nightfall", "Eye of the North", "Core"],
} as const;

export const skillSchema = {
  $id: "gw1-skill",
  type: "object",
  additionalProperties: false,
  required: [
    "name", "wikiPage", "gwSkillId", "profession", "attribute", "isElite",
    "campaign", "energyCost", "adrenalineCost", "activation", "recharge",
    "description", "acquisition",
  ],
  properties: {
    name: { type: "string" },
    wikiPage: { type: "string" },
    gwSkillId: { type: "integer", minimum: 0 },
    profession: { oneOf: [{ $ref: "gw1-profession" }, { type: "null" }] },
    attribute: { type: ["string", "null"] },
    isElite: { type: "boolean" },
    campaign: { oneOf: [{ $ref: "gw1-campaign" }, { type: "null" }] },
    energyCost: { type: ["number", "null"], minimum: 0 },
    adrenalineCost: { type: ["number", "null"], minimum: 0 },
    sacrificePercent: { type: ["number", "null"], minimum: 0 },
    upkeep: { type: ["number", "null"] },
    activation: { type: ["number", "null"], minimum: 0 },
    recharge: { type: "number", minimum: 0 },
    description: { type: "string" },
    acquisition: {
      type: "object",
      additionalProperties: false,
      required: ["trainers", "quests", "captureBosses"],
      properties: {
        trainers: refArray,
        quests: refArray,
        captureBosses: refArray,
        conditionalCaptureBosses: refArray,
        questLocations: { type: "object", additionalProperties: { type: ["string", "null"] } },
        captureLocations: { type: "object", additionalProperties: { type: ["string", "null"] } },
      },
    },
  },
} as const;

export const locationSchema = {
  $id: "gw1-location",
  type: "object",
  additionalProperties: false,
  required: ["kind", "name", "wikiPage", "campaign", "region", "neighbors", "foes"],
  properties: {
    kind: { type: "string", enum: ["town", "outpost", "mission-outpost", "explorable"] },
    name: { type: "string" },
    wikiPage: { type: "string" },
    campaign: { oneOf: [{ $ref: "gw1-campaign" }, { type: "null" }] },
    region: { type: ["string", "null"] },
    neighbors: refArray,
    trainer: { type: "string" },
    foes: refArray,
    bosses: refArray,
    preSearing: { type: "boolean" },
  },
} as const;

export const trainerSchema = {
  $id: "gw1-trainer",
  type: "object",
  additionalProperties: false,
  required: ["name", "wikiPage", "location", "skillsOffered"],
  properties: {
    name: { type: "string" },
    wikiPage: { type: "string" },
    location: { type: "string" },
    skillsOffered: refArray,
  },
} as const;

export const monsterSchema = {
  $id: "gw1-monster",
  type: "object",
  additionalProperties: false,
  required: [
    "name", "wikiPage", "species", "level", "armor", "armorTable",
    "skills", "isBoss", "locations",
  ],
  properties: {
    name: { type: "string" },
    wikiPage: { type: "string" },
    species: { type: "string" },
    level: { type: ["integer", "null"], minimum: 0 },
    levelRaw: { type: "string" },
    levelHard: { type: ["integer", "null"], minimum: 0 },
    armor: { type: ["number", "null"], minimum: 0 },
    armorTable: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["damageType", "rating"],
        properties: {
          damageType: { type: "string" },
          rating: { type: "number" },
        },
      },
    },
    skills: refArray,
    isBoss: { type: "boolean" },
    bossElite: { type: "string" },
    locations: refArray,
    profession: { oneOf: [{ $ref: "gw1-profession" }, { type: "null" }] },
    affiliation: { type: ["string", "null"] },
    variants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "levels", "skills"],
        properties: {
          label: { type: ["string", "null"] },
          levels: { type: "array", items: { type: "integer" } },
          skills: refArray,
          hardModeSkills: refArray,
          eliteSkill: { type: "string" },
          hardModeEliteSkill: { type: "string" },
          hardMode: { type: "boolean" },
        },
      },
    },
    locationLevels: { type: "object", additionalProperties: { type: "integer" } },
  },
} as const;

export const missionSchema = {
  $id: "gw1-mission",
  type: "object",
  additionalProperties: false,
  required: ["name", "wikiPage", "outpost", "foes", "bosses"],
  properties: {
    name: { type: "string" },
    wikiPage: { type: "string" },
    outpost: { type: "string" },
    region: { type: ["string", "null"] },
    foes: refArray,
    bosses: refArray,
  },
} as const;

export const characterSchema = {
  $id: "gw1-character",
  type: "object",
  additionalProperties: false,
  required: [
    "name", "primaryProfession", "unlockedSecondaries", "knownSkills",
    "unlockedLocations", "completedMissions",
  ],
  properties: {
    name: { type: "string" },
    primaryProfession: { $ref: "gw1-profession" },
    unlockedSecondaries: { type: "array", items: { $ref: "gw1-profession" } },
    knownSkills: refArray,
    unlockedLocations: refArray,
    completedMissions: refArray,
  },
} as const;

export const buildSchema = {
  $id: "gw1-build",
  type: "object",
  additionalProperties: false,
  required: ["name", "character", "primary", "secondary", "skills"],
  properties: {
    name: { type: "string" },
    character: { type: "string" },
    primary: { $ref: "gw1-profession" },
    secondary: { oneOf: [{ $ref: "gw1-profession" }, { type: "null" }] },
    skills: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      items: { type: ["string", "null"] },
    },
  },
} as const;

/** All schemas, keyed by entity name — register these with Ajv. */
export const schemas = {
  profession: professionSchema,
  campaign: campaignSchema,
  skill: skillSchema,
  location: locationSchema,
  trainer: trainerSchema,
  monster: monsterSchema,
  mission: missionSchema,
  character: characterSchema,
  build: buildSchema,
} as const;
