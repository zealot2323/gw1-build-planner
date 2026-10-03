/**
 * gwtoolbox-api client:  npm run gwtoolbox
 *
 * https://api.gwtoolbox.com publishes Guild Wars game data generated from
 * ArenaNet's own client, MIT-licensed and regenerated daily. It is the
 * authority for what a skill DOES — its text, costs and timings — where the
 * wiki is a hand-maintained retelling of the same numbers.
 *
 * It says nothing about where a skill comes from: no trainers, no quest
 * rewards, no capture bosses, and no wiki page titles. Those stay wiki-
 * sourced, and the wiki's skill list stays the spine of the dataset — the
 * API's 3,495 entries include monster skills, conditions and unreleased
 * beta skills with no way to tell them from skills a player can own.
 *
 * Join key: the in-game skill id, which we already read from the wiki
 * infobox (`gwSkillId`). It matches on all 1,327 of our skills.
 *
 * maps.json is cached for a second job: it is the only list of the game's
 * MapIDs, which is how GWToolbox records where a character has been (see
 * src/maps.ts).
 *
 * Cached on disk like the wiki pages, and the cache is committed: `parse`
 * runs offline from it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE = "https://api.gwtoolbox.com/v1/en";
const CACHE_DIR = fileURLToPath(new URL("../cache/gwtoolbox/", import.meta.url));
const FILES = ["skills", "attributes", "professions", "campaigns", "maps"] as const;
type File = (typeof FILES)[number];

/**
 * A skill as the client stores it. Every field except `id` is omitted when
 * it holds its default — the API's own rule — so everything is optional.
 */
export interface ToolboxSkill {
  id: number;
  name?: string;
  description?: string;
  concise?: string;
  campaign?: number;
  profession?: number;
  attribute?: number;
  title?: number;
  type?: number;
  energy_cost?: number;
  /** Internal units: 25 per strike of adrenaline. */
  adrenaline?: number;
  /** Exhaustion. */
  overcast?: number;
  /** Health sacrificed, as a percent. */
  health_cost?: number;
  activation?: number;
  aftercast?: number;
  recharge?: number;
  elite?: number;
  pvp_only?: number;
  pve_only?: number;
  pvp_skill_id?: number;
  scale_cap_rank?: number;
}

export interface ToolboxData {
  skills: Map<number, ToolboxSkill>;
  attributes: Map<number, string>;
  professions: Map<number, string>;
  campaigns: Map<number, string>;
}

interface IdName {
  id: number;
  name?: string;
}

const cachePath = (file: File) => `${CACHE_DIR}${file}.json`;

/** Fetch every file and cache it. The API is static JSON behind a CDN. */
export async function fetchGwToolbox(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  for (const file of FILES) {
    const response = await fetch(`${BASE}/${file}.json`, {
      headers: { "user-agent": "gw1-build-planner-scraper (personal project)" },
    });
    if (!response.ok) throw new Error(`${file}.json: HTTP ${response.status}`);
    const body = (await response.json()) as unknown[];
    if (!Array.isArray(body) || body.length === 0) throw new Error(`${file}.json: empty`);
    await writeFile(cachePath(file), JSON.stringify(body, null, 1) + "\n", "utf8");
    console.log(`  ${file}.json: ${body.length} records`);
  }
}

const readJson = async <T>(file: File): Promise<T[]> =>
  JSON.parse(await readFile(cachePath(file), "utf8")) as T[];

const byId = (rows: IdName[]) =>
  new Map(rows.filter((r) => r.name !== undefined).map((r) => [r.id, r.name!]));

/** Read the cache. Throws if it isn't there — `parse` must not hit the network. */
export async function loadGwToolbox(): Promise<ToolboxData> {
  return {
    skills: new Map((await readJson<ToolboxSkill>("skills")).map((s) => [s.id, s])),
    attributes: byId(await readJson<IdName>("attributes")),
    professions: byId(await readJson<IdName>("professions")),
    campaigns: byId(await readJson<IdName>("campaigns")),
  };
}

/**
 * Strikes of adrenaline. The client stores a raw cost and each strike is
 * worth 25, so a skill costing 80 needs four strikes, not 3.2 — rounding up
 * reproduces all 100 of the wiki's adrenaline figures exactly.
 */
export const adrenalineStrikes = (raw: number | undefined): number | null =>
  raw ? Math.ceil(raw / 25) : null;

// Run as a script (`npm run gwtoolbox`); imported by parse the rest of the time.
// Compared by filename: the repo path contains characters that make the
// usual import.meta.url/argv comparison unreliable.
if (process.argv[1]?.endsWith("gwtoolbox.ts")) {
  console.log("fetching api.gwtoolbox.com …");
  await fetchGwToolbox();
  const data = await loadGwToolbox();
  console.log(`cached ${data.skills.size} skills, ${data.attributes.size} attributes`);
}
