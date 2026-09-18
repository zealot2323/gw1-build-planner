/**
 * Weekly crawl for new build codes:  npm run crawl
 *
 * Looks through recent Reddit posts and YouTube videos for template codes,
 * verifies each by decoding it against our skill data, and records it with
 * a link back to the source and the text around it.
 *
 * Credentials:
 *   - Reddit refuses anonymous reads (HTTP 403) from most hosts now, so set
 *     REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET from a Reddit "script" app;
 *     the crawl then uses an app-only OAuth token. Without them it still
 *     tries the public endpoints, which may work from a home IP.
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

/** The sentence(s) around a code — what the poster said about the build. */
function contextAround(text: string, code: string, limit = 400): string {
  const at = text.indexOf(code);
  if (at === -1) return text.slice(0, limit).trim();
  const paragraphs = text.split(/\n{2,}/);
  const para = paragraphs.find((p) => p.includes(code)) ?? text;
  const cleaned = para.replace(code, "").replace(/\s+/g, " ").trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit).trim()}…` : cleaned;
}

interface Found {
  code: string;
  source: BuildSource;
  name: string;
}

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------

async function crawlReddit(index: DataIndex, since: number): Promise<{ found: Found[]; issues: string[] }> {
  const found: Found[] = [];
  const issues: string[] = [];

  let token: string | null = null;
  try {
    token = await redditToken();
  } catch (err) {
    issues.push((err as Error).message);
  }
  if (!token) {
    issues.push(
      "reddit: no REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET, falling back to public endpoints (usually 403)",
    );
  }
  const host = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const auth: Record<string, string> = token ? { Authorization: `bearer ${token}` } : {};

  for (const sub of SUBREDDITS) {
    for (const listing of ["new", "hot"]) {
      const url = `${host}/r/${sub}/${listing}${token ? "" : ".json"}?limit=100&raw_json=1`;
      let body: any;
      try {
        const res = await politeFetch(url, auth);
        if (!res.ok) {
          // 403/429 here means Reddit is refusing the read, which is worth
          // reporting rather than silently finding nothing.
          issues.push(`reddit r/${sub}/${listing}: HTTP ${res.status}`);
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
            name: String(post.title ?? "Reddit build").slice(0, 120),
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
            name: String(snippet.title ?? "YouTube build").slice(0, 120),
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

const builds: CommunityBuild[] = [];
for (const { code, source, name } of [...reddit.found, ...youtube.found]) {
  const decoded = extractTemplateCodes(code, index)[0]?.decoded;
  if (!decoded) continue;
  builds.push(toCommunityBuild(code, decoded, source, name));
}

const { builds: merged, added, updated } = mergeCommunityBuilds(await loadCommunityBuilds(), builds);
await saveCommunityBuilds(merged);

console.log(`\n${added} new build(s), ${updated} updated; ${merged.length} total`);
for (const issue of [...reddit.issues, ...youtube.issues]) console.log(`  NOTE: ${issue}`);
