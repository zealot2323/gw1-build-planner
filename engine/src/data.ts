/**
 * Dataset container + lookup indexes. Pure data structures — the engine does
 * no I/O; callers load the /data JSON however they like and pass it in.
 */
import type { Location, LocationRef, Mission, Monster, Skill, Trainer } from "./types.js";

export interface Dataset {
  skills: Skill[];
  locations: Location[];
  trainers: Trainer[];
  monsters: Monster[];
  missions?: Mission[];
}

export interface DataIndex {
  dataset: Dataset;
  skillByPage: Map<string, Skill>;
  locationByPage: Map<string, Location>;
  trainerByName: Map<string, Trainer>;
  monsterByPage: Map<string, Monster>;
  missionByName: Map<string, Mission>;
}

export function indexDataset(dataset: Dataset): DataIndex {
  return {
    dataset,
    skillByPage: new Map(dataset.skills.map((s) => [s.wikiPage, s])),
    locationByPage: new Map(dataset.locations.map((l) => [l.wikiPage, l])),
    trainerByName: new Map(dataset.trainers.map((t) => [t.name, t])),
    monsterByPage: new Map(dataset.monsters.map((m) => [m.wikiPage, m])),
    missionByName: new Map((dataset.missions ?? []).map((m) => [m.wikiPage, m])),
  };
}

/** Is this location an explorable area (per the dataset, not a guess)? */
export function isExplorable(index: DataIndex, name: LocationRef): boolean {
  return index.locationByPage.get(name)?.kind === "explorable";
}
