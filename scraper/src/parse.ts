/**
 * Parse job:  npm run parse
 *
 * Reads ONLY from the on-disk cache (no network), parses every page in
 * data/manifest.json, cross-validates references, and writes:
 *   data/skills.json, locations.json, trainers.json, monsters.json,
 *   missions.json, and validation-report.md.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getCached } from "./client.js";
import {
  parseLocation,
  parseMission,
  parseMonster,
  parseSkill,
  parseTrainer,
  type ParsedLocation,
  type ParsedMission,
  type ParsedMonster,
  type ParsedSkill,
  type ParsedTrainer,
} from "./parsers.js";
import { sections } from "./wikitext.js";
import {
  EXCLUDED_LOCATIONS,
  EXTRA_NEIGHBORS,
  LOCATION_ALIASES,
  TRAINER_EXTRA_SKILLS,
  EXTRA_EXPLORABLES,
  PRE_SEARING_LOCATIONS,
  isExcludedSkillPage,
  isPreSearingMonster,
} from "./overrides.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

interface CampaignManifest {
  skills: string[];
  locations: { towns: string[]; outposts: string[]; missionOutposts: string[]; explorables: string[] };
  trainers: string[];
  trainerSkillSubpages: string[];
  missions: string[];
  dungeons?: string[];
  monsters: string[];
}
interface Manifest {
  campaigns: string[];
  byCampaign: Record<string, CampaignManifest>;
}

const manifestFile: Manifest = JSON.parse(await readFile(`${DATA_DIR}manifest.json`, "utf8"));
const campaignNames = manifestFile.campaigns;

/** Union of a field across every campaign, first campaign wins on ties. */
function merged<K extends keyof CampaignManifest>(key: K): string[] {
  const seen = new Set<string>();
  for (const name of campaignNames) {
    for (const v of manifestFile.byCampaign[name][key] as string[]) seen.add(v);
  }
  return [...seen];
}
/**
 * Which campaign listed this page — used to tag parsed entities. `locations`
 * is an object of four arrays rather than one array, so it needs its own
 * lookup.
 */
function campaignOf(key: "skills" | "trainers" | "missions" | "monsters", page: string): string | undefined {
  for (const name of campaignNames) {
    if (manifestFile.byCampaign[name][key].includes(page)) return name;
  }
  return undefined;
}

function campaignOfLocation(page: string): string | undefined {
  for (const name of campaignNames) {
    const l = manifestFile.byCampaign[name].locations;
    if (
      l.towns.includes(page) ||
      l.outposts.includes(page) ||
      l.missionOutposts.includes(page) ||
      l.explorables.includes(page)
    ) {
      return name;
    }
  }
  return undefined;
}

const manifest: CampaignManifest = {
  skills: merged("skills"),
  locations: {
    towns: campaignNames.flatMap((n) => manifestFile.byCampaign[n].locations.towns),
    outposts: campaignNames.flatMap((n) => manifestFile.byCampaign[n].locations.outposts),
    missionOutposts: campaignNames.flatMap((n) => manifestFile.byCampaign[n].locations.missionOutposts),
    explorables: campaignNames.flatMap((n) => manifestFile.byCampaign[n].locations.explorables),
  },
  trainers: merged("trainers"),
  trainerSkillSubpages: merged("trainerSkillSubpages"),
  missions: merged("missions"),
  dungeons: campaignNames.flatMap((n) => manifestFile.byCampaign[n].dungeons ?? []),
  monsters: merged("monsters"),
};

/** issues per parser, keyed "Page title" -> [issue, ...] */
const report = new Map<string, Map<string, string[]>>();
function addIssue(parser: string, page: string, issue: string): void {
  if (!report.has(parser)) report.set(parser, new Map());
  const pages = report.get(parser)!;
  if (!pages.has(page)) pages.set(page, []);
  pages.get(page)!.push(issue);
}

async function cachedWikitext(parser: string, title: string): Promise<string | null> {
  const page = await getCached(title);
  if (!page) {
    addIssue(parser, title, "page missing from cache");
    return null;
  }
  return page.wikitext;
}

// ---------------------------------------------------------------------------
// Parse skills
// ---------------------------------------------------------------------------

const skills: ParsedSkill[] = [];
for (const title of manifest.skills) {
  if (isExcludedSkillPage(title)) continue;
  const wt = await cachedWikitext("skills", title);
  if (wt === null) continue;
  const { entity, issues } = parseSkill(title, wt);
  // Every real skill has an in-game id. Pages without one are title tracks
  // ("Norn rank") or effects ("Rebel Yell", which cannot be equipped) that
  // sit in the skill categories but are not skills.
  if (entity.gwSkillId === null) {
    addIssue("skills", title, "no in-game skill id — not a real skill, dropped");
    continue;
  }
  for (const i of issues) addIssue("skills", title, i);
  skills.push(entity);
}
console.log(`skills: ${skills.length} parsed`);

// ---------------------------------------------------------------------------
// Parse trainers (from /Skills subpage, or inline block on the list page)
// ---------------------------------------------------------------------------

const TRAINER_LIST_PAGES = campaignNames.map((c) => `List of ${c} skill trainers`);
let trainerListWt = "";
for (const page of TRAINER_LIST_PAGES) {
  trainerListWt += ((await getCached(page))?.wikitext ?? "") + "\n";
}
const trainerLocations = new Map<string, string>();
for (const m of trainerListWt.matchAll(/^===\s*\[\[([^\]|]+)[^=]*?\]\]\s+in\s+\[\[([^\]|#]+)/gm)) {
  trainerLocations.set(m[1].trim(), m[2].trim());
}

const trainers: ParsedTrainer[] = [];
for (const name of manifest.trainers) {
  // Prophecies trainers keep their stock on a "<Name>/Skills" subpage;
  // Factions and Nightfall trainers put {{Skill trainer list}} straight on
  // their own page under "Skills offered".
  const sub = await getCached(`${name}/Skills`);
  let source = sub?.wikitext ?? null;
  if (source === null) source = (await getCached(name))?.wikitext ?? null;
  if (source === null) {
    // inline {{Skill trainer list}} in this trainer's section of the list page
    const section = sections(trainerListWt).find((s) => s.title.startsWith(name));
    source = section?.body ?? null;
  }
  if (source === null) {
    addIssue("trainers", name, "no /Skills subpage and no inline list found");
    continue;
  }
  const listLocation = trainerLocations.get(name) ?? null;
  const { entity, issues } = parseTrainer(
    name,
    source,
    listLocation ? (LOCATION_ALIASES[listLocation] ?? listLocation) : null,
  );
  for (const i of issues) addIssue("trainers", name, i);
  trainers.push(entity);
}
// Expand trainer markers now that all skills are parsed:
// - "all Prophecies and core" (Dakk): every non-elite skill of the 6 core
//   professions with campaign Prophecies or Core.
// - "inherits from previous trainers" (Master Scout Kiera): union of the
//   named trainers' offered lists.
const allNonElite = skills
  .filter((s) => !s.isElite && (s.campaign === "Prophecies" || s.campaign === "Core") && s.profession !== null)
  .map((s) => s.wikiPage);
for (const t of trainers) {
  if (t.offersAllPropheciesAndCore) t.skillsOffered = [...allNonElite].sort();
}
for (const t of trainers) {
  if (!t.inheritsFrom) continue;
  const merged = new Set(t.skillsOffered);
  for (const source of t.inheritsFrom) {
    const other = trainers.find((o) => o.name === source);
    if (!other) {
      addIssue("trainers", t.name, `inherits from unknown trainer "${source}"`);
      continue;
    }
    for (const s of other.skillsOffered) merged.add(s);
  }
  t.skillsOffered = [...merged].sort();
}
for (const t of trainers) {
  delete t.offersAllPropheciesAndCore;
  delete t.inheritsFrom;
  for (const extra of TRAINER_EXTRA_SKILLS[t.name] ?? []) {
    if (!t.skillsOffered.includes(extra)) t.skillsOffered.push(extra);
  }
  t.skillsOffered.sort();
}

// Trainer lists are the SOURCE OF TRUTH for who sells a skill: rebuild each
// skill's acquisition.trainers from the trainer lists, overriding whatever
// the skill's own page claimed.
const offeredBy = new Map<string, string[]>();
for (const t of trainers) {
  for (const s of t.skillsOffered) {
    if (!offeredBy.has(s)) offeredBy.set(s, []);
    offeredBy.get(s)!.push(t.name);
  }
}
for (const s of skills) s.acquisition.trainers = offeredBy.get(s.wikiPage) ?? [];
console.log(`trainers: ${trainers.length} parsed`);

// ---------------------------------------------------------------------------
// Parse locations
// ---------------------------------------------------------------------------

const locationKinds: Array<[string[], string]> = [
  [manifest.locations.towns, "town"],
  [manifest.locations.outposts, "outpost"],
  [manifest.locations.missionOutposts, "mission-outpost"],
  [[...manifest.locations.explorables, ...EXTRA_EXPLORABLES], "explorable"],
  // Dungeons carry a Location infobox (region, exits, foes), so they parse
  // as locations rather than through the mission parser.
  [manifest.dungeons ?? [], "dungeon"],
];
const locations: ParsedLocation[] = [];
for (const [titles, kind] of locationKinds) {
  for (const title of titles) {
    if (EXCLUDED_LOCATIONS.has(title)) continue;
    const wt = await cachedWikitext("locations", title);
    if (wt === null) continue;
    const { entity, issues } = parseLocation(title, wt, kind);
    // exits name locations without the "(outpost)" disambiguator, so check
    // both forms against the exclusion list
    entity.neighbors = entity.neighbors.filter(
      (n) => !EXCLUDED_LOCATIONS.has(n) && !EXCLUDED_LOCATIONS.has(`${n} (outpost)`),
    );
    for (const extra of EXTRA_NEIGHBORS[title] ?? []) {
      if (!entity.neighbors.includes(extra)) entity.neighbors.push(extra);
    }
    if (PRE_SEARING_LOCATIONS.has(title)) entity.preSearing = true;
    entity.campaign = entity.campaign ?? campaignOfLocation(title) ?? null;
    for (const i of issues) {
      // manual progression edges satisfy the exits expectation
      if (i === "no exits in infobox" && entity.neighbors.length > 0) continue;
      addIssue("locations", title, i);
    }
    locations.push(entity);
  }
}
// attach trainers to the locations they stand in
for (const t of trainers) {
  const loc = locations.find((l) => l.wikiPage === t.location);
  if (loc) loc.trainer = t.name;
  else if (t.location) addIssue("trainers", t.name, `stands in unknown location "${t.location}"`);
}
console.log(`locations: ${locations.length} parsed`);

// ---------------------------------------------------------------------------
// Parse missions
// ---------------------------------------------------------------------------

const missionOutposts = new Set(manifest.locations.missionOutposts);
const missions: ParsedMission[] = [];
for (const title of manifest.missions) {
  const wt = await cachedWikitext("missions", title);
  if (wt === null) continue;
  const { entity, issues } = parseMission(title, wt);
  for (const i of issues) addIssue("missions", title, i);
  const outpost = missionOutposts.has(`${title} (outpost)`)
    ? `${title} (outpost)`
    : missionOutposts.has(title)
      ? title
      : null;
  if (outpost === null) addIssue("missions", title, "no matching mission outpost in manifest");
  entity.outpost = outpost;
  // Tag from the manifest rather than inferring from the outpost: a few
  // missions (Vizunah Square, Unwaking Waters) start from Kurzick/Luxon
  // outposts whose names don't follow the "<name> (outpost)" pattern, so
  // outpost resolution can't be the basis for campaign scoping.
  entity.campaign = campaignOf("missions", title) ?? null;
  missions.push(entity);
}
console.log(`missions: ${missions.length} parsed`);

// ---------------------------------------------------------------------------
// Parse monsters
// ---------------------------------------------------------------------------

// Issues we deliberately do NOT report (domain decisions):
// - no NPC infobox / no locations / no level: usually a species summary
//   page or a page layout variant — fine, keep what parsed.
// - boss with no elite: normal — plenty of bosses at every level carry no
//   elite. Capture coverage is checked from the elite side instead (see
//   cross-validation below).
const SUPPRESSED_MONSTER_ISSUES =
  /^(no NPC infobox|no locations parsed|no normal-mode level parsed|boss with no elite skill marked)$/;

const monsters: ParsedMonster[] = [];
const monsterAliases = new Map<string, string>(); // redirect name -> canonical name
let preSearingSkipped = 0;
for (const rawTitle of manifest.monsters) {
  let title = rawTitle;
  let wt = await cachedWikitext("monsters", title);
  if (wt === null) continue;
  // Foe lists sometimes link a redirect (e.g. the typo'd "Gren Waveslosh"
  // -> "Gren Wavelslosh"); follow it and parse under the canonical name.
  const redirect = wt.match(/^#REDIRECT\s*\[\[([^\]|#]+)/i);
  if (redirect) {
    const target = redirect[1].trim();
    monsterAliases.set(title, target);
    if (manifest.monsters.includes(target)) continue; // parsed on its own
    title = target;
    wt = await cachedWikitext("monsters", title);
    if (wt === null) continue;
  }
  const { entity, issues } = parseMonster(title, wt);
  // No hard-mode level listed => pre-Searing creature; out of scope for now.
  if (isPreSearingMonster(entity.levelRaw, entity.level)) {
    preSearingSkipped++;
    continue;
  }
  for (const i of issues) {
    if (SUPPRESSED_MONSTER_ISSUES.test(i)) continue;
    addIssue("monsters", title, i);
  }
  monsters.push(entity);
}
console.log(
  `monsters: ${monsters.length} parsed (${monsters.filter((m) => m.isBoss).length} bosses, ` +
    `${preSearingSkipped} pre-Searing skipped)`,
);

// ---------------------------------------------------------------------------
// Cross-validation (report, don't fail — wiki data is inconsistent)
// ---------------------------------------------------------------------------

// Re-point monster references (foe lists, capture bosses) that used a
// redirect page name at the canonical monster.
const resolveMonsterRef = (name: string): string => monsterAliases.get(name) ?? name;
for (const l of locations) {
  l.foes = [...new Set(l.foes.map(resolveMonsterRef))];
  l.bosses = [...new Set(l.bosses.map(resolveMonsterRef))];
}
for (const m of missions) {
  m.foes = [...new Set(m.foes.map(resolveMonsterRef))];
  m.bosses = [...new Set(m.bosses.map(resolveMonsterRef))];
}
for (const s of skills) {
  s.acquisition.captureBosses = [...new Set(s.acquisition.captureBosses.map(resolveMonsterRef))];
  if (s.acquisition.conditionalCaptureBosses) {
    s.acquisition.conditionalCaptureBosses = [
      ...new Set(s.acquisition.conditionalCaptureBosses.map(resolveMonsterRef)),
    ];
  }
  if (s.acquisition.captureLocations) {
    for (const [k, v] of Object.entries(s.acquisition.captureLocations)) {
      const canonical = resolveMonsterRef(k);
      if (canonical !== k) {
        s.acquisition.captureLocations[canonical] = v;
        delete s.acquisition.captureLocations[k];
      }
    }
  }
}

const skillByPage = new Map(skills.map((s) => [s.wikiPage, s]));
const locationNames = new Set(locations.map((l) => l.wikiPage));
const trainerByName = new Map(trainers.map((t) => [t.name, t]));

// trainer skills → parsed skills
for (const t of trainers) {
  for (const s of t.skillsOffered) {
    if (!skillByPage.has(s)) addIssue("cross-validation", t.name, `offers unknown skill "${s}"`);
  }
}

// (skill↔trainer asymmetries are no longer reported: trainer lists are the
// source of truth and skills' trainer lists are derived from them above.)

// monster skills → parsed skills (hard-mode-only and non-Prophecies
// campaign blocks were dropped at parse time). For a leftover unresolved
// ref, check the cache: a page whose infobox says another campaign is a
// known cross-campaign listing, not a problem.
async function classifyUnresolvedSkill(name: string): Promise<string | null> {
  if (isExcludedSkillPage(name)) return null; // monster-skill variants, by design
  const page = await getCached(name);
  const campaign = page?.wikitext.match(/\|\s*campaign\s*=\s*([^\n|]+)/)?.[1]?.trim();
  if (campaign && campaign !== "Prophecies" && campaign !== "Core") return null; // expected
  return campaign
    ? `uses "${name}" (${campaign}) — in scope but missing from the skill set, check discovery`
    : `uses unresolved skill "${name}" (not in cache — likely non-Prophecies or a monster skill)`;
}
for (const m of monsters) {
  for (const s of [...m.skills, ...(m.bossElite ? [m.bossElite] : [])]) {
    if (skillByPage.has(s)) continue;
    const issue = await classifyUnresolvedSkill(s);
    if (issue) addIssue("cross-validation", m.wikiPage, issue);
  }
}

const resolveLocation = (name: string): string | null => {
  if (locationNames.has(name)) return name;
  if (locationNames.has(`${name} (outpost)`)) return `${name} (outpost)`;
  return null;
};

// Capture coverage, checked from the skill side. First demote capture
// bosses whose stated spawn location isn't a known Prophecies location
// (War in Kryta area variants etc.) to conditional — they're unreachable
// in our model. What remains should exist in the bestiary and use the skill.
const monsterByPage = new Map(monsters.map((m) => [m.wikiPage, m]));
for (const s of skills) {
  const demoted: string[] = [];
  s.acquisition.captureBosses = s.acquisition.captureBosses.filter((bossName) => {
    if (monsterByPage.has(bossName)) return true;
    const loc = s.acquisition.captureLocations?.[bossName] ?? null;
    if (loc === null || resolveLocation(loc) === null) {
      demoted.push(bossName);
      return false;
    }
    return true;
  });
  if (demoted.length > 0) {
    s.acquisition.conditionalCaptureBosses = [
      ...(s.acquisition.conditionalCaptureBosses ?? []),
      ...demoted,
    ];
  }

  for (const bossName of s.acquisition.captureBosses) {
    const boss = monsterByPage.get(bossName);
    if (!boss) addIssue("cross-validation", s.wikiPage, `capture boss "${bossName}" is not in the bestiary`);
    else if (!boss.skills.includes(s.wikiPage)) {
      addIssue("cross-validation", s.wikiPage, `capture boss "${bossName}" doesn't list this skill`);
    }
  }
}

// every elite has capture bosses, or is flagged
for (const s of skills) {
  if (!s.isElite || s.acquisition.captureBosses.length > 0) continue;
  if ((s.acquisition.conditionalCaptureBosses?.length ?? 0) > 0) {
    addIssue("cross-validation", s.wikiPage, "elite: only quest-conditional capture sources");
  } else {
    addIssue("cross-validation", s.wikiPage, "elite: no capture source parsed");
  }
}

// location neighbors resolve (try exact, then "(outpost)" disambiguation)
for (const l of locations) {
  l.neighbors = l.neighbors.map((n) => {
    const resolved = resolveLocation(n);
    if (resolved === null) addIssue("cross-validation", l.wikiPage, `neighbor "${n}" is not a known location`);
    return resolved ?? n;
  });
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

const write = async (file: string, data: unknown) =>
  writeFile(`${DATA_DIR}${file}`, JSON.stringify(data, null, 2) + "\n", "utf8");
await write("skills.json", skills);
await write("locations.json", locations);
await write("trainers.json", trainers);
await write("monsters.json", monsters);
await write("missions.json", missions);

let md = `# Validation report\n\nGenerated ${new Date().toISOString()} by \`npm run parse\` (cache-only).\n`;
let totalIssues = 0;
for (const [parser, pages] of report) {
  const count = [...pages.values()].reduce((n, v) => n + v.length, 0);
  totalIssues += count;
  md += `\n## ${parser} (${count} issue${count === 1 ? "" : "s"} on ${pages.size} page${pages.size === 1 ? "" : "s"})\n\n`;
  for (const [page, issues] of [...pages].sort(([a], [b]) => a.localeCompare(b))) {
    for (const issue of issues) md += `- **${page}**: ${issue}\n`;
  }
}
if (totalIssues === 0) md += "\nNo issues. Suspicious — check the parsers ran at all.\n";
await writeFile(`${DATA_DIR}validation-report.md`, md, "utf8");

console.log(`\nwrote data/{skills,locations,trainers,monsters,missions}.json`);
console.log(`validation report: ${totalIssues} issues — see data/validation-report.md`);
