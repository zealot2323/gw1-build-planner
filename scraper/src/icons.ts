/**
 * Icon fetch job:  npm run icons
 *
 * Downloads skill icons and the 10 profession icons.
 *
 * Resolves each skill's icon (wiki page "File:<Skill name>.jpg") to its
 * image URL via the API (imageinfo, batched 50 titles/request) and
 * downloads them into /app/public/icons/<gwSkillId>.jpg. The ten Factions
 * allegiance skills have two icons — one per side — saved under each side's
 * own skill id.
 *
 * Politeness rules apply (1 req/s, cached): already-downloaded icons are
 * never refetched, so re-runs are cheap.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
const ICON_DIR = fileURLToPath(new URL("../../app/public/icons/", import.meta.url));
const PROFESSION_ICON_DIR = fileURLToPath(new URL("../../app/public/icons/professions/", import.meta.url));
const PROFESSIONS = [
  "Warrior", "Ranger", "Monk", "Necromancer", "Mesmer",
  "Elementalist", "Assassin", "Ritualist", "Paragon", "Dervish",
];
const API = "https://wiki.guildwars.com/api.php";
const USER_AGENT = "gw1-build-planner-scraper (personal project)";
const MIN_INTERVAL_MS = 1000;

let lastRequestAt = 0;
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  return fn();
}

interface SkillRow {
  name: string;
  wikiPage: string;
  gwSkillId: number | null;
  /** Allegiance skills have one icon per side. */
  allegianceSkillIds?: { Kurzick: number; Luxon: number };
}

/** One icon to fetch: the File: page it lives on, and the id we save it under. */
interface IconJob {
  file: string;
  id: number;
}

/**
 * Allegiance skills have a Kurzick and a Luxon icon, uploaded as
 * "File:<name> (Kurzick).jpg" / "File:<name> (Luxon).jpg"; every other skill
 * has the single "File:<name>.jpg".
 */
function iconJobs(s: SkillRow): IconJob[] {
  if (s.allegianceSkillIds) {
    return [
      { file: `File:${s.name} (Kurzick).jpg`, id: s.allegianceSkillIds.Kurzick },
      { file: `File:${s.name} (Luxon).jpg`, id: s.allegianceSkillIds.Luxon },
    ];
  }
  return s.gwSkillId === null ? [] : [{ file: `File:${s.name}.jpg`, id: s.gwSkillId }];
}

const skills: SkillRow[] = JSON.parse(await readFile(`${DATA_DIR}skills.json`, "utf8"));
await mkdir(ICON_DIR, { recursive: true });

// skip icons we already have (cache — never refetch)
const pending: IconJob[] = [];
for (const s of skills) {
  for (const job of iconJobs(s)) {
    try {
      await access(join(ICON_DIR, `${job.id}.jpg`));
    } catch {
      pending.push(job);
    }
  }
}
console.log(`${skills.length} skills, ${pending.length} icons to fetch`);

// resolve File: pages to image URLs, 50 titles per request
const urlByTitle = new Map<string, string>();
for (let i = 0; i < pending.length; i += 50) {
  const chunk = pending.slice(i, i + 50);
  const url = new URL(API);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("titles", chunk.map((j) => j.file).join("|"));
  const body = await throttled(async () => {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`imageinfo HTTP ${res.status}`);
    return res.json();
  });
  for (const page of body.query?.pages ?? []) {
    const iiUrl = page.imageinfo?.[0]?.url;
    if (!page.missing && iiUrl) urlByTitle.set(page.title, iiUrl);
  }
  console.log(`resolved ${Math.min(i + 50, pending.length)}/${pending.length} icon URLs`);
}

const missing: string[] = [];
let done = 0;
for (const job of pending) {
  const imageUrl = urlByTitle.get(job.file);
  if (!imageUrl) {
    missing.push(job.file);
    continue;
  }
  try {
    const buf = await throttled(async () => {
      const res = await fetch(imageUrl, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    });
    await writeFile(join(ICON_DIR, `${job.id}.jpg`), buf);
    done++;
    if (done % 25 === 0) console.log(`downloaded ${done} icons...`);
  } catch (err) {
    missing.push(`${job.file} (${(err as Error).message})`);
  }
}

// Profession icons ("File:<Profession>-icon.png"), same cache rule.
await mkdir(PROFESSION_ICON_DIR, { recursive: true });
const professionsToFetch: string[] = [];
for (const prof of PROFESSIONS) {
  try {
    await access(join(PROFESSION_ICON_DIR, `${prof}.png`));
  } catch {
    professionsToFetch.push(prof);
  }
}
if (professionsToFetch.length > 0) {
  const url = new URL(API);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("titles", professionsToFetch.map((p) => `File:${p}-icon.png`).join("|"));
  const body = await throttled(async () => {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`imageinfo HTTP ${res.status}`);
    return res.json();
  });
  const profUrls = new Map<string, string>();
  for (const page of body.query?.pages ?? []) {
    const u = page.imageinfo?.[0]?.url;
    if (!page.missing && u) profUrls.set(page.title, u);
  }
  for (const prof of professionsToFetch) {
    const u = profUrls.get(`File:${prof}-icon.png`);
    if (!u) {
      missing.push(`${prof} (profession icon)`);
      continue;
    }
    const buf = await throttled(async () => {
      const res = await fetch(u, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    });
    await writeFile(join(PROFESSION_ICON_DIR, `${prof}.png`), buf);
    console.log(`profession icon: ${prof}`);
  }
}

console.log(`done: ${done} downloaded, ${missing.length} missing`);
for (const m of missing) console.log(`  MISSING: ${m}`);
