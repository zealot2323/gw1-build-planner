/**
 * Weekly crawl for new build codes:  npm run crawl
 *
 * Looks through recent Reddit posts and YouTube videos for template codes,
 * verifies each by decoding it against our skill data, and records it with
 * a link back to the source and the text around it.
 *
 * Credentials:
 *   - Reddit needs NONE. Its JSON API refuses anonymous reads (403), but the
 *     RSS feeds are public and carry everything we want: title, link,
 *     author, date and the full post body. RSS is rate-limited hard (429),
 *     so requests are spaced and retried.
 *     Setting REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET from a Reddit
 *     "script" app switches to the API instead, which adds each post's
 *     score — an upgrade, not a requirement.
 *   - YouTube needs YOUTUBE_API_KEY (YouTube Data API v3). Without it that
 *     half is skipped and says so, rather than failing the run.
 * Either half missing is reported, never silently treated as "found nothing".
 *
 * Everything found is other people's content: titles and post text are
 * stored verbatim, shown as quotes, and always next to their source link.
 */
import {
  extractTemplateCodes,
  mergeCommunityBuilds,
  toCommunityBuild,
  type BuildSource,
  type CommunityBuild,
  type DataIndex,
} from "@gw1/engine";
import { loadCommunityBuilds, loadIndex, saveCommunityBuilds } from "./community.js";

const USER_AGENT =
  "gw1-build-planner/1.0 (personal project; +https://github.com/zealot2323/gw1-build-planner)";
const MIN_INTERVAL_MS = 1000;
/** Subreddits worth reading for GW1 builds. */
const SUBREDDITS = ["GuildWars"];
/** What to ask YouTube for. */
const YOUTUBE_QUERIES = ["guild wars 1 build", "gw1 build template", "guild wars prophecies build"];
/** How far back a weekly job should look (a little over a week, for overlap). */
const LOOKBACK_DAYS = 10;

let lastRequestAt = 0;
async function politeFetch(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  return fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers } });
}

/**
 * App-only OAuth token for a Reddit "script" app. Returns null when no
 * credentials are configured, so the caller can fall back to the public
 * endpoints and report what happened.
 */
async function redditToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`reddit token: HTTP ${res.status}`);
  const body: any = await res.json();
  return body.access_token ?? null;
}

/**
 * The sentence(s) around a code — what the poster said about the build.
 * Every template code is stripped, not just this one: a video description
 * listing four bars would otherwise quote the other three codes back.
 */
function contextAround(text: string, code: string, limit = 400): string {
  const paragraphs = text.split(/\n{2,}/);
  const para = paragraphs.find((p) => p.includes(code)) ?? text;
  const cleaned = para
    .replace(/\bO[A-Za-z0-9+/]{9,}={0,2}/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*(?=$|\s)/g, "")
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit).trim()}…` : cleaned;
}

/** Keep a title readable, leaving room for a suffix. */
const shorten = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max).trim()}…`;

interface Found {
  code: string;
  source: BuildSource;
  name: string;
}

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------

/** Decode the handful of XML/HTML entities Reddit's feeds use. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Fetch with a couple of retries: Reddit's feeds 429 readily. */
async function fetchWithRetry(url: string, headers: Record<string, string> = {}): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await politeFetch(url, headers);
    if (res.status !== 429) return res;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  return null;
}

/** Posts from a subreddit's public RSS feed. No credentials needed. */
async function redditViaRss(index: DataIndex, since: number): Promise<{ found: Found[]; issues: string[] }> {
  const found: Found[] = [];
  const issues: string[] = [];
  for (const sub of SUBREDDITS) {
    for (const feed of ["new", "hot"]) {
      const url = `https://www.reddit.com/r/${sub}/${feed}.rss`;
      // the feeds 429 readily; give them more room than the global 1/s
      await new Promise((r) => setTimeout(r, 4000));
      let xml: string;
      try {
        const res = await fetchWithRetry(url);
        if (!res) {
          issues.push(`reddit r/${sub}/${feed}.rss: rate limited (429) after retries`);
          continue;
        }
        if (!res.ok) {
          issues.push(`reddit r/${sub}/${feed}.rss: HTTP ${res.status}`);
          continue;
        }
        xml = await res.text();
      } catch (err) {
        issues.push(`reddit r/${sub}/${feed}.rss: ${(err as Error).message}`);
        continue;
      }

      for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const title = stripTags(entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "");
        const link = entry.match(/<link href="([^"]+)"/)?.[1] ?? "";
        const author = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1]?.trim();
        const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
        if (published && new Date(published).getTime() < since) continue;
        const body = decodeEntities(entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "");
        const text = `${title}\n\n${stripTags(body)}`;

        for (const { code } of extractTemplateCodes(text, index)) {
          found.push({
            code,
            name: title || "Reddit build",
            source: {
              kind: "reddit",
              url: link,
              title: title.slice(0, 200),
              author: author ?? undefined,
              postedAt: published ? published.slice(0, 10) : undefined,
              context: contextAround(text, code),
              // RSS carries no score; the API path below has it
            },
          });
        }
      }
    }
  }
  return { found, issues };
}

/** Posts from the JSON API, which needs an app token but adds scores. */
async function redditViaApi(
  index: DataIndex,
  since: number,
  token: string,
): Promise<{ found: Found[]; issues: string[] }> {
  const found: Found[] = [];
  const issues: string[] = [];
  const auth: Record<string, string> = { Authorization: `bearer ${token}` };

  for (const sub of SUBREDDITS) {
    for (const listing of ["new", "hot"]) {
      const url = `https://oauth.reddit.com/r/${sub}/${listing}?limit=100&raw_json=1`;
      let body: any;
      try {
        const res = await fetchWithRetry(url, auth);
        if (!res || !res.ok) {
          issues.push(`reddit r/${sub}/${listing}: HTTP ${res?.status ?? "429 after retries"}`);
          continue;
        }
        body = await res.json();
      } catch (err) {
        issues.push(`reddit r/${sub}/${listing}: ${(err as Error).message}`);
        continue;
      }

      for (const child of body.data?.children ?? []) {
        const post = child.data ?? {};
        if (typeof post.created_utc === "number" && post.created_utc * 1000 < since) continue;
        const text = `${post.title ?? ""}\n\n${post.selftext ?? ""}`;
        for (const { code } of extractTemplateCodes(text, index)) {
          found.push({
            code,
            name: String(post.title ?? "Reddit build"),
            source: {
              kind: "reddit",
              url: `https://www.reddit.com${post.permalink ?? ""}`,
              title: String(post.title ?? "").slice(0, 200),
              author: post.author ? `u/${post.author}` : undefined,
              postedAt: post.created_utc
                ? new Date(post.created_utc * 1000).toISOString().slice(0, 10)
                : undefined,
              context: contextAround(text, code),
              score: typeof post.score === "number" ? post.score : undefined,
            },
          });
        }
      }
    }
  }
  return { found, issues };
}

/** RSS by default; the API when credentials happen to be configured. */
async function crawlReddit(index: DataIndex, since: number): Promise<{ found: Found[]; issues: string[] }> {
  let token: string | null = null;
  try {
    token = await redditToken();
  } catch (err) {
    return {
      found: [],
      issues: [`${(err as Error).message} — falling back to RSS`, ...(await redditViaRss(index, since)).issues],
    };
  }
  if (token) return redditViaApi(index, since, token);
  return redditViaRss(index, since);
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

async function crawlYouTube(
  index: DataIndex,
  since: Date,
  key: string,
): Promise<{ found: Found[]; issues: string[] }> {
  const found: Found[] = [];
  const issues: string[] = [];
  const ids: string[] = [];

  for (const query of YOUTUBE_QUERIES) {
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=25` +
      `&publishedAfter=${since.toISOString()}&q=${encodeURIComponent(query)}&key=${key}`;
    try {
      const res = await politeFetch(url);
      if (!res.ok) {
        issues.push(`youtube search "${query}": HTTP ${res.status}`);
        continue;
      }
      const body: any = await res.json();
      for (const item of body.items ?? []) if (item.id?.videoId) ids.push(item.id.videoId);
    } catch (err) {
      issues.push(`youtube search "${query}": ${(err as Error).message}`);
    }
  }

  // search snippets truncate the description; the codes live in the full one
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = [...new Set(ids.slice(i, i + 50))];
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics` +
      `&id=${chunk.join(",")}&key=${key}`;
    try {
      const res = await politeFetch(url);
      if (!res.ok) {
        issues.push(`youtube videos: HTTP ${res.status}`);
        continue;
      }
      const body: any = await res.json();
      for (const video of body.items ?? []) {
        const snippet = video.snippet ?? {};
        const text = `${snippet.title ?? ""}\n\n${snippet.description ?? ""}`;
        for (const { code } of extractTemplateCodes(text, index)) {
          found.push({
            code,
            name: String(snippet.title ?? "YouTube build"),
            source: {
              kind: "youtube",
              url: `https://www.youtube.com/watch?v=${video.id}`,
              title: String(snippet.title ?? "").slice(0, 200),
              author: snippet.channelTitle,
              postedAt: snippet.publishedAt ? String(snippet.publishedAt).slice(0, 10) : undefined,
              context: contextAround(text, code),
              score: video.statistics?.viewCount ? Number(video.statistics.viewCount) : undefined,
            },
          });
        }
      }
    } catch (err) {
      issues.push(`youtube videos: ${(err as Error).message}`);
    }
  }
  return { found, issues };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const index = await loadIndex();
const sinceDate = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
console.log(`looking for build codes posted since ${sinceDate.toISOString().slice(0, 10)}`);

const reddit = await crawlReddit(index, sinceDate.getTime());
console.log(`reddit: ${reddit.found.length} code(s)`);

const key = process.env.YOUTUBE_API_KEY;
const youtube = key
  ? await crawlYouTube(index, sinceDate, key)
  : { found: [], issues: ["youtube: skipped, YOUTUBE_API_KEY is not set"] };
console.log(`youtube: ${youtube.found.length} code(s)`);

// One video or post often shares several bars — a hero team, or two takes on
// the same role. They'd all inherit the same title, so add the professions
// when a single source yields more than one build.
const perSource = new Map<string, number>();
for (const { source } of [...reddit.found, ...youtube.found]) {
  const key = source.url ?? "";
  perSource.set(key, (perSource.get(key) ?? 0) + 1);
}

const builds: CommunityBuild[] = [];
const usedLabels = new Set<string>();
for (const { code, source, name } of [...reddit.found, ...youtube.found]) {
  const decoded = extractTemplateCodes(code, index)[0]?.decoded;
  if (!decoded) continue;
  // What tells two bars from the same video apart is usually the elite skill
  // — "Healer's Boon" vs "Unyielding Aura" — not the professions.
  const elite = decoded.skills.find((s) => s?.isElite)?.name;
  const professions = `${decoded.primary ?? "?"}${decoded.secondary ? `/${decoded.secondary}` : ""}`;
  let label =
    (perSource.get(source.url ?? "") ?? 0) > 1
      ? `${shorten(name, 70)} — ${elite ?? professions}`
      : shorten(name, 110);
  // a hero team can run the same elite twice ("Heal as One" on two rangers)
  if (usedLabels.has(label)) {
    let n = 2;
    while (usedLabels.has(`${label} (${n})`)) n++;
    label = `${label} (${n})`;
  }
  usedLabels.add(label);
  builds.push(toCommunityBuild(code, decoded, source, label));
}

const { builds: merged, added, updated } = mergeCommunityBuilds(await loadCommunityBuilds(), builds);
await saveCommunityBuilds(merged);

console.log(`\n${added} new build(s), ${updated} updated; ${merged.length} total`);
for (const issue of [...reddit.issues, ...youtube.issues]) console.log(`  NOTE: ${issue}`);
