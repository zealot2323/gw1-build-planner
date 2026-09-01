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
import { CAMPAIGNS, type CampaignConfig } from "./campaigns.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
/**
 * Every profession, walked for every campaign. A campaign's skill set is not
 * limited to the professions it introduced — Nightfall adds Assassin and
 * Ritualist skills, Factions adds skills for all six core professions.
 */
const ALL_PROFESSIONS = [
  "Warrior", "Ranger", "Monk", "Necromancer", "Mesmer", "Elementalist",
  "Assassin", "Ritualist", "Paragon", "Dervish",
];
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
 * :'''<Campaign>''' up to the next campaign block / table cell / table end.
 */
function campaignBlockLinks(wikitext: string, campaign: string): string[] {
  const start = wikitext.indexOf(`:'''${campaign}'''`);
  if (start === -1) return [];
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

async function discoverSkills(campaign: CampaignConfig): Promise<string[]> {
  console.log(`== ${campaign.name} skills ==`);
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
  const campaignRaw = await cat(`${campaign.name} skills`);
  const coreRaw = await cat("Core skills");

  const own = new Set<string>();
  const core = new Set<string>();
  for (const prof of ALL_PROFESSIONS) {
    const tree = [...(await professionSkillTree(prof))].filter(usable);
    const proph = tree.filter((t) => campaignRaw.has(t));
    const coreProf = tree.filter((t) => coreRaw.has(t));
    console.log(`  ${prof}: ${proph.length} ${campaign.name} + ${coreProf.length} core`);

    // Cross-check against the game's own numbers: Prophecies shipped with
    // 450 skills — 75 per profession (core + Prophecies) — plus a handful of
    // later core additions per profession (2020 anniversary elites, PvE-only
    // faction skills like "Save Yourselves!").
    for (const t of proph) own.add(t);
    for (const t of coreProf) core.add(t);
  }
  for (const t of CORE_COMMON_SKILLS) core.add(t);

  const skills = new Set([...own, ...core]);
  console.log(
    `  ${own.size} ${campaign.name} + ${core.size} core = ${skills.size} unique pages ` +
      `(raw category ${campaignRaw.size})`,
  );
  // The campaign category is the ceiling: everything learnable in it must be
  // a page we picked up, minus list pages and (PvP) variants.
  const missed = [...campaignRaw].filter((t) => isSkillPage(t) && !own.has(t)).length;
  if (own.size < campaignRaw.size * 0.5) {
    throw new Error(`${campaign.name}: only ${own.size} of ${campaignRaw.size} category members kept — check professions`);
  }
  console.log(`  (${missed} category members not kept: monster/environment/event skills)`);
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

async function discoverLocations(campaign: CampaignConfig): Promise<Locations> {
  console.log(`== ${campaign.name} locations ==`);
  const block = campaign.templateBlock;
  const towns = campaignBlockLinks((await fetchWikitext("Town")).wikitext, block);
  const outposts = campaignBlockLinks(
    (await fetchWikitext("Template:Outposts by continent")).wikitext,
    block,
  );
  const missionOutposts = campaignBlockLinks(
    (await fetchWikitext("Template:Mission outposts by continent")).wikitext,
    block,
  );

  // Pre-Searing explorables: the "Prophecies pre-Searing" section of the
  // Explorable area page. Post-Searing: the transcluded Prophecies subpage,
  // excluding The Mists column (PvP/core areas, not Prophecies content).
  // Prophecies alone has a pre-Searing half, listed in its own section of
  // the Explorable area article rather than on the campaign subpage.
  let preSearing: string[] = [];
  if (campaign.name === "Prophecies") {
    const article = (await fetchWikitext("Explorable area")).wikitext;
    const preSection = article.split(/==\s*Prophecies pre-Searing\s*==/)[1]?.split(/\n==[^=]/)[0] ?? "";
    preSearing = preSection
      .split("\n")
      .filter((l) => /^\*[^*]/.test(l))
      .map(firstLinkTarget)
      .filter((t): t is string => t !== null);
  }

  const subpage = (await fetchWikitext(campaign.explorablesPage)).wikitext;
  const byRegion = tableColumns(subpage);
  const main: string[] = [];
  for (const [region, links] of byRegion) {
    if (campaign.excludeRegions.includes(region)) continue;
    main.push(...links);
  }

  const explorables = [...new Set([...preSearing, ...main])];
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

async function discoverTrainers(
  campaign: CampaignConfig,
): Promise<{ trainers: string[]; skillSubpages: string[] }> {
  console.log(`== ${campaign.name} trainers ==`);
  // The category is the reliable source. Prophecies' list page uses
  // "=== [[Name]] in [[Place]] ===" headings, but every other campaign's
  // list is generated by a DPL query, so the trainers are not in the
  // wikitext at all — only the category names them.
  const members = await listCategoryMembers(`${campaign.name} skill trainers`);
  const trainers = members.filter(
    (t) => !t.startsWith("Category:") && !t.startsWith("List of") && !t.includes("/"),
  );

  // Their skill lists live on "<Name>/Skills" subpages.
  const skillSubpages = trainers.map((t) => `${t}/Skills`);
  console.log(`  ${trainers.length} trainers`);
  return { trainers, skillSubpages };
}

async function discoverMissions(campaign: CampaignConfig): Promise<string[]> {
  console.log(`== ${campaign.name} missions ==`);
  if (campaign.missionListPage === null) {
    console.log("  none (this campaign has dungeons, not numbered missions)");
    return [];
  }
  const wt = (await fetchWikitext(campaign.missionListPage)).wikitext;
  // ":;12. [[Aurora Glade]]"; Ascension missions are indented one level
  // deeper ("::;15. ..."), and Factions' Kurzick/Luxon split numbers its
  // branches "9a." / "9b.".
  const missions = [...wt.matchAll(/^:{1,2};\s*\d+[a-z]?\.?\s*\[\[([^\]|#]+)/gm)].map((m) => m[1].trim());
  console.log(`  ${missions.length} missions`);
  if (campaign.name === "Prophecies" && missions.length !== 25) {
    throw new Error(`expected 25 Prophecies missions, parsed ${missions.length}`);
  }
  return [...new Set(missions)];
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

// ---------------------------------------------------------------------------
// main — one pass per campaign, into a single manifest keyed by campaign
// ---------------------------------------------------------------------------

/** Campaigns to discover; default is all of them. `npm run discover -- Factions` */
const requested = process.argv.slice(2);
const campaigns =
  requested.length > 0
    ? CAMPAIGNS.filter((c) => requested.some((r) => c.name.toLowerCase() === r.toLowerCase()))
    : CAMPAIGNS;
if (campaigns.length === 0) {
  throw new Error(`no campaign matched ${requested.join(", ")}; known: ${CAMPAIGNS.map((c) => c.name).join(", ")}`);
}

const failures: string[] = [];
const byCampaign: Record<string, unknown> = {};
const allSkills = new Set<string>();
const allMonsters = new Set<string>();

for (const campaign of campaigns) {
  console.log(`\n########## ${campaign.name} ##########`);
  const skills = await discoverSkills(campaign);
  const locations = await discoverLocations(campaign);
  const { trainers, skillSubpages } = await discoverTrainers(campaign);
  const missions = await discoverMissions(campaign);

  // Fetch the location + mission pages first — they are the source of the
  // monster set (the bestiary IS "what spawns in this campaign's areas";
  // we never crawl a global bestiary).
  const allLocations = [
    ...locations.towns,
    ...locations.outposts,
    ...locations.missionOutposts,
    ...locations.explorables,
  ];
  failures.push(...(await fetchAll(`${campaign.name} location`, allLocations)));
  failures.push(...(await fetchAll(`${campaign.name} mission`, missions)));

  console.log(`== ${campaign.name} monsters: extracting foe/boss links ==`);
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

  for (const s of skills) allSkills.add(s);
  for (const m of monsters) allMonsters.add(m);

  byCampaign[campaign.name] = {
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

  failures.push(...(await fetchAll(`${campaign.name} skill`, skills)));
  failures.push(...(await fetchAll(`${campaign.name} trainer`, [...trainers, ...skillSubpages])));
  failures.push(...(await fetchAll(`${campaign.name} monster`, monsters)));
}

const manifest = {
  generated: new Date().toISOString(),
  campaigns: campaigns.map((c) => c.name),
  byCampaign,
};

await mkdir(DATA_DIR, { recursive: true });
await writeFile(`${DATA_DIR}manifest.json`, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`\nwrote data/manifest.json`);

console.log("\n== Discovery complete ==");
for (const [name, data] of Object.entries(byCampaign)) {
  console.log(`${name}: ${JSON.stringify((data as { counts: unknown }).counts)}`);
}
console.log(`unique skills across campaigns: ${allSkills.size}`);
console.log(`unique monsters across campaigns: ${allMonsters.size}`);
if (failures.length > 0) {
  console.log(`FAILED pages (${failures.length}):`);
  for (const f of failures.slice(0, 40)) console.log(`  - ${f}`);
} else {
  console.log("all pages fetched and cached");
}
