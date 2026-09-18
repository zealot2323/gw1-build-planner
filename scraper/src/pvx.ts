/**
 * Import PvX wiki builds:  npm run pvx
 *
 * PvX (gwpvx.fandom.com) is the community's build archive. Rather than
 * crawl it page by page, this reads the dataset gw1tools/gw1builds already
 * maintains (MIT-licensed repo), then rebuilds each template code from the
 * skill ids with our own encoder, so every code is one we can decode back.
 *
 * The build CONTENT is PvX's, under CC BY-NC-SA: only the facts are taken
 * (name, professions, skills, attributes, rating, tags), each entry links
 * to its PvX page, and the site credits PvX. No prose is copied.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  decodeBuildCode,
  encodeTemplate,
  mergeCommunityBuilds,
  toCommunityBuild,
  type Build,
  type CommunityBuild,
  type Profession,
} from "@gw1/engine";
import { loadCommunityBuilds, loadIndex, saveCommunityBuilds } from "./community.js";

const SOURCE =
  "https://raw.githubusercontent.com/gw1tools/gw1builds/main/lib/data/pvx-builds.json";
const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

interface PvxBar {
  name?: string;
  primary?: string | null;
  secondary?: string | null;
  /** In-game skill ids, 8 of them; 0 = empty. */
  skills?: number[];
  template?: string;
  attributes?: Record<string, number>;
}
interface PvxBuild {
  id: string;
  name: string;
  url: string;
  /** PvX rating: "great", "good", "meta"... */
  status?: string;
  /** "single" or "team". */
  type?: string;
  tags?: string[];
  bars?: PvxBar[];
}

const index = await loadIndex();

console.log(`fetching PvX build data…`);
const res = await fetch(SOURCE, { headers: { "User-Agent": "gw1-build-planner (personal project)" } });
if (!res.ok) throw new Error(`PvX dataset: HTTP ${res.status}`);
const source: PvxBuild[] = await res.json();
console.log(`${source.length} PvX builds`);

// in-game skill id -> our skill page, so a bar of ids becomes a real build
const pageById = new Map<number, string>();
for (const skill of index.dataset.skills) {
  pageById.set(skill.gwSkillId, skill.wikiPage);
  for (const id of Object.values(skill.allegianceSkillIds ?? {})) pageById.set(id, skill.wikiPage);
}

const found: CommunityBuild[] = [];
const skipped: string[] = [];

for (const entry of source) {
  const bars = entry.bars ?? [];
  for (const [i, bar] of bars.entries()) {
    const ids = bar.skills ?? [];
    if (ids.filter((id) => id > 0).length < 3) {
      skipped.push(`${entry.name}: fewer than 3 skills`);
      continue;
    }
    const skills = ids.slice(0, 8).map((id) => (id > 0 ? (pageById.get(id) ?? null) : null));
    while (skills.length < 8) skills.push(null);

    const build: Build = {
      name: entry.name,
      character: "",
      primary: (bar.primary as Profession | null) ?? null,
      secondary: (bar.secondary as Profession | null) ?? null,
      attributes: bar.attributes ?? {},
      skills: skills as Build["skills"],
    } as Build;

    // Prefer a code we generate ourselves: PvX's own template field is
    // often empty, and ours is guaranteed to decode.
    let code: string;
    try {
      code = encodeTemplate(build, index);
    } catch {
      skipped.push(`${entry.name}: could not encode`);
      continue;
    }
    const decoded = decodeBuildCode(code, index);
    if (!decoded) {
      skipped.push(`${entry.name}: too few skills we recognise`);
      continue;
    }

    const name = bars.length > 1 && bar.name && bar.name !== entry.name ? `${entry.name} — ${bar.name}` : entry.name;
    // PvX says so itself: every multi-bar entry is type "team"
    const team =
      bars.length > 1
        ? {
            id: entry.id,
            name: entry.name,
            size: Math.min(bars.length, 9),
            kind: (entry.type === "team" ? "team" : "set") as "team" | "set",
          }
        : undefined;
    const tags = [...(entry.tags ?? []), ...(entry.status ? [entry.status] : [])];
    found.push(
      toCommunityBuild(
        code,
        decoded,
        {
          kind: "pvx",
          url: entry.url,
          title: entry.name,
          author: "PvX wiki contributors",
          // PvX's own rating is the useful context; their prose stays theirs
          context: entry.status ? `Rated "${entry.status}" on PvX${entry.type ? ` · ${entry.type} build` : ""}.` : undefined,
        },
        name,
        { tags, firstSeen: "2026-01-01", team },
      ),
    );
    if (i > 8) break; // a team build with dozens of bars isn't worth listing whole
  }
}

const { builds, added, updated } = mergeCommunityBuilds(await loadCommunityBuilds(), found);
await saveCommunityBuilds(builds);
await writeFile(
  `${DATA_DIR}community-sources.md`,
  `# Where community builds come from\n\n` +
    `- **PvX wiki** (<https://gwpvx.fandom.com/>) — build names, professions, skill bars,\n` +
    `  attributes, ratings and tags, each entry linking to its PvX page. PvX content is\n` +
    `  licensed CC BY-NC-SA 2.5; only these facts are used and no prose is copied. The\n` +
    `  dataset is read from gw1tools/gw1builds (MIT).\n` +
    `- **Reddit / YouTube** — found by the weekly crawl; the poster's own words are quoted\n` +
    `  and linked to the original.\n` +
    `- **Imported files** — whatever list is handed to \`npm run community\`.\n`,
  "utf8",
);

console.log(`\nimported ${found.length} bar(s): ${added} new, ${updated} updated`);
console.log(`data/community-builds.json now holds ${builds.length}`);
if (skipped.length > 0) {
  console.log(`\nskipped ${skipped.length}:`);
  for (const s of skipped.slice(0, 15)) console.log(`  ${s}`);
  if (skipped.length > 15) console.log(`  ...and ${skipped.length - 15} more`);
}
