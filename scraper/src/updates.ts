/**
 * Game-update job:  npm run updates
 *
 * Builds /data/skill-changes.json — which skills the game has changed
 * recently, what each change said, and what the skill looked like before.
 *
 * Three wiki sources, all via the API, all cached (see CLAUDE.md):
 *  1. "Feedback:Game updates/YYYYMMDD" — the patch notes themselves. The
 *     index page "Game updates" is DPL-generated so its wikitext lists
 *     nothing; the per-year "<year> updates" categories are used instead.
 *  2. "<Skill>/Skill history" — dated {{Skill infobox}} snapshots of past
 *     versions. These LAG behind the patch notes (Frenzy was reworked in
 *     August 2026 and its history page still reads "unchanged"), so the
 *     snapshot is labelled with its own date rather than presented as the
 *     exact pre-change state.
 *  3. The changed skills' own pages, refetched when the wiki has a newer
 *     revision — otherwise the app would show a pre-patch skill as current
 *     while also reporting that it just changed.
 *
 * A wider window is cached than the app highlights, so narrowing or
 * widening the highlight is a code change, not a refetch.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  fetchWikitext,
  getCached,
  invalidateCache,
  listCategoryMembers,
  queryCurrentRevids,
} from "./client.js";
import {
  parseGameUpdate,
  parseSkillHistory,
  type ParsedSkillChange,
  type ParsedSkillVersion,
} from "./parsers.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
/** How much update history to cache. The app's highlight window is narrower. */
const WINDOW_MONTHS = 12;

const now = new Date();
const since = new Date(now);
since.setMonth(since.getMonth() - WINDOW_MONTHS);
const sinceISO = since.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// 1. Which update pages fall in the window
// ---------------------------------------------------------------------------

const years = new Set<number>();
for (let y = since.getUTCFullYear(); y <= now.getUTCFullYear(); y++) years.add(y);

const updatePages: string[] = [];
for (const year of [...years].sort()) {
  for (const title of await listCategoryMembers(`${year} updates`)) {
    const m = title.match(/^Feedback:Game updates\/(\d{4})(\d{2})(\d{2})$/);
    if (!m) continue; // the category also holds the year's own index page
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (date >= sinceISO) updatePages.push(title);
  }
}
updatePages.sort();
console.log(`${updatePages.length} update pages since ${sinceISO}`);

for (const title of updatePages) await fetchWikitext(title);

// ---------------------------------------------------------------------------
// 2. Parse them into per-skill changes
// ---------------------------------------------------------------------------

const issues: string[] = [];
const changes: ParsedSkillChange[] = [];
for (const title of updatePages) {
  const page = await getCached(title);
  if (!page) continue;
  const parsed = parseGameUpdate(page.title, page.wikitext);
  changes.push(...parsed.entity);
  for (const i of parsed.issues) issues.push(`${title}: ${i}`);
}

const skills: Array<{ name: string; wikiPage: string }> = JSON.parse(
  await readFile(`${DATA_DIR}skills.json`, "utf8"),
);
const known = new Set(skills.map((s) => s.wikiPage));

const inScope = changes.filter((c) => known.has(c.skill));
const unknown = [...new Set(changes.filter((c) => !known.has(c.skill)).map((c) => c.skill))];
console.log(`${changes.length} change records, ${inScope.length} on skills we have`);
if (unknown.length > 0) {
  // PvP-only splits and brand-new skills we never scraped — expected, but
  // worth printing so a real parse miss does not hide among them.
  console.log(`  not in the dataset (${unknown.length}): ${unknown.join(", ")}`);
}

const changedSkills = [...new Set(inScope.map((c) => c.skill))].sort();
console.log(`${changedSkills.length} distinct skills changed`);

// ---------------------------------------------------------------------------
// 3. Refresh the changed skills themselves (their cached page predates the patch)
// ---------------------------------------------------------------------------

const currentRevids = await queryCurrentRevids(changedSkills);
let refreshed = 0;
for (const title of changedSkills) {
  const cached = await getCached(title);
  const live = currentRevids.get(title);
  if (!cached || live === undefined || live === cached.revid) continue;
  await invalidateCache(title);
  await fetchWikitext(title);
  refreshed++;
  if (refreshed % 25 === 0) console.log(`  refreshed ${refreshed} skill pages...`);
}
console.log(`refreshed ${refreshed} stale skill page(s)`);

// ---------------------------------------------------------------------------
// 4. Fetch + parse the /Skill history subpages
// ---------------------------------------------------------------------------

const historyTitles = changedSkills.map((s) => `${s}/Skill history`);
const existing = await queryCurrentRevids(historyTitles); // absent = no such page
console.log(`${existing.size}/${historyTitles.length} skills have a /Skill history page`);

let fetched = 0;
for (const title of historyTitles) {
  if (!existing.has(title)) continue;
  const before = await getCached(title);
  await fetchWikitext(title);
  if (!before) fetched++;
  if (fetched > 0 && fetched % 25 === 0) console.log(`  fetched ${fetched} history pages...`);
}

// ---------------------------------------------------------------------------
// 5. Emit
// ---------------------------------------------------------------------------

interface SkillChangeRecord {
  skill: string;
  changes: Array<{ date: string; note: string; kind: string; section: string | null }>;
  previous: ParsedSkillVersion | null;
  previousIsStale: boolean;
}

const records: SkillChangeRecord[] = [];
for (const skill of changedSkills) {
  const mine = inScope
    .filter((c) => c.skill === skill)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ date, note, kind, section }) => ({ date, note, kind, section }));

  // Anchor on the newest BALANCE change: that is the one the app
  // highlights, and a later AI retune must not drag the "before" snapshot
  // forward past the balance change it is supposed to precede.
  const latest = (mine.find((c) => c.kind === "balance") ?? mine[0]).date;
  let previous: ParsedSkillVersion | null = null;
  let previousIsStale = false;

  const historyPage = await getCached(`${skill}/Skill history`);
  if (historyPage) {
    const { entity: versions, issues: hIssues } = parseSkillHistory(historyPage.title, historyPage.wikitext);
    for (const i of hIssues) issues.push(`${skill}/Skill history: ${i}`);
    // The version in force before the latest change: the newest snapshot
    // dated strictly before it ("Original" — undated — is the oldest).
    previous = versions.find((v) => v.date !== null && v.date < latest) ?? versions.find((v) => v.date === null) ?? null;
    if (previous) {
      // The wiki's history pages lag. If we recorded another change to this
      // skill between the snapshot and the latest one, the snapshot is older
      // than "immediately before" and must not be presented as such.
      const snapDate = previous.date ?? "";
      previousIsStale = mine.some((c) => c.date < latest && c.date > snapDate);
    }
  }
  records.push({ skill, changes: mine, previous, previousIsStale });
}

const withPrevious = records.filter((r) => r.previous !== null).length;
const stale = records.filter((r) => r.previousIsStale).length;

await writeFile(
  `${DATA_DIR}skill-changes.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      since: sinceISO,
      windowMonths: WINDOW_MONTHS,
      skills: records,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(`\nwrote data/skill-changes.json`);
console.log(`  ${records.length} skills, ${withPrevious} with a previous version (${stale} predate an intervening change)`);
if (issues.length > 0) {
  console.log(`  ${issues.length} parse issue(s):`);
  for (const i of issues.slice(0, 20)) console.log(`    ${i}`);
}
