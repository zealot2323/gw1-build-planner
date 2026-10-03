/**
 * Map ids:  npm run maps
 *
 * GWToolbox records a character's progress as bitfields indexed by the
 * game's own MapID — one bit per map for "unlocked", "mission completed",
 * "vanquished". To read them we need MapID -> our own pages, and
 * api.gwtoolbox.com's maps.json is the only list of ids and names there is.
 *
 * The match is by name, and deliberately many-to-one: 156 map names belong
 * to more than one id (instanced copies, Winds of Change versions, the
 * party-size variants of a town). Unlocking any of them means the player
 * has been there, so every id that shares the name is listed and the
 * reader ORs over them.
 *
 * The one place a name is genuinely two different places is pre-Searing:
 * Ascalon City, Fort Ranik, Piken Square and Regent Valley exist in both
 * eras. Those are split by region — PRE_SEARING_REGION is its own — so a
 * post-Searing page never collects a pre-Searing id or the reverse.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadIndex } from "./community.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
const MAPS_CACHE = fileURLToPath(new URL("../cache/gwtoolbox/maps.json", import.meta.url));

/** GW::Constants::Region::Presearing. */
const PRE_SEARING_REGION = 7;

interface ToolboxMap {
  id: number;
  name?: string;
  campaign?: number;
  region?: number;
}

/** "Moddok Crevice (outpost)" -> "Moddok Crevice" */
const baseName = (page: string): string =>
  page.replace(/\s*\((outpost|explorable area|mission|town|pre-Searing)\)\s*$/i, "").trim();

const maps: ToolboxMap[] = JSON.parse(await readFile(MAPS_CACHE, "utf8"));
const index = await loadIndex();

// Keyed lower-case: the client's own capitalisation wanders ("Throne Of
// Secrets"), and it is not a different place when it does.
const byName = new Map<string, ToolboxMap[]>();
for (const map of maps) {
  if (!map.name) continue;
  const key = map.name.toLowerCase();
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key)!.push(map);
}

/** Every map id that is this page, pre-Searing kept apart from post. */
function idsFor(page: string): number[] {
  const all = byName.get(baseName(page).toLowerCase()) ?? [];
  const wantsPreSearing = /\(pre-Searing\)/i.test(page);
  const matching = all.filter((m) => (m.region === PRE_SEARING_REGION) === wantsPreSearing);
  // Ashford Abbey and the rest of pre-Searing Ascalon need no "(pre-Searing)"
  // suffix, because there is no post-Searing place to tell them apart from.
  const ids = matching.length > 0 || wantsPreSearing ? matching : all;
  return ids.map((m) => m.id).sort((a, b) => a - b);
}

const locations: Record<string, number[]> = {};
const unmatchedLocations: string[] = [];
for (const location of index.dataset.locations) {
  const ids = idsFor(location.wikiPage);
  if (ids.length === 0) unmatchedLocations.push(location.wikiPage);
  else locations[location.wikiPage] = ids;
}

// A mission's completion bit is indexed by its OUTPOST's map id, not the
// instance's: CompletionWindow asks IsAreaComplete() with the outpost.
const missions: Record<string, number[]> = {};
const unmatchedMissions: string[] = [];
for (const mission of index.dataset.missions ?? []) {
  const ids = idsFor(mission.outpost ?? mission.wikiPage);
  if (ids.length === 0) unmatchedMissions.push(mission.name);
  else missions[mission.name] = ids;
}

await writeFile(
  `${DATA_DIR}map-ids.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: "https://api.gwtoolbox.com/v1/en/maps.json",
      locations,
      missions,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

const count = (r: Record<string, number[]>) => Object.keys(r).length;
console.log(`locations: ${count(locations)} mapped (${unmatchedLocations.length} without a map id)`);
if (unmatchedLocations.length) console.log(`  ${unmatchedLocations.join(", ")}`);
console.log(`missions: ${count(missions)} mapped (${unmatchedMissions.length} without a map id)`);
if (unmatchedMissions.length) console.log(`  ${unmatchedMissions.join(", ")}`);
console.log("wrote data/map-ids.json");
