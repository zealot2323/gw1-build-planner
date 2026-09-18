/**
 * Community builds: builds collected from elsewhere (a curated file, PvX,
 * Reddit, YouTube) rather than made by the player.
 *
 * Everything here is pure. Fetching lives in the scraper; this module
 * defines the shape, finds template codes in free text, and decides what
 * counts as a real build rather than a random base64-looking string.
 */
import { decodeTemplate, TemplateError, type DecodedTemplate } from "./template.js";
import type { DataIndex } from "./data.js";
import { Profession } from "./types.js";
import type { Campaign, Skill } from "./types.js";

/** Where a community build came from. */
export type BuildSourceKind = "file" | "pvx" | "reddit" | "youtube" | "other";

export interface BuildSource {
  kind: BuildSourceKind;
  /** Link to the post, video or page it came from. */
  url?: string;
  /** Post title, video title, or the name given in the import file. */
  title?: string;
  /** Redditor, channel, or build author. */
  author?: string;
  /** ISO date the source was published. */
  postedAt?: string;
  /**
   * The text around the code: what the poster said about the build. Kept
   * verbatim and shown as a quote — it's someone else's writing, not ours.
   */
  context?: string;
  /** Upvotes, views — whatever the platform counts. Used for "hot". */
  score?: number;
}

export interface CommunityBuild {
  /** Stable id: the template code, which is what actually identifies a build. */
  id: string;
  code: string;
  /** Display name, from the file or the source's title. */
  name: string;
  primary: Profession | null;
  secondary: Profession | null;
  /** Resolved skill page names; null = empty slot or a skill we don't have. */
  skills: Array<string | null>;
  attributes: Record<string, number>;
  /** Campaigns the build's skills come from — what you need to own to run it. */
  campaigns: Campaign[];
  /** Freeform tags from the import file (role, game mode, …). */
  tags?: string[];
  /**
   * Set when this bar is one of several that belong together — a PvX team
   * build, or a video/post that shared a whole hero setup. Only importers
   * that actually know this set it: rows of a spreadsheet share a URL
   * without being a team.
   */
  team?: {
    id: string;
    name: string;
    size: number;
    /**
     * `team` = bars meant to be run together (a PvX team build, a hero
     * setup). `set` = several builds that merely shared one source, like a
     * video comparing ten solo farmers.
     */
    kind: "team" | "set";
  };
  source: BuildSource;
  /** ISO date this entry first appeared in our data. */
  firstSeen: string;
}

export interface CommunityBuildsFile {
  generatedAt: string;
  builds: CommunityBuild[];
}

/**
 * Candidate template codes in a blob of text.
 *
 * Skill codes start with "O" and are base64 over [A-Za-z0-9+/], but so are
 * plenty of other strings, so a candidate only counts once it decodes into
 * something that looks like a build. That check is the whole filter —
 * matching on shape alone pulls in image ids and tracking parameters.
 */
export function extractTemplateCodes(
  text: string,
  index: DataIndex,
): Array<{ code: string; decoded: DecodedTemplate }> {
  const out: Array<{ code: string; decoded: DecodedTemplate }> = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\bO[A-Za-z0-9+/]{9,}={0,2}/g)) {
    const code = match[0];
    if (seen.has(code)) continue;
    seen.add(code);
    const decoded = decodeBuildCode(code, index);
    if (decoded) out.push({ code, decoded });
  }
  return out;
}

/**
 * Decode a code, returning null unless it's a usable PvE build: a real
 * primary profession and at least three skills we recognise. Junk strings
 * do sometimes decode into a shape the library accepts, and a "build" of
 * one unknown skill is not worth showing anyone.
 */
export function decodeBuildCode(code: string, index: DataIndex): DecodedTemplate | null {
  let decoded: DecodedTemplate;
  try {
    decoded = decodeTemplate(code, index);
  } catch (err) {
    if (err instanceof TemplateError) return null;
    throw err;
  }
  if (decoded.primary === null) return null;
  const known = decoded.skills.filter((s) => s !== null).length;
  if (known < 3) return null;
  return decoded;
}

/** Campaigns whose content a build needs, from the skills it uses. */
export function campaignsUsed(decoded: DecodedTemplate): Campaign[] {
  const order: Campaign[] = ["Prophecies", "Factions", "Nightfall", "Eye of the North"];
  const used = new Set<Campaign>();
  for (const skill of decoded.skills) {
    if (skill?.campaign && skill.campaign !== "Core") used.add(skill.campaign);
  }
  return order.filter((c) => used.has(c));
}

/** Build a CommunityBuild record from a decoded code plus its provenance. */
export function toCommunityBuild(
  code: string,
  decoded: DecodedTemplate,
  source: BuildSource,
  name: string,
  extras: { tags?: string[]; firstSeen?: string; team?: CommunityBuild["team"] } = {},
): CommunityBuild {
  return {
    id: code,
    code,
    name,
    primary: decoded.primary,
    secondary: decoded.secondary,
    skills: decoded.skills.map((s) => s?.wikiPage ?? null),
    attributes: decoded.attributes,
    campaigns: campaignsUsed(decoded),
    ...(extras.tags && extras.tags.length > 0 ? { tags: extras.tags } : {}),
    ...(extras.team ? { team: extras.team } : {}),
    source,
    firstSeen: extras.firstSeen ?? new Date().toISOString().slice(0, 10),
  };
}

/**
 * Merge newly found builds into the existing set, keyed by code. An
 * existing entry keeps its firstSeen date and its name — a curated name
 * beats a Reddit thread title — but takes the newer score.
 */
export function mergeCommunityBuilds(
  existing: CommunityBuild[],
  found: CommunityBuild[],
): { builds: CommunityBuild[]; added: number; updated: number } {
  const byId = new Map(existing.map((b) => [b.id, b]));
  let added = 0;
  let updated = 0;
  for (const build of found) {
    const prior = byId.get(build.id);
    if (!prior) {
      byId.set(build.id, build);
      added++;
      continue;
    }
    // curated entries are authoritative; crawled ones only refresh the score
    if (prior.source.kind === "file" || prior.source.kind === "pvx") {
      if (build.source.score !== undefined && build.source.score !== prior.source.score) {
        byId.set(build.id, { ...prior, source: { ...prior.source, score: build.source.score } });
        updated++;
      }
      continue;
    }
    byId.set(build.id, { ...build, firstSeen: prior.firstSeen, name: prior.name });
    updated++;
  }
  return { builds: [...byId.values()], added, updated };
}

/**
 * Wiki pages often list a bar as skill NAMES rather than a template code:
 *
 *   {{mini skill bar|Ebon Escape|Double Dragon|...}}
 *   {{E}}/{{R}}[[User:Yung Rocks/Sandbox/Ebon Dragon|Ebon Dragon]]
 *
 * The professions come from shorthand markers and the name from the link
 * that follows. Everything is resolved against our own skill data, so a bar
 * only counts when most of its skills are ones we know.
 */
const PROFESSION_SHORTHAND: Record<string, Profession> = {
  W: Profession.Warrior,
  R: Profession.Ranger,
  Mo: Profession.Monk,
  N: Profession.Necromancer,
  Me: Profession.Mesmer,
  E: Profession.Elementalist,
  A: Profession.Assassin,
  Rt: Profession.Ritualist,
  P: Profession.Paragon,
  D: Profession.Dervish,
};

export interface ParsedSkillBar {
  name: string | null;
  primary: Profession | null;
  secondary: Profession | null;
  /** Resolved skills, 8 entries; null = empty or unknown. */
  skills: Array<Skill | null>;
  /** Skill names the dataset has no match for. */
  unknownSkills: string[];
}

export function extractMiniSkillBars(wikitext: string, index: DataIndex): ParsedSkillBar[] {
  const byName = new Map<string, Skill>();
  for (const skill of index.dataset.skills) {
    byName.set(skill.name.toLowerCase(), skill);
    byName.set(skill.wikiPage.toLowerCase(), skill);
  }

  const out: ParsedSkillBar[] = [];
  for (const match of wikitext.matchAll(/\{\{\s*mini skill bar\s*\|([^}]*)\}\}/gi)) {
    const names = match[1]
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const skills: Array<Skill | null> = [];
    const unknownSkills: string[] = [];
    for (const raw of names.slice(0, 8)) {
      const skill = byName.get(raw.toLowerCase());
      if (skill) skills.push(skill);
      else {
        skills.push(null);
        if (!/^(optional|empty|-)$/i.test(raw)) unknownSkills.push(raw);
      }
    }
    while (skills.length < 8) skills.push(null);

    // the professions and name usually follow on the next line
    const after = wikitext.slice(match.index! + match[0].length, match.index! + match[0].length + 300);
    const professions = [...after.matchAll(/\{\{([A-Za-z]{1,2})\}\}/g)]
      .map((m) => PROFESSION_SHORTHAND[m[1]] ?? PROFESSION_SHORTHAND[`${m[1][0].toUpperCase()}${m[1].slice(1)}`])
      .filter((p): p is Profession => p !== undefined);
    const linkName = after.match(/\[\[[^\]|]+\|([^\]]+)\]\]/)?.[1] ?? after.match(/\[\[([^\]|#]+)\]\]/)?.[1] ?? null;

    out.push({
      name: linkName?.trim() ?? null,
      primary: professions[0] ?? null,
      secondary: professions[1] ?? null,
      skills,
      unknownSkills,
    });
  }
  return out;
}
