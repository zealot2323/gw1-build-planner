/**
 * Discovery job:  npm run discover
 *
 * Enumerates every wiki page the planner needs (Prophecies only), writes
 * /data/manifest.json listing page titles by entity type, then fetches and
 * caches all of them (1 req/s — this run takes a while; progress is printed).
 *
 * Sources (see CLAUDE.md — API wikitext only, never rendered HTML):
 * - Skills: category intersections, mirroring the wiki's own {{Skill table}}
 *   on the "List of Prophecies skills" sub-lists:
 *   "Prophecies skills" ∩ "<Profession> skills" − "Historical content",
 *   plus core skills usable by Prophecies characters (the 6 core professions):
 *   "Core skills" ∩ "<Profession> skills" − "Historical content" − "Snow
 *   fighting skills", plus the two core common skills.
 * - Locations: Town / Template:Outposts by continent / Template:Mission
 *   outposts by continent / Explorable area (+ its Prophecies subpage).
 * - Trainers: "List of Prophecies skill trainers" (+ NPC /Skills subpages).
 * - Missions: "List of Prophecies missions and primary quests".
 * - Monsters: NOT a global bestiary crawl — the union of foe/boss links
 *   extracted from the fetched Prophecies explorable and mission pages.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchWikitext, listCategoryMembers } from "./client.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
const CORE_PROFESSIONS = ["Warrior", "Ranger", "Monk", "Necromancer", "Mesmer", "Elementalist"];
const CORE_COMMON_SKILLS = ["Resurrection Signet", "Signet of Capture"];

// ---------------------------------------------------------------------------
// wikitext helpers
// ---------------------------------------------------------------------------

/** First [[link]] target on a line, or null. */
function firstLinkTarget(line: string): string | null {
  const m = line.match(/\[\[([^\]|#]+)/);
  return m ? m[1].trim() : null;
}

/** All [[link]] targets in a chunk of wikitext. */
function linkTargets(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
}

/**
 * Extract bulleted link targets from a campaign block: from the line
 * :'''Prophecies''' up to the next campaign block / table cell / table end.
 */
function propheciesBlockLinks(wikitext: string): string[] {
  const start = wikitext.indexOf(":'''Prophecies'''");
  if (start === -1) throw new Error("no Prophecies block found");
  const rest = wikitext.slice(start + 1);
  const end = rest.search(/:'''|\|valign|\|\}/);
  const block = rest.slice(0, end === -1 ? undefined : end);
  return block
    .split("\n")
    .filter((l) => /^\*[^*]/.test(l))
    .map(firstLinkTarget)
    .filter((t): t is string => t !== null);
}

/**
 * Parse a one-row STDT table whose header cells are region links and whose
 * data cells are bullet lists (the layout of the Prophecies explorables
 * subpage). Returns { region -> link targets }.
 */
function tableColumns(wikitext: string): Map<string, string[]> {
  const headerLine = wikitext.split("\n").find((l) => l.startsWith("!"));
  if (!headerLine) throw new Error("no table header row found");
  const headers = headerLine.split("||").map((h) => linkTargets(h)[0] ?? h.replace(/[!\s]/g, ""));
  const cells = wikitext.split(/\n\|valign="top"\|/).slice(1);
  const out = new Map<string, string[]>();
  cells.forEach((cell, i) => {
    const links = cell
      .split("\n")
      .filter((l) => /^\*[^*]/.test(l))
      .map(firstLinkTarget)
      .filter((t): t is string => t !== null);
    out.set(headers[i] ?? `column ${i}`, links);
  });
  return out;
}

/**
 * Extract foe/boss page links from a location or mission page: bulleted
 * links under any "Foes" or "Bosses" heading, up to the next heading of the
 * same or higher level.
 */
function extractFoes(wikitext: string): string[] {
  const foes = new Set<string>();
  const headings = [...wikitext.matchAll(/^(={2,4})\s*([^=\n]+?)\s*\1\s*$/gm)];
  for (let i = 0; i < headings.length; i++) {
    const [, eq, name] = headings[i];
    if (!/^(Foes|Bosses|Boss)$/i.test(name.trim())) continue;
    const from = headings[i].index! + headings[i][0].length;
    let to = wikitext.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j][1].length <= eq.length) {
        to = headings[j].index!;
        break;
      }
    }
    for (const line of wikitext.slice(from, to).split("\n")) {
      if (!/^\*[^*]/.test(line)) continue;
      const target = firstLinkTarget(line);
      if (target && !/^(File|Image|Category|Template):/i.test(target)) foes.add(target);
    }
  }
  return [...foes];
}

const isSkillPage = (t: string) => !t.startsWith("List of") && !t.endsWith(" (PvP)") && !t.startsWith("Elite skill");

// ---------------------------------------------------------------------------
// 1. Skills via category membership
// ---------------------------------------------------------------------------

/**
 * A profession's skill pages: the "<Profession> skills" category plus its
 * attribute subcategories (e.g. "Axe Mastery skills") — attribute-linked
 * skills are categorized only under their attribute, not the profession.
 */
async function professionSkillTree(profession: string): Promise<Set<string>> {
  const out = new Set<string>();
  const members = await listCategoryMembers(`${profession} skills`);
  const subcats: string[] = [];
  for (const t of members) {
    if (t.startsWith("Category:")) {
      const sub = t.slice("Category:".length);
      if (sub.endsWith("skills") && !sub.startsWith("Lists of")) subcats.push(sub);
    } else {
      out.add(t);
    }
  }
  for (const sub of subcats) {
    for (const t of await listCategoryMembers(sub)) {
      if (!t.startsWith("Category:")) out.add(t);
    }
  }
  return out;
}

async function discoverSkills(): Promise<string[]> {
  console.log("== Skills: querying categories ==");
  const cat = async (name: string) => new Set(await listCategoryMembers(name));

  const historical = await cat("Historical content");
  const snow = await cat("Snow fighting skills");
  const usable = (t: string) => isSkillPage(t) && !historical.has(t) && !snow.has(t);

  // Player-learnable skills are the intersection of the campaign categories
  // with the 6 core professions' category trees — the same intersection the
  // wiki's own {{Skill table}} renders on its skill list pages. The raw
  // "Prophecies skills" category alone is NOT usable: it also holds ~76
  // monster/environment/festival/NPC skills (Spectral Agony, Fire Storm
  // (environment), Mad King skills, ...) that no player can learn.
  const propheciesRaw = await cat("Prophecies skills");
  const coreRaw = await cat("Core skills");

  const prophecies = new Set<string>();
  const core = new Set<string>();
  for (const prof of CORE_PROFESSIONS) {
    const tree = [...(await professionSkillTree(prof))].filter(usable);
    const proph = tree.filter((t) => propheciesRaw.has(t));
    const coreProf = tree.filter((t) => coreRaw.has(t));
    console.log(`  ${prof}: ${proph.length} Prophecies + ${coreProf.length} core = ${proph.length + coreProf.length}`);

    // Cross-check against the game's own numbers: Prophecies shipped with
    // 450 skills — 75 per profession (core + Prophecies) — plus a handful of
    // later core additions per profession (2020 anniversary elites, PvE-only
    // faction skills like "Save Yourselves!").
    if (proph.length + coreProf.length < 70 || proph.length + coreProf.length > 85) {
      throw new Error(`${prof}: ${proph.length + coreProf.length} skills, expected ~75±8 — check categories`);
    }
    for (const t of proph) prophecies.add(t);
    for (const t of coreProf) core.add(t);
  }
  for (const t of CORE_COMMON_SKILLS) core.add(t);

  const skills = new Set([...prophecies, ...core]);
  console.log(`  totals: ${prophecies.size} Prophecies + ${core.size} core = ${skills.size} unique pages`);
  console.log(
    `  (raw "Prophecies skills" category: ${propheciesRaw.size} — extras are list pages, ` +
      `(PvP) variants, and unlearnable monster/environment skills)`,
  );
  if (skills.size < 440 || skills.size > 490) {
    throw new Error(`total skill count ${skills.size} outside expected 440-490 (450 at launch + anniversary elites)`);
  }
  return [...skills].sort();
}

// ---------------------------------------------------------------------------
// 2. Locations
// ---------------------------------------------------------------------------

interface Locations {
  towns: string[];
  outposts: string[];
  missionOutposts: string[];
  explorables: string[];
}

async function discoverLocations(): Promise<Locations> {
  console.log("== Locations ==");
  const towns = propheciesBlockLinks((await fetchWikitext("Town")).wikitext);
  const outposts = propheciesBlockLinks(
    (await fetchWikitext("Template:Outposts by continent")).wikitext,
  );
  const missionOutposts = propheciesBlockLinks(
    (await fetchWikitext("Template:Mission outposts by continent")).wikitext,
  );

  // Pre-Searing explorables: the "Prophecies pre-Searing" section of the
  // Explorable area page. Post-Searing: the transcluded Prophecies subpage,
  // excluding The Mists column (PvP/core areas, not Prophecies content).
  const explorableArticle = (await fetchWikitext("Explorable area")).wikitext;
  const preSection = explorableArticle.split(/==\s*Prophecies pre-Searing\s*==/)[1]?.split(/\n==[^=]/)[0] ?? "";
  const preSearing = preSection
    .split("\n")
    .filter((l) => /^\*[^*]/.test(l))
    .map(firstLinkTarget)
    .filter((t): t is string => t !== null);

  const subpage = (await fetchWikitext("Guild Wars Prophecies/Explorable areas")).wikitext;
  const byRegion = tableColumns(subpage);
  const postSearing: string[] = [];
  for (const [region, links] of byRegion) {
    if (region === "The Mists") continue;
    postSearing.push(...links);
  }

  const explorables = [...new Set([...preSearing, ...postSearing])];
  console.log(
    `  towns: ${towns.length}, outposts: ${outposts.length}, ` +
      `mission outposts: ${missionOutposts.length}, explorables: ${explorables.length} ` +
      `(${preSearing.length} pre-Searing)`,
  );
  return { towns, outposts, missionOutposts, explorables };
}

// ---------------------------------------------------------------------------
// 3. Trainers, 4. Missions
// ---------------------------------------------------------------------------

async function discoverTrainers(): Promise<{ trainers: string[]; skillSubpages: string[] }> {
  console.log("== Trainers ==");
  const wt = (await fetchWikitext("List of Prophecies skill trainers")).wikitext;
  const trainers = [...wt.matchAll(/^===\s*\[\[([^\]|]+)[^=]*?\]\]\s+in\s+\[\[/gm)].map((m) => m[1].trim());
  const skillSubpages = [...wt.matchAll(/\{\{:([^}]+\/Skills)\}\}/g)].map((m) => m[1].trim());
  console.log(`  ${trainers.length} trainers, ${skillSubpages.length} /Skills subpages`);
  return { trainers, skillSubpages };
}

async function discoverMissions(): Promise<string[]> {
  console.log("== Missions ==");
  const wt = (await fetchWikitext("List of Prophecies missions and primary quests")).wikitext;
  // Numbered mission lines look like ":;12. [[Aurora Glade]]"; the three
  // any-order Ascension missions are indented one level deeper ("::;15. ...").
  const missions = [...wt.matchAll(/^:{1,2};\s*\d+\.?\s*\[\[([^\]|#]+)/gm)].map((m) => m[1].trim());
  console.log(`  ${missions.length} missions`);
  if (missions.length !== 25) {
    throw new Error(`expected 25 Prophecies missions, parsed ${missions.length}`);
  }
  return missions;
}

// ---------------------------------------------------------------------------
// bulk fetch with progress
// ---------------------------------------------------------------------------

async function fetchAll(label: string, titles: string[]): Promise<string[]> {
  const failed: string[] = [];
  console.log(`== Fetching ${titles.length} ${label} pages ==`);
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    try {
      await fetchWikitext(title);
      if ((i + 1) % 25 === 0 || i === titles.length - 1) {
        console.log(`  [${i + 1}/${titles.length}] ...${title}`);
      }
    } catch (err) {
      failed.push(title);
      console.log(`  [${i + 1}/${titles.length}] FAILED: ${title} (${(err as Error).message})`);
    }
  }
  return failed;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const skills = await discoverSkills();
const locations = await discoverLocations();
const { trainers, skillSubpages } = await discoverTrainers();
const missions = await discoverMissions();

// Fetch every location + mission page now — the explorable and mission pages
// are the source of the monster set (our bestiary IS "what spawns in
// Prophecies areas"; we never crawl a global bestiary).
const allLocations = [
  ...locations.towns,
  ...locations.outposts,
  ...locations.missionOutposts,
  ...locations.explorables,
];
const failures: string[] = [];
failures.push(...(await fetchAll("location", allLocations)));
failures.push(...(await fetchAll("mission", missions)));

console.log("== Monsters: extracting foe/boss links from explorable + mission pages ==");
const monsterSet = new Set<string>();
for (const title of [...locations.explorables, ...missions]) {
  try {
    for (const foe of extractFoes((await fetchWikitext(title)).wikitext)) monsterSet.add(foe);
  } catch {
    // page already reported as failed above
  }
}
const monsters = [...monsterSet].sort();
console.log(`  ${monsters.length} unique monster pages`);

const manifest = {
  generated: new Date().toISOString(),
  campaign: "Prophecies",
  counts: {
    skills: skills.length,
    towns: locations.towns.length,
    outposts: locations.outposts.length,
    missionOutposts: locations.missionOutposts.length,
    explorables: locations.explorables.length,
    trainers: trainers.length,
    missions: missions.length,
    monsters: monsters.length,
  },
  skills,
  locations,
  trainers,
  trainerSkillSubpages: skillSubpages,
  missions,
  monsters,
};

await mkdir(DATA_DIR, { recursive: true });
await writeFile(`${DATA_DIR}manifest.json`, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`wrote data/manifest.json`);

failures.push(...(await fetchAll("skill", skills)));
failures.push(...(await fetchAll("trainer", [...trainers, ...skillSubpages])));
failures.push(...(await fetchAll("monster", monsters)));

console.log("\n== Discovery complete ==");
console.log(JSON.stringify(manifest.counts, null, 2));
if (failures.length > 0) {
  console.log(`FAILED pages (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
} else {
  console.log("all pages fetched and cached");
}
