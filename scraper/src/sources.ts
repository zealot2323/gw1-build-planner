/**
 * Import builds from fixed web sources:  npm run sources
 *
 * Unlike the weekly crawl (which sweeps Reddit and YouTube for whatever is
 * new), these are specific pages and spreadsheets someone curates. Add one
 * to SOURCES below.
 *
 * Two shapes are handled:
 *   - Google Sheets: every tab is exported as CSV. A row needs a template
 *     code in some column; Name and Guide columns are used when present.
 *   - Wiki pages (PvX): fetched through the MediaWiki API, because Fandom
 *     puts ?action=raw behind a Cloudflare challenge. Both template codes
 *     and {{mini skill bar|...}} listings are read — the latter name skills
 *     rather than carrying a code, so the code is encoded from them here.
 */
import {
  decodeBuildCode,
  encodeTemplate,
  extractMiniSkillBars,
  extractTemplateCodes,
  mergeCommunityBuilds,
  toCommunityBuild,
  type Build,
  type BuildSourceKind,
  type CommunityBuild,
  type DataIndex,
} from "@gw1/engine";
import { loadCommunityBuilds, loadIndex, saveCommunityBuilds } from "./community.js";

const USER_AGENT =
  "gw1-build-planner/1.0 (personal project; +https://github.com/zealot2323/gw1-build-planner)";

interface SheetSource {
  type: "google-sheet";
  id: string;
  label: string;
  kind: BuildSourceKind;
  url: string;
}
interface WikiSource {
  type: "wiki-page";
  api: string;
  page: string;
  label: string;
  kind: BuildSourceKind;
  url: string;
}
type Source = SheetSource | WikiSource;

const SOURCES: Source[] = [
  {
    type: "google-sheet",
    id: "1ocHlVsoILObUlsN6DfkCnqhsy5G2YtJj0988DTik3os",
    label: "Community build spreadsheet",
    kind: "other",
    url: "https://docs.google.com/spreadsheets/d/1ocHlVsoILObUlsN6DfkCnqhsy5G2YtJj0988DTik3os/edit",
  },
  {
    type: "wiki-page",
    api: "https://gwpvx.fandom.com/api.php",
    page: "User:Yung Rocks/Sandbox",
    label: "Yung Rocks' sandbox",
    kind: "pvx",
    url: "https://gwpvx.fandom.com/wiki/User:Yung_Rocks/Sandbox",
  },
];

let lastRequestAt = 0;
async function politeFetch(url: string): Promise<Response> {
  const wait = lastRequestAt + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  return fetch(url, { headers: { "User-Agent": USER_AGENT } });
}

/** Split a CSV line, honouring "quoted, fields". */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Every tab of a published sheet; the ids come from its htmlview page. */
async function sheetTabs(id: string): Promise<string[]> {
  const res = await politeFetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`);
  if (!res.ok) return ["0"];
  const html = await res.text();
  const gids = [...new Set([...html.matchAll(/gid=(\d+)/g)].map((m) => m[1]))];
  return gids.length > 0 ? gids : ["0"];
}

async function fromSheet(source: SheetSource, index: DataIndex): Promise<{ builds: CommunityBuild[]; issues: string[] }> {
  const builds: CommunityBuild[] = [];
  const issues: string[] = [];
  const gids = await sheetTabs(source.id);
  console.log(`  ${gids.length} tab(s)`);

  for (const gid of gids) {
    const res = await politeFetch(
      `https://docs.google.com/spreadsheets/d/${source.id}/export?format=csv&gid=${gid}`,
    );
    if (!res.ok) {
      issues.push(`${source.label} tab ${gid}: HTTP ${res.status}`);
      continue;
    }
    const lines = (await res.text()).split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    const header = splitCsv(lines[0]).map((h) => h.toLowerCase());
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const nameCol = col("name", "build name", "title");
    const guideCol = col("guide", "notes", "description");

    for (const line of lines.slice(1)) {
      const cells = splitCsv(line);
      const rowText = cells.join(" ");
      for (const { code, decoded } of extractTemplateCodes(rowText, index)) {
        const name = (nameCol >= 0 ? cells[nameCol] : "")?.trim();
        const guide = (guideCol >= 0 ? cells[guideCol] : "")?.trim();
        builds.push(
          toCommunityBuild(
            code,
            decoded,
            {
              kind: source.kind,
              url: `${source.url}#gid=${gid}`,
              title: source.label,
              author: source.label,
              ...(guide ? { context: guide } : {}),
            },
            name || `${decoded.primary}${decoded.secondary ? `/${decoded.secondary}` : ""} build`,
          ),
        );
      }
    }
  }
  return { builds, issues };
}

async function fromWikiPage(source: WikiSource, index: DataIndex): Promise<{ builds: CommunityBuild[]; issues: string[] }> {
  const builds: CommunityBuild[] = [];
  const issues: string[] = [];
  const url =
    `${source.api}?action=parse&page=${encodeURIComponent(source.page)}` +
    `&prop=wikitext&format=json&formatversion=2`;
  const res = await politeFetch(url);
  if (!res.ok) return { builds, issues: [`${source.label}: HTTP ${res.status}`] };
  const body: any = await res.json();
  const wikitext: string = body.parse?.wikitext ?? "";
  if (!wikitext) return { builds, issues: [`${source.label}: no wikitext returned`] };

  // codes, if the page has any
  for (const { code, decoded } of extractTemplateCodes(wikitext, index)) {
    builds.push(
      toCommunityBuild(
        code,
        decoded,
        { kind: source.kind, url: source.url, title: source.label, author: source.label },
        `${decoded.primary}${decoded.secondary ? `/${decoded.secondary}` : ""} build`,
      ),
    );
  }

  // and bars written out as skill names
  for (const bar of extractMiniSkillBars(wikitext, index)) {
    const known = bar.skills.filter(Boolean).length;
    if (known < 6) {
      issues.push(`${source.label}: "${bar.name ?? "unnamed"}" has only ${known}/8 skills we know`);
      continue;
    }
    const build: Build = {
      name: bar.name ?? "build",
      character: "",
      primary: bar.primary,
      secondary: bar.secondary,
      skills: bar.skills.map((s) => s?.wikiPage ?? null) as Build["skills"],
    } as Build;
    let code: string;
    try {
      code = encodeTemplate(build, index);
    } catch (err) {
      issues.push(`${source.label}: ${(err as Error).message}`);
      continue;
    }
    const decoded = decodeBuildCode(code, index);
    if (!decoded) continue;
    builds.push(
      toCommunityBuild(
        code,
        decoded,
        { kind: source.kind, url: source.url, title: source.label, author: source.label },
        bar.name ?? `${bar.primary}/${bar.secondary ?? "any"} build`,
      ),
    );
  }
  return { builds, issues };
}

// ---------------------------------------------------------------------------

const index = await loadIndex();
const all: CommunityBuild[] = [];
const issues: string[] = [];

for (const source of SOURCES) {
  console.log(`\n${source.label} (${source.type})`);
  const result = source.type === "google-sheet" ? await fromSheet(source, index) : await fromWikiPage(source, index);
  console.log(`  ${result.builds.length} build(s)`);
  all.push(...result.builds);
  issues.push(...result.issues);
}

const { builds, added, updated } = mergeCommunityBuilds(await loadCommunityBuilds(), all);
await saveCommunityBuilds(builds);
console.log(`\n${added} new, ${updated} updated; ${builds.length} total`);
for (const issue of issues.slice(0, 15)) console.log(`  NOTE: ${issue}`);
if (issues.length > 15) console.log(`  ...and ${issues.length - 15} more`);
