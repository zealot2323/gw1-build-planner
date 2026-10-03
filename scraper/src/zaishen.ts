/**
 * Zaishen daily rotations:  npm run zaishen
 *
 * The Zaishen Mission and Bounty rotate on fixed cycles the wiki computes
 * from a unix epoch: `(t - epoch) / 86400 mod N`. Both epochs sit at 16:00
 * UTC, which is when the dailies actually roll over, so the arithmetic
 * needs no special-casing. Scraping the two cycle templates once therefore
 * gives every past and future day — this job never needs to run daily.
 *
 * Each entry is resolved to the place a character must have unlocked:
 *   - a mission → its outpost, from our own mission data;
 *   - an Eye of the North story quest (the rotation has 11, and EotN has no
 *     missions) → the quest infobox's "given at";
 *   - a bounty → the area named on its Zaishen quest page, then the nearest
 *     town or outpost by walking our location graph. Dungeons resolve to the
 *     outpost nearest their entrance, which is what the owner asked for.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchWikitext } from "./client.js";
import { parseQuest } from "./parsers.js";
import { loadIndex } from "./community.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

interface Rotation {
  epoch: number;
  mod: number;
  raw: string[];
}

/** Read `{{#switch: {{#expr: (t - EPOCH)/86400 mod N}} | 0 = … }}`. */
async function rotation(page: string): Promise<Rotation> {
  const wikitext = (await fetchWikitext(page)).wikitext;
  const epoch = Number(/-\s*(\d{9,})\s*\)/.exec(wikitext)?.[1]);
  const mod = Number(/mod\s+(\d+)/.exec(wikitext)?.[1]);
  if (!epoch || !mod) throw new Error(`${page}: could not read the cycle's epoch or length`);
  const byIndex = new Map<number, string>();
  for (const m of wikitext.matchAll(/^\|\s*(\d+)\s*=\s*(.+?)\s*$/gm)) {
    byIndex.set(Number(m[1]), m[2].trim());
  }
  const raw: string[] = [];
  for (let i = 0; i < mod; i++) {
    const value = byIndex.get(i);
    if (!value) throw new Error(`${page}: cycle position ${i} is missing`);
    raw.push(value);
  }
  return { epoch, mod, raw };
}

const index = await loadIndex();
const issues: string[] = [];

// --- adjacency over our own locations, for "nearest outpost" ----------------
const adjacency = new Map<string, Set<string>>();
const link = (a: string, b: string) => {
  if (!adjacency.has(a)) adjacency.set(a, new Set());
  adjacency.get(a)!.add(b);
};
for (const loc of index.dataset.locations) {
  for (const n of loc.neighbors) {
    if (!index.locationByPage.has(n)) continue;
    link(loc.wikiPage, n);
    link(n, loc.wikiPage);
  }
}
for (const mission of index.dataset.missions ?? []) {
  if (!mission.outpost) continue;
  link(mission.wikiPage, mission.outpost);
  link(mission.outpost, mission.wikiPage);
}

/** MediaWiki titles ignore the case of the first letter: "the Deep" is "The Deep". */
const normalizeTitle = (name: string): string => (name ? name[0].toUpperCase() + name.slice(1) : name);

const isOutpost = (name: string): boolean => {
  const kind = index.locationByPage.get(name)?.kind;
  return kind === "town" || kind === "outpost" || kind === "mission-outpost";
};

/** Nearest town/outpost to an area, by hops over the location graph. */
function nearestOutpost(from: string): { outpost: string; hops: number } | null {
  if (!index.locationByPage.has(from) && !index.missionByName.has(from)) return null;
  if (isOutpost(from)) return { outpost: from, hops: 0 };
  const seen = new Set([from]);
  let frontier = [from];
  for (let hops = 1; hops <= 6 && frontier.length > 0; hops++) {
    const next: string[] = [];
    for (const here of frontier) {
      for (const neighbour of adjacency.get(here) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        if (isOutpost(neighbour)) return { outpost: neighbour, hops };
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return null;
}

/** Outposts whose page name starts with this one — the Kurzick/Luxon and
 *  Foreign/Local quarter pairs, and "<Area> (outpost)" for elite areas. */
const sameNameOutposts = (name: string): string[] => {
  const pattern = new RegExp(`^${normalizeTitle(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`, "i");
  return index.dataset.locations.filter((l) => isOutpost(l.wikiPage) && pattern.test(l.wikiPage)).map((l) => l.wikiPage);
};

/**
 * Dungeon -> the explorable area its entrance sits in, from the Entrance
 * column of the wiki's dungeon table ("[[Charr Homelands]]: [[Sacnoth
 * Valley]]"). Our own dungeon records carry no exits, so this is the only
 * structured link from a dungeon back to the walkable world.
 */
async function dungeonEntrances(): Promise<Map<string, string>> {
  const wikitext = (await fetchWikitext("Dungeon")).wikitext;
  const out = new Map<string, string>();
  for (const row of wikitext.split("\n|-")) {
    const cells = row.split("||");
    const dungeon = /\[\[([^\]|#]+)/.exec(cells[1] ?? "")?.[1]?.trim();
    // the entrance cell reads "[[Region]]: [[Explorable]]" — take the last link
    const entranceCell = cells[5] ?? "";
    const links = [...entranceCell.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
    const entrance = links.reverse().find((l) => index.locationByPage.has(l));
    if (dungeon && entrance) out.set(dungeon, entrance);
  }
  return out;
}

/** Follow a redirect, if the page is one. */
async function resolveRedirect(title: string): Promise<string> {
  try {
    const page = await fetchWikitext(title);
    const target = /^#redirect\s*\[\[([^\]|#]+)/i.exec(page.wikitext.trim())?.[1];
    return target ? target.trim() : title;
  } catch {
    return title;
  }
}

/** Outposts named in a page's "Getting there" section — how you reach the
 *  elite realms, which have no exits in our data at all. */
async function gettingThereOutposts(title: string): Promise<string[]> {
  try {
    const wikitext = (await fetchWikitext(title)).wikitext;
    const section = /==\s*(?:Getting there|Access|Entry)\s*==([\s\S]{0,1200})/i.exec(wikitext)?.[1];
    if (!section) return [];
    const found = [...section.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()).filter(isOutpost);
    return [...new Set(found)];
  } catch {
    return [];
  }
}

const entrances = await dungeonEntrances();
console.log(`dungeon entrances mapped: ${entrances.size}`);

/** Everything a character might need unlocked to reach this area. */
async function outpostsFor(
  rawArea: string,
  depth = 0,
): Promise<{ outposts: string[]; hops: number | null; via: string }> {
  const area = normalizeTitle(rawArea);
  const same = sameNameOutposts(area);
  if (isOutpost(area)) return { outposts: [area], hops: 0, via: "the outpost itself" };
  if (same.length > 0) return { outposts: same, hops: 0, via: "outpost of the same name" };

  const entrance = entrances.get(area);
  if (entrance) {
    const near = nearestOutpost(entrance);
    if (near) return { outposts: [near.outpost], hops: near.hops, via: `dungeon entrance in ${entrance}` };
  }

  const direct = nearestOutpost(area);
  if (direct) return { outposts: [direct.outpost], hops: direct.hops, via: "nearest on the map" };

  const canonical = await resolveRedirect(area);
  if (canonical !== area) {
    const viaRedirect = await outpostsFor(canonical, depth);
    if (viaRedirect.outposts.length > 0) return { ...viaRedirect, via: `${viaRedirect.via} (via ${canonical})` };
  }

  const gettingThere = await gettingThereOutposts(canonical);
  if (gettingThere.length > 0) return { outposts: gettingThere, hops: null, via: "listed under Getting there" };

  // A sub-area of an elite realm ("Stygian Veil", "the Forge Heart") has no
  // entrance of its own; the realm it belongs to does, and the page's first
  // lines name it. One level up only, to stay out of link loops.
  if (depth === 0) {
    try {
      const wikitext = (await fetchWikitext(canonical)).wikitext;
      const lead = wikitext.split(/\n==/)[0];
      for (const m of lead.matchAll(/\[\[([^\]|#]+)/g)) {
        const parent = m[1].trim();
        if (parent === canonical || parent === area) continue;
        const viaParent = await outpostsFor(parent, 1);
        if (viaParent.outposts.length > 0) {
          return { ...viaParent, via: `${viaParent.via} (${parent})` };
        }
      }
    } catch {
      // page missing: nothing more to try
    }
  }

  return { outposts: [], hops: null, via: "unresolved" };
}

// --- missions ---------------------------------------------------------------
const zMission = await rotation("Template:Cycle/ZMission");
const missions = [];
for (const name of zMission.raw) {
  const mission = index.missionByName.get(name);
  if (mission) {
    // the Kurzick/Luxon and Foreign/Local missions have no single outpost
    const outposts = mission.outpost ? [mission.outpost] : sameNameOutposts(name);
    if (outposts.length === 0) issues.push(`${name}: mission has no outpost`);
    missions.push({ name, kind: "mission" as const, area: name, outposts });
    continue;
  }
  // Eye of the North story quests: the rotation lists them like missions
  try {
    let page = await fetchWikitext(name);
    let { entity } = parseQuest(name, page.wikitext);
    if (entity.givenAt.length === 0) {
      // disambiguation or a differently-titled page: "G.O.L.E.M. (quest)"
      const alternative = /^#redirect\s*\[\[([^\]|#]+)/i.exec(page.wikitext.trim())?.[1]?.trim() ?? `${name} (quest)`;
      try {
        page = await fetchWikitext(alternative);
        entity = parseQuest(alternative, page.wikitext).entity;
      } catch {
        // keep the original parse
      }
    }
    const given = entity.givenAt[0] ?? null;
    const resolved = given ? await outpostsFor(given) : { outposts: [], hops: null, via: "no given-at" };
    if (resolved.outposts.length === 0) issues.push(`${name}: no outpost (given at ${given ?? "?"})`);
    missions.push({ name, kind: "quest" as const, area: given, outposts: resolved.outposts });
  } catch (err) {
    issues.push(`${name}: ${(err as Error).message}`);
    missions.push({ name, kind: "quest" as const, area: null, outposts: [] });
  }
}

// --- bounties ---------------------------------------------------------------
const zBounty = await rotation("Template:Cycle/ZBounty");
const bounties = [];
for (const boss of zBounty.raw) {
  /** Candidate areas, best first: the quest page's own words, then ours. */
  const candidates: string[] = [];
  try {
    const page = await fetchWikitext(`${boss} (Zaishen quest)`);
    const lead = page.wikitext.split(/==\s*Quest information/)[0].replace(/\{\{[^}]*\}\}/g, "");
    const objectives = /===\s*Objectives\s*===([\s\S]{0,400})/.exec(page.wikitext)?.[1] ?? "";
    for (const text of [lead, objectives]) {
      for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) candidates.push(m[1].trim());
    }
  } catch (err) {
    issues.push(`${boss}: ${(err as Error).message}`);
  }
  for (const l of index.monsterByPage.get(boss)?.locations ?? []) candidates.push(l);

  let area: string | null = null;
  let outposts: string[] = [];
  let hops: number | null = null;
  let via = "unresolved";
  for (const candidate of candidates) {
    if (candidate === boss || candidate === "Hard Mode") continue;
    const resolved = await outpostsFor(candidate);
    if (resolved.outposts.length > 0) {
      area = candidate;
      outposts = resolved.outposts;
      hops = resolved.hops;
      via = resolved.via;
      break;
    }
  }
  if (outposts.length === 0) issues.push(`${boss}: no outpost found (tried ${candidates.slice(0, 4).join(", ") || "nothing"})`);
  bounties.push({ boss, area, outposts, hops, via });
}

await writeFile(
  `${DATA_DIR}zaishen.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      missions: { epoch: zMission.epoch, mod: zMission.mod, items: missions },
      bounties: { epoch: zBounty.epoch, mod: zBounty.mod, items: bounties },
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(`missions: ${missions.length} (${missions.filter((m) => m.outposts.length > 0).length} with an outpost)`);
console.log(`bounties: ${bounties.length} (${bounties.filter((b) => b.outposts.length > 0).length} with an outpost)`);
console.log(`wrote data/zaishen.json`);
if (issues.length) {
  console.log(`\n${issues.length} unresolved:`);
  for (const i of issues) console.log(`  ${i}`);
}
