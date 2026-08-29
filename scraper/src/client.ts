/**
 * MediaWiki API client for https://wiki.guildwars.com.
 *
 * Rules (see CLAUDE.md):
 * - NEVER scrape rendered HTML — always fetch raw wikitext via api.php.
 * - Max 1 request/second globally, descriptive User-Agent.
 * - Cache everything on disk (/scraper/cache, committed). A cached page is
 *   never refetched unless explicitly invalidated — the rescrape job is the
 *   post-patch update path (game updates show up as wiki edits).
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://wiki.guildwars.com/api.php";
const USER_AGENT = "gw1-build-planner-scraper (personal project)";
const MIN_INTERVAL_MS = 1000;

export const CACHE_DIR = fileURLToPath(new URL("../cache/", import.meta.url));

export interface WikiPage {
  title: string;
  pageid: number;
  revid: number;
  timestamp: string;
  wikitext: string;
}

// ---------------------------------------------------------------------------
// Rate-limited API access
// ---------------------------------------------------------------------------

let lastRequestAt = 0;
let requestChain: Promise<unknown> = Promise.resolve();

/** Global 1 req/s throttle: serializes all API calls through one chain. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const next = requestChain
    .catch(() => {}) // one failed request must not poison the chain
    .then(async () => {
      const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = Date.now();
      return fn();
    });
  requestChain = next;
  return next;
}

async function apiGet(params: Record<string, string>): Promise<any> {
  return throttled(async () => {
    const url = new URL(API);
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`wiki API HTTP ${res.status} for ${url}`);
    const body = await res.json();
    if (body.error) {
      throw new Error(`wiki API error: ${body.error.code} — ${body.error.info}`);
    }
    return body;
  });
}

// ---------------------------------------------------------------------------
// On-disk cache, keyed by page title
// ---------------------------------------------------------------------------

function cachePathFor(title: string): string {
  // encodeURIComponent is filesystem-safe and collision-free; the canonical
  // title is also stored inside the JSON, so filenames need not be decoded.
  return join(CACHE_DIR, `${encodeURIComponent(title)}.json`);
}

export async function getCached(title: string): Promise<WikiPage | null> {
  try {
    return JSON.parse(await readFile(cachePathFor(title), "utf8"));
  } catch {
    return null;
  }
}

export async function invalidateCache(title: string): Promise<void> {
  await rm(cachePathFor(title), { force: true });
}

export async function listCachedPages(): Promise<WikiPage[]> {
  let files: string[];
  try {
    files = await readdir(CACHE_DIR);
  } catch {
    return [];
  }
  const pages: WikiPage[] = [];
  for (const f of files.filter((f) => f.endsWith(".json")).sort()) {
    pages.push(JSON.parse(await readFile(join(CACHE_DIR, f), "utf8")));
  }
  return pages;
}

async function writeCache(page: WikiPage): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePathFor(page.title), JSON.stringify(page, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a page's current revision (raw wikitext + revision metadata).
 * Served from the on-disk cache when present; a cached page is never
 * refetched unless explicitly invalidated (see rescrape.ts).
 */
export async function fetchWikitext(title: string): Promise<WikiPage> {
  const cached = await getCached(title);
  if (cached) return cached;

  const body = await apiGet({
    action: "query",
    prop: "revisions",
    rvprop: "content|ids|timestamp",
    rvslots: "main",
    titles: title,
  });

  const page = body.query?.pages?.[0];
  if (!page || page.missing) throw new Error(`wiki page not found: "${title}"`);
  const rev = page.revisions?.[0];
  if (!rev) throw new Error(`no revisions returned for "${title}"`);

  const result: WikiPage = {
    title: page.title,
    pageid: page.pageid,
    revid: rev.revid,
    timestamp: rev.timestamp,
    wikitext: rev.slots.main.content,
  };
  await writeCache(result);
  return result;
}

/** List all members of a category (paginated via cmcontinue). */
export async function listCategoryMembers(category: string): Promise<string[]> {
  const cmtitle = category.startsWith("Category:") ? category : `Category:${category}`;
  const titles: string[] = [];
  let cmcontinue: string | undefined;

  do {
    const body = await apiGet({
      action: "query",
      list: "categorymembers",
      cmtitle,
      cmlimit: "500",
      ...(cmcontinue ? { cmcontinue } : {}),
    });
    for (const m of body.query?.categorymembers ?? []) titles.push(m.title);
    cmcontinue = body.continue?.cmcontinue;
  } while (cmcontinue);

  return titles;
}

/**
 * Batch-query the wiki's current revids for the given titles
 * (50 titles per request via titles=A|B|C). Titles the wiki no longer
 * has (deleted/moved) are absent from the returned map.
 */
export async function queryCurrentRevids(titles: string[]): Promise<Map<string, number>> {
  const revids = new Map<string, number>();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const body = await apiGet({
      action: "query",
      prop: "revisions",
      rvprop: "ids",
      titles: chunk.join("|"),
    });
    for (const page of body.query?.pages ?? []) {
      const revid = page.revisions?.[0]?.revid;
      if (!page.missing && typeof revid === "number") revids.set(page.title, revid);
    }
  }
  return revids;
}
