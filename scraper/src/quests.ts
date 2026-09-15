/**
 * Quest discovery job:  npm run quests
 *
 * Quests are found the way monsters are — by following links out of pages
 * we already have, never by crawling a global list. Every quest that
 * rewards a skill is named on that skill's Acquisition section, so the
 * cached skill pages are the complete source of quest titles.
 *
 * The quest pages themselves are then fetched (cached, 1 req/s) because
 * their {{Quest infobox}} is authoritative where skill pages are not:
 * `given at` settles skill pages that disagree on the location, and
 * `profession`/`primary`/`secondary` say who can take the quest at all —
 * "Locate Jinzo" rewards Assassin skills but only to Assassin primaries.
 *
 * Also called at the end of discover.ts, so a full discovery includes it.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchWikitext, getCached } from "./client.js";
import { parseSkill } from "./parsers.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

/** Quest titles named on the given (cached) skill pages, sorted. */
export async function questTitlesFromSkills(skillTitles: string[]): Promise<string[]> {
  const quests = new Set<string>();
  for (const title of skillTitles) {
    const page = await getCached(title);
    if (!page) continue;
    for (const q of parseSkill(title, page.wikitext).entity.acquisition.quests) quests.add(q);
  }
  return [...quests].sort();
}

/**
 * Skill pages sometimes link a quest through a redirect ("Rally the
 * Recruits" -> "Rally the Recruits (Tutorial)") or a disambiguation page
 * ("Prenuptial Disagreement" has separate male and female versions).
 * Returns, per referenced title, the real quest page(s) behind it — fetching
 * them as it goes — so skills keep referencing the title they use.
 */
export async function resolveQuestSources(titles: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const title of titles) {
    const page = await getCached(title);
    if (!page) continue;
    const redirect = page.wikitext.match(/^#redirect\s*\[\[([^\]|#]+)/i);
    const variants = /\{\{\s*disambig/i.test(page.wikitext)
      ? [...page.wikitext.matchAll(/^\*.*?\[\[([^\]|#]+)/gm)].map((m) => m[1].trim())
      : [];
    const sources = redirect ? [redirect[1].trim()] : variants.length > 0 ? variants : [title];
    for (const src of sources) {
      if (src !== title) await fetchWikitext(src);
    }
    out[title] = sources;
  }
  return out;
}

/** Fetch every quest page; returns the titles that failed. */
export async function fetchQuests(titles: string[]): Promise<string[]> {
  const failed: string[] = [];
  let n = 0;
  for (const title of titles) {
    try {
      await fetchWikitext(title);
    } catch (err) {
      failed.push(`${title}: ${(err as Error).message}`);
    }
    if (++n % 25 === 0) console.log(`  quests: ${n}/${titles.length}`);
  }
  return failed;
}

// ---------------------------------------------------------------------------
// standalone: add quests to the existing manifest without re-running discovery
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(await readFile(`${DATA_DIR}manifest.json`, "utf8"));
  const skillTitles = [
    ...new Set(Object.values(manifest.byCampaign).flatMap((c: any) => c.skills as string[])),
  ];
  const quests = await questTitlesFromSkills(skillTitles);
  console.log(`${quests.length} quests named on ${skillTitles.length} skill pages`);
  const failed = await fetchQuests(quests);
  manifest.quests = quests;
  manifest.questSources = await resolveQuestSources(quests);
  await writeFile(`${DATA_DIR}manifest.json`, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`wrote manifest.quests (${quests.length})`);
  for (const f of failed) console.log(`  FAILED: ${f}`);
}
