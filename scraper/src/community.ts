/**
 * Import community builds from a file:  npm run community -- <file> [--source pvx|file|other]
 *
 * The file can be JSON, CSV/TSV, or plain text. Whatever the shape, the
 * template code is the thing that identifies a build, so codes are found
 * and VERIFIED by decoding them against our skill data — a row whose code
 * doesn't decode is reported, never imported.
 *
 * Accepted shapes:
 *   - JSON array of objects with a code field (code/template/build) and any
 *     of name/title, author, url/source, tags, notes/description.
 *   - JSON array of bare code strings.
 *   - CSV/TSV with a header row naming those same columns.
 *   - Anything else: every template code found in the text, one build each.
 *
 * Existing entries keep their first-seen date; re-importing is safe.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  decodeBuildCode,
  extractTemplateCodes,
  indexDataset,
  mergeCommunityBuilds,
  toCommunityBuild,
  type BuildSource,
  type BuildSourceKind,
  type CommunityBuild,
  type CommunityBuildsFile,
  type Dataset,
} from "@gw1/engine";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

export async function loadIndex() {
  const read = async (f: string) => JSON.parse(await readFile(`${DATA_DIR}${f}`, "utf8"));
  return indexDataset({
    skills: await read("skills.json"),
    locations: await read("locations.json"),
    trainers: await read("trainers.json"),
    monsters: await read("monsters.json"),
    missions: await read("missions.json"),
    quests: await read("quests.json"),
  } as Dataset);
}

export async function loadCommunityBuilds(): Promise<CommunityBuild[]> {
  try {
    const file: CommunityBuildsFile = JSON.parse(await readFile(`${DATA_DIR}community-builds.json`, "utf8"));
    return file.builds ?? [];
  } catch {
    return [];
  }
}

export async function saveCommunityBuilds(builds: CommunityBuild[]): Promise<void> {
  // newest first, so the file reads like the page does
  const sorted = [...builds].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.name.localeCompare(b.name));
  const file: CommunityBuildsFile = { generatedAt: new Date().toISOString(), builds: sorted };
  await writeFile(`${DATA_DIR}community-builds.json`, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/** Split a CSV/TSV line, honouring "quoted, fields". */
function splitRow(line: string, sep: string): string[] {
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
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

interface RawRow {
  code?: string;
  name?: string;
  author?: string;
  url?: string;
  tags?: string[];
  notes?: string;
  /** Whole-row text, so a code can still be found if no column named one. */
  text: string;
}

const pick = (row: Record<string, string>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const hit = Object.entries(row).find(([k]) => k.toLowerCase().replace(/[^a-z]/g, "") === key);
    if (hit && hit[1]) return hit[1];
  }
  return undefined;
};

/** Read whatever the file is into rows we can look for codes in. */
export function parseImportFile(content: string): RawRow[] {
  const trimmed = content.trim();

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const list: unknown[] = Array.isArray(parsed) ? parsed : (parsed.builds ?? parsed.data ?? []);
    return list.map((entry) => {
      if (typeof entry === "string") return { code: entry, text: entry };
      const row = entry as Record<string, string>;
      const flat = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")]));
      const rawTags = (row as unknown as { tags?: unknown }).tags;
      const tags = Array.isArray(rawTags)
        ? rawTags.map(String)
        : pick(flat, "tags")?.split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
      return {
        code: pick(flat, "code", "template", "templatecode", "build", "buildcode"),
        name: pick(flat, "name", "title", "buildname"),
        author: pick(flat, "author", "creator", "by", "channel", "user"),
        url: pick(flat, "url", "link", "source", "sourceurl"),
        tags,
        notes: pick(flat, "notes", "description", "context", "comment", "summary"),
        text: JSON.stringify(row),
      };
    });
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== "");
  const sep = lines[0]?.includes("\t") ? "\t" : ",";
  const header = lines[0] ? splitRow(lines[0], sep) : [];
  const looksTabular =
    header.length > 1 && header.some((h) => /^(code|template|build|name|title|url|link|author)$/i.test(h.trim()));

  if (looksTabular) {
    return lines.slice(1).map((line) => {
      const cells = splitRow(line, sep);
      const row: Record<string, string> = {};
      header.forEach((h, i) => (row[h] = cells[i] ?? ""));
      return {
        code: pick(row, "code", "template", "templatecode", "build", "buildcode"),
        name: pick(row, "name", "title", "buildname"),
        author: pick(row, "author", "creator", "by", "channel", "user"),
        url: pick(row, "url", "link", "source", "sourceurl"),
        tags: pick(row, "tags")?.split(/[;|]/).map((t) => t.trim()).filter(Boolean),
        notes: pick(row, "notes", "description", "context", "comment", "summary"),
        text: line,
      };
    });
  }

  // plain text: one row per line keeps any surrounding words as context
  return lines.map((line) => ({ text: line, notes: line }));
}

// ---------------------------------------------------------------------------
// main — only when run directly; crawl.ts imports the helpers above
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await importFromFile();
}

async function importFromFile(): Promise<void> {
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const sourceKind = ((): BuildSourceKind => {
  const i = args.indexOf("--source");
  const value = i === -1 ? "file" : args[i + 1];
  return (["file", "pvx", "reddit", "youtube", "other"] as const).includes(value as BuildSourceKind)
    ? (value as BuildSourceKind)
    : "file";
})();

if (!file) {
  console.error("usage: npm run community -- <file> [--source file|pvx|other]");
  process.exit(1);
}

const index = await loadIndex();
const rows = parseImportFile(await readFile(file, "utf8"));
console.log(`${rows.length} row(s) in ${file}`);

const found: CommunityBuild[] = [];
const rejected: string[] = [];
for (const row of rows) {
  // a named code column is authoritative; otherwise scan the row's text
  const candidates = row.code
    ? [{ code: row.code.trim(), decoded: decodeBuildCode(row.code.trim(), index) }]
    : extractTemplateCodes(row.text, index).map((f) => ({ code: f.code, decoded: f.decoded }));

  const usable = candidates.filter((c) => c.decoded !== null);
  if (usable.length === 0) {
    rejected.push(row.code ?? row.name ?? row.text.slice(0, 60));
    continue;
  }
  for (const { code, decoded } of usable) {
    const source: BuildSource = {
      kind: sourceKind,
      ...(row.url ? { url: row.url } : {}),
      ...(row.author ? { author: row.author } : {}),
      ...(row.notes ? { context: row.notes } : {}),
    };
    const name = row.name?.trim() || `${decoded!.primary}${decoded!.secondary ? `/${decoded!.secondary}` : ""} build`;
    found.push(toCommunityBuild(code, decoded!, source, name, { tags: row.tags }));
  }
}

const { builds, added, updated } = mergeCommunityBuilds(await loadCommunityBuilds(), found);
await saveCommunityBuilds(builds);

console.log(`imported ${found.length} build(s): ${added} new, ${updated} updated`);
console.log(`data/community-builds.json now holds ${builds.length}`);
if (rejected.length > 0) {
  console.log(`\n${rejected.length} row(s) had no usable template code:`);
  for (const r of rejected.slice(0, 20)) console.log(`  ${r}`);
  if (rejected.length > 20) console.log(`  ...and ${rejected.length - 20} more`);
}
}
