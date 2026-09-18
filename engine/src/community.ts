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
import type { Campaign, Profession } from "./types.js";

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
  extras: { tags?: string[]; firstSeen?: string } = {},
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
