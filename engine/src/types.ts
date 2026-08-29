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
  /** Bosses the elite can be captured from with Signet of Capture. */
  captureBosses: BossRef[];
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
  campaign: Campaign;
  /** Energy cost; null when the skill costs adrenaline instead. */
  energyCost: number | null;
  /** Adrenaline cost in strikes; null for energy skills. */
  adrenalineCost: number | null;
  /** Activation time in seconds (0 for instant). */
  activation: number;
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
  campaign: Campaign;
  region: string;
  /** Exits / connected areas. */
  neighbors: LocationRef[];
  /** Skill trainer stationed here, if any (towns/outposts). */
  trainer?: TrainerRef;
  /** Monsters found here (explorables/missions). */
  foes: MonsterRef[];
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

export interface Monster {
  name: string;
  wikiPage: string;
  species: string;
  level: number;
  /** Base armor rating (normal mode). */
  armor: number;
  /** Raw armor table from the wiki, kept structured (may break out by damage type). */
  armorTable: ArmorEntry[];
  skills: SkillRef[];
  isBoss: boolean;
  /** The elite this boss can be captured for, if any. */
  bossElite?: SkillRef;
  locations: LocationRef[];
}

export interface Mission {
  name: string;
  wikiPage: string;
  /** The mission outpost the mission starts from. */
  outpost: LocationRef;
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
    campaign: { $ref: "gw1-campaign" },
    energyCost: { type: ["number", "null"], minimum: 0 },
    adrenalineCost: { type: ["number", "null"], minimum: 0 },
    activation: { type: "number", minimum: 0 },
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
    campaign: { $ref: "gw1-campaign" },
    region: { type: "string" },
    neighbors: refArray,
    trainer: { type: "string" },
    foes: refArray,
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
    level: { type: "integer", minimum: 0 },
    armor: { type: "number", minimum: 0 },
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
