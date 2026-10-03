/**
 * Reading GWToolbox's character_completion.json.
 *
 * GWToolbox writes one record per character, and records progress as
 * BITFIELDS rather than lists: each `uint32[]` is a run of 32-bit words
 * where bit i means "item i". The bit index is the game's own id — a
 * SkillID for `skills`, a MapID for `maps_unlocked`, `mission*` and
 * `vanquishes` — so reading it needs nothing but the id tables in
 * data/map-ids.json and the `gwSkillId` we already carry on every skill.
 *
 * Everything here is additive. An import can tell you about progress the
 * planner did not know about; it can never tell you a character has LOST a
 * skill or a map, because the file may have been written on a different
 * machine, or by a toolbox that had not seen every character yet. Nothing
 * the player owns in the planner — builds, to-dos, owned campaigns — is
 * touched by an import either.
 */
import type {
  Campaign,
  Character,
  LocationRef,
  MissionRef,
  SkillRef,
} from "./types.js";
import { Profession } from "./types.js";
import type { DataIndex } from "./data.js";

/** One character's record, as the file stores it. Fields default to absent. */
export interface ToolboxCharacter {
  /** GW::Constants::Profession: 1 = Warrior … 10 = Dervish. */
  profession?: number;
  account?: string;
  is_pvp?: boolean;
  is_pre_searing?: boolean;
  skills?: number[];
  mission?: number[];
  mission_bonus?: number[];
  mission_hm?: number[];
  mission_bonus_hm?: number[];
  vanquishes?: number[];
  heroes?: number[];
  maps_unlocked?: number[];
  minipets_unlocked?: number[];
  festival_hats?: number[];
  hom_code?: string;
}

/** The whole file: character name -> record. */
export type ToolboxCompletionFile = Record<string, ToolboxCharacter>;

/** data/map-ids.json: our pages -> every game MapID that is that place. */
export interface MapIdTable {
  locations: Record<LocationRef, number[]>;
  missions: Record<MissionRef, number[]>;
}

/** GW::Constants::Profession, which is 1-based and in release order. */
const PROFESSION_BY_ID: Record<number, Profession> = {
  1: Profession.Warrior,
  2: Profession.Ranger,
  3: Profession.Monk,
  4: Profession.Necromancer,
  5: Profession.Mesmer,
  6: Profession.Elementalist,
  7: Profession.Assassin,
  8: Profession.Ritualist,
  9: Profession.Paragon,
  10: Profession.Dervish,
};

/** Bit `index` of a packed bitfield; absent words read as 0. */
export function bitAt(words: number[] | undefined, index: number): boolean {
  if (!words) return false;
  const word = words[index >>> 5];
  return word !== undefined && (word & (1 << (index & 31))) !== 0;
}

/** The names whose map ids have any of their bits set. */
function namesWithBit(table: Record<string, number[]>, words: number[] | undefined): string[] {
  if (!words) return [];
  const out: string[] = [];
  for (const [name, ids] of Object.entries(table)) {
    if (ids.some((id) => bitAt(words, id))) out.push(name);
  }
  return out.sort();
}

/** What one character's record says, in the planner's own terms. */
export interface CompletionImport {
  name: string;
  profession: Profession | null;
  isPreSearing: boolean;
  isPvP: boolean;
  knownSkills: SkillRef[];
  unlockedLocations: LocationRef[];
  completedMissions: MissionRef[];
  completedMissionsHard: MissionRef[];
  missionBonuses: MissionRef[];
  missionBonusesHard: MissionRef[];
  vanquishedAreas: LocationRef[];
}

export function decodeCharacter(
  name: string,
  record: ToolboxCharacter,
  index: DataIndex,
  mapIds: MapIdTable,
): CompletionImport {
  const knownSkills = index.dataset.skills
    .filter((skill) => bitAt(record.skills, skill.gwSkillId))
    .map((skill) => skill.wikiPage)
    .sort();

  // Vanquishing is an explorable-area affair; a bit set against anything
  // else is the client reusing the array, not a place you can clear.
  const vanquishedAreas = namesWithBit(mapIds.locations, record.vanquishes).filter(
    (page) => index.locationByPage.get(page)?.kind === "explorable",
  );

  return {
    name,
    profession: record.profession ? (PROFESSION_BY_ID[record.profession] ?? null) : null,
    isPreSearing: !!record.is_pre_searing,
    isPvP: !!record.is_pvp,
    knownSkills,
    unlockedLocations: namesWithBit(mapIds.locations, record.maps_unlocked),
    completedMissions: namesWithBit(mapIds.missions, record.mission),
    completedMissionsHard: namesWithBit(mapIds.missions, record.mission_hm),
    missionBonuses: namesWithBit(mapIds.missions, record.mission_bonus),
    missionBonusesHard: namesWithBit(mapIds.missions, record.mission_bonus_hm),
    vanquishedAreas,
  };
}

const union = (a: readonly string[] | undefined, b: readonly string[]): string[] =>
  [...new Set([...(a ?? []), ...b])].sort();

/** Which campaigns a character has evidently been to. */
function campaignsSeen(locations: LocationRef[], index: DataIndex): Campaign[] {
  const seen = new Set<Campaign>();
  for (const page of locations) {
    const campaign = index.locationByPage.get(page)?.campaign;
    if (campaign && campaign !== "Core") seen.add(campaign);
  }
  return [...seen];
}

/** What an import did to one character, so the app can say so. */
export interface CharacterChange {
  name: string;
  created: boolean;
  skills: number;
  locations: number;
  missions: number;
  missionsHard: number;
  vanquishes: number;
}

export interface MergeResult {
  characters: Character[];
  changes: CharacterChange[];
}

/**
 * Fold a decoded file into the save.
 *
 * Characters are matched by name. An unknown name is added; a known one
 * gains whatever the file knows and keeps everything else, including the
 * campaigns and allegiance the player set by hand. PvP-only characters are
 * skipped: they have no world progress to record.
 */
export function mergeCompletion<T extends Character>(
  characters: T[],
  file: ToolboxCompletionFile,
  index: DataIndex,
  mapIds: MapIdTable,
  makeCharacter: (base: Character) => T,
): { characters: T[]; changes: CharacterChange[] } {
  const out = [...characters];
  const changes: CharacterChange[] = [];

  for (const [name, record] of Object.entries(file)) {
    if (!name || record.is_pvp) continue;
    const decoded = decodeCharacter(name, record, index, mapIds);
    const at = out.findIndex((c) => c.name === name);
    const existing = at === -1 ? null : out[at];

    const merged: Character = {
      name,
      campaign: existing?.campaign,
      ownedCampaigns: existing?.ownedCampaigns,
      primaryProfession:
        existing?.primaryProfession ?? decoded.profession ?? Profession.Warrior,
      allegiance: existing?.allegiance,
      unlockedSecondaries: existing?.unlockedSecondaries ?? [],
      knownSkills: union(existing?.knownSkills, decoded.knownSkills),
      unlockedLocations: union(existing?.unlockedLocations, decoded.unlockedLocations),
      completedMissions: union(existing?.completedMissions, decoded.completedMissions),
      completedMissionsHard: union(existing?.completedMissionsHard, decoded.completedMissionsHard),
      missionBonuses: union(existing?.missionBonuses, decoded.missionBonuses),
      missionBonusesHard: union(existing?.missionBonusesHard, decoded.missionBonusesHard),
      vanquishedAreas: union(existing?.vanquishedAreas, decoded.vanquishedAreas),
      todos: existing?.todos,
    };

    // A new character has no campaigns yet; the places it has been are the
    // only evidence there is. An existing one keeps what the player chose.
    if (!existing) {
      const seen = campaignsSeen(merged.unlockedLocations, index);
      merged.ownedCampaigns = seen.length > 0 ? seen : undefined;
      merged.campaign = seen[0];
    }

    changes.push({
      name,
      created: !existing,
      skills: merged.knownSkills.length - (existing?.knownSkills.length ?? 0),
      locations: merged.unlockedLocations.length - (existing?.unlockedLocations.length ?? 0),
      missions: merged.completedMissions.length - (existing?.completedMissions.length ?? 0),
      missionsHard:
        (merged.completedMissionsHard?.length ?? 0) - (existing?.completedMissionsHard?.length ?? 0),
      vanquishes:
        (merged.vanquishedAreas?.length ?? 0) - (existing?.vanquishedAreas?.length ?? 0),
    });

    const next = existing ? ({ ...existing, ...merged } as T) : makeCharacter(merged);
    if (at === -1) out.push(next);
    else out[at] = next;
  }

  return { characters: out, changes };
}

/** Did this import actually change anything? */
export const changedAnything = (changes: CharacterChange[]): boolean =>
  changes.some(
    (c) =>
      c.created ||
      c.skills > 0 ||
      c.locations > 0 ||
      c.missions > 0 ||
      c.missionsHard > 0 ||
      c.vanquishes > 0,
  );
