/**
 * Build-time data loading: the committed /data JSON is imported directly and
 * indexed once. All logic lives in @gw1/engine — this file only wires data.
 */
import {
  indexChanges,
  indexDataset,
  scopedDataset,
  type Character,
  type DataIndex,
  type Dataset,
  type CommunityBuild,
  type CommunityBuildsFile,
  type SkillChangeLog,
} from "@gw1/engine";
import skills from "@data/skills.json";
import locations from "@data/locations.json";
import trainers from "@data/trainers.json";
import monsters from "@data/monsters.json";
import missions from "@data/missions.json";
import quests from "@data/quests.json";
import skillChanges from "@data/skill-changes.json";

export const index = indexDataset({
  skills,
  locations,
  trainers,
  monsters,
  missions,
  quests,
} as unknown as Dataset);

export const dataset = index.dataset;

/**
 * Recently-changed skills. Not character-scoped — a balance patch applies
 * to everyone — so this is indexed once at module load.
 */
export const changes = indexChanges(skillChanges as unknown as SkillChangeLog);

/**
 * Builds collected from elsewhere. Loaded on demand rather than bundled:
 * it's over a megabyte of other people's builds, and most visits never
 * open that tab — which matters most on a phone.
 */
export async function loadCommunityBuilds(): Promise<CommunityBuild[]> {
  const module = await import("@data/community-builds.json");
  return ((module.default ?? module) as unknown as CommunityBuildsFile).builds ?? [];
}

/**
 * The dataset narrowed to a character's owned campaigns, indexed. Every
 * view uses this rather than the global index, so a Tyrian never sees
 * Canthan outposts sitting "6 zones away".
 */
export function indexForCharacter(character: Character | null): DataIndex {
  if (character === null) return index;
  const scoped = scopedDataset(index.dataset, character);
  return indexDataset(scoped);
}
