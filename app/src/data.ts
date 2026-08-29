/**
 * Build-time data loading: the committed /data JSON is imported directly and
 * indexed once. All logic lives in @gw1/engine — this file only wires data.
 */
import { indexDataset, type Dataset } from "@gw1/engine";
import skills from "@data/skills.json";
import locations from "@data/locations.json";
import trainers from "@data/trainers.json";
import monsters from "@data/monsters.json";
import missions from "@data/missions.json";

export const index = indexDataset({
  skills,
  locations,
  trainers,
  monsters,
  missions,
} as unknown as Dataset);

export const dataset = index.dataset;
