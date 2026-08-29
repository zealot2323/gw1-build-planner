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

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

interface Manifest {
  skills: string[];
  locations: { towns: string[]; outposts: string[]; missionOutposts: string[]; explorables: string[] };
  trainers: string[];
  trainerSkillSubpages: string[];
  missions: string[];
  monsters: string[];
}

const manifest: Manifest = JSON.parse(await readFile(`${DATA_DIR}manifest.json`, "utf8"));

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
  const wt = await cachedWikitext("skills", title);
  if (wt === null) continue;
  const { entity, issues } = parseSkill(title, wt);
  for (const i of issues) addIssue("skills", title, i);
  skills.push(entity);
}
console.log(`skills: ${skills.length} parsed`);

// ---------------------------------------------------------------------------
// Parse trainers (from /Skills subpage, or inline block on the list page)
// ---------------------------------------------------------------------------

const trainerListWt = (await cachedWikitext("trainers", "List of Prophecies skill trainers")) ?? "";
const trainerLocations = new Map<string, string>();
for (const m of trainerListWt.matchAll(/^===\s*\[\[([^\]|]+)[^=]*?\]\]\s+in\s+\[\[([^\]|#]+)/gm)) {
  trainerLocations.set(m[1].trim(), m[2].trim());
}

const trainers: ParsedTrainer[] = [];
for (const name of manifest.trainers) {
  const sub = await getCached(`${name}/Skills`);
  let source = sub?.wikitext ?? null;
  if (source === null) {
    // inline {{Skill trainer list}} in this trainer's section of the list page
    const section = sections(trainerListWt).find((s) => s.title.startsWith(name));
    source = section?.body ?? null;
  }
  if (source === null) {
    addIssue("trainers", name, "no /Skills subpage and no inline list found");
    continue;
  }
  const { entity, issues } = parseTrainer(name, source, trainerLocations.get(name) ?? null);
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
}
console.log(`trainers: ${trainers.length} parsed`);

// ---------------------------------------------------------------------------
// Parse locations
// ---------------------------------------------------------------------------

const locationKinds: Array<[string[], string]> = [
  [manifest.locations.towns, "town"],
  [manifest.locations.outposts, "outpost"],
  [manifest.locations.missionOutposts, "mission-outpost"],
  [manifest.locations.explorables, "explorable"],
];
const locations: ParsedLocation[] = [];
for (const [titles, kind] of locationKinds) {
  for (const title of titles) {
    const wt = await cachedWikitext("locations", title);
    if (wt === null) continue;
    const { entity, issues } = parseLocation(title, wt, kind);
    for (const i of issues) addIssue("locations", title, i);
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
  missions.push(entity);
}
console.log(`missions: ${missions.length} parsed`);

// ---------------------------------------------------------------------------
// Parse monsters
// ---------------------------------------------------------------------------

const monsters: ParsedMonster[] = [];
for (const title of manifest.monsters) {
  const wt = await cachedWikitext("monsters", title);
  if (wt === null) continue;
  const { entity, issues } = parseMonster(title, wt);
  for (const i of issues) addIssue("monsters", title, i);
  monsters.push(entity);
}
console.log(`monsters: ${monsters.length} parsed (${monsters.filter((m) => m.isBoss).length} bosses)`);

// ---------------------------------------------------------------------------
// Cross-validation (report, don't fail — wiki data is inconsistent)
// ---------------------------------------------------------------------------

const skillByPage = new Map(skills.map((s) => [s.wikiPage, s]));
const locationNames = new Set(locations.map((l) => l.wikiPage));
const trainerByName = new Map(trainers.map((t) => [t.name, t]));

// trainer skills → parsed skills
for (const t of trainers) {
  for (const s of t.skillsOffered) {
    if (!skillByPage.has(s)) addIssue("cross-validation", t.name, `offers unknown skill "${s}"`);
  }
}

// skill trainer lists ↔ trainer offered lists (asymmetries only)
for (const skill of skills) {
  for (const trainerName of skill.acquisition.trainers) {
    const t = trainerByName.get(trainerName);
    if (!t) {
      addIssue("cross-validation", skill.wikiPage, `lists non-Prophecies/unknown trainer "${trainerName}"`);
    } else if (!t.skillsOffered.includes(skill.wikiPage)) {
      addIssue("cross-validation", skill.wikiPage, `says ${trainerName} sells it, but ${trainerName}'s list disagrees`);
    }
  }
}
for (const t of trainers) {
  for (const s of t.skillsOffered) {
    const skill = skillByPage.get(s);
    if (skill && !skill.acquisition.trainers.includes(t.name)) {
      addIssue("cross-validation", t.name, `offers "${s}" but that skill's page doesn't list this trainer`);
    }
  }
}

// monster skills → parsed skills (hard-mode-only were dropped at parse time)
for (const m of monsters) {
  for (const s of m.skills) {
    if (!skillByPage.has(s)) addIssue("cross-validation", m.wikiPage, `uses unparsed skill "${s}"`);
  }
  if (m.bossElite && !skillByPage.has(m.bossElite)) {
    addIssue("cross-validation", m.wikiPage, `boss elite "${m.bossElite}" is not a parsed skill`);
  }
}

// every elite has capture bosses, or is flagged
for (const s of skills) {
  if (s.isElite && s.acquisition.captureBosses.length === 0) {
    addIssue("cross-validation", s.wikiPage, "elite: no capture source parsed");
  }
}

// location neighbors resolve (try exact, then "(outpost)" disambiguation)
const resolveLocation = (name: string): string | null => {
  if (locationNames.has(name)) return name;
  if (locationNames.has(`${name} (outpost)`)) return `${name} (outpost)`;
  return null;
};
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
