/**
 * Per-entity wikitext parsers. Input is always a cached page's wikitext;
 * output matches the engine schemas in /engine/src/types.ts.
 *
 * Wiki data is hand-edited and inconsistent — these parsers NEVER throw on a
 * weird page. Anything unexpected is recorded as an issue string and the
 * field is left null/empty; the driver aggregates issues into
 * /data/validation-report.md.
 */
import {
  firstLinkTarget,
  linkTargets,
  normalizeProfession,
  parseTemplate,
  parseWikiNumber,
  sections,
  stripMarkup,
} from "./wikitext.js";

export interface Parsed<T> {
  entity: T;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export interface ParsedSkill {
  name: string;
  wikiPage: string;
  gwSkillId: number | null;
  profession: string | null;
  attribute: string | null;
  isElite: boolean;
  campaign: string | null;
  energyCost: number | null;
  adrenalineCost: number | null;
  activation: number | null;
  recharge: number | null;
  description: string;
  acquisition: { trainers: string[]; quests: string[]; captureBosses: string[] };
}

/**
 * Parse the Acquisition section. Structure on skill pages:
 *   '''[[Skill quest]]s''' / '''[[Skill trainer]]s''' / '''[[Signet of Capture]]'''
 *   * [[Prophecies]]            (campaign context — sometimes unlinked)
 *   ** [[Name]] ([[Location]], optional conditions)
 * Only Prophecies entries are kept (scope: Prophecies campaign only).
 */
function parseAcquisition(body: string, isElite: boolean): ParsedSkill["acquisition"] {
  const out: ParsedSkill["acquisition"] = { trainers: [], quests: [], captureBosses: [] };
  // Elite pages sometimes skip the '''[[Signet of Capture]]''' header and
  // start straight with campaign bullets — capture is the only way to get
  // most elites, so that's the default group for them.
  let group: keyof ParsedSkill["acquisition"] | null = isElite ? "captureBosses" : null;
  let inProphecies = false;

  const isCampaignLine = (line: string): boolean =>
    /^\*\s*(\[\[)?\s*(guild wars )?(prophecies|factions|nightfall|eye of the north|core|beyond)\b/i.test(line);
  const push = (line: string): void => {
    if (!group || /hard mode/i.test(line)) return; // normal mode only
    const target = firstLinkTarget(line);
    if (target && !out[group].includes(target)) out[group].push(target);
  };

  for (const line of body.split("\n")) {
    const bold = line.match(/'''(.*?)'''/);
    if (bold) {
      const label = stripMarkup(bold[1]).toLowerCase();
      if (label.includes("trainer")) group = "trainers";
      else if (label.includes("quest")) group = "quests";
      else if (label.includes("signet of capture")) group = "captureBosses";
      else group = null; // profession changers, unlock-only, ...
      inProphecies = false;
      continue;
    }
    if (/^\*[^*]/.test(line)) {
      if (isCampaignLine(line)) {
        inProphecies = /prophecies/i.test(line);
      } else if (/\[\[.*\(/.test(line)) {
        // "* [[Boss]] ([[Location]])" — entry with no campaign bullets at
        // all; such flat lists are Prophecies-only in practice.
        push(line);
      }
      continue;
    }
    if (/^\*\*[^*]/.test(line) && inProphecies) push(line);
  }
  return out;
}

export function parseSkill(title: string, wikitext: string): Parsed<ParsedSkill> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "Skill infobox");
  if (!box) issues.push("no Skill infobox");

  const gwSkillId = parseWikiNumber(box?.["id"]);
  if (gwSkillId === null) issues.push("missing infobox id (needed for template codes)");
  const profession = normalizeProfession(box?.["profession"]);
  const campaign = box?.["campaign"] ? stripMarkup(box["campaign"]) : null;
  if (!campaign) issues.push("missing campaign");

  // The Acquisition content may sit directly in the section or inside
  // subsections like "===Unlock and learn===". Gather all of it, but skip
  // "Unlock only" subsections (hero unlocks — not learnable acquisition).
  const acqBodies = sections(wikitext)
    .filter((s) => /^acquisition$/i.test(s.title) || s.ancestors.some((a) => /^acquisition$/i.test(a)))
    .filter((s) => ![s.title, ...s.ancestors].some((t) => /unlock only/i.test(t)))
    .map((s) => s.body);
  const acquisition = acqBodies.length
    ? parseAcquisition(acqBodies.join("\n"), box?.["elite"] === "y")
    : { trainers: [], quests: [], captureBosses: [] };
  if (acqBodies.length === 0) issues.push("no Acquisition section");

  return {
    entity: {
      name: box?.["name"] ? stripMarkup(box["name"]) : title,
      wikiPage: title,
      gwSkillId,
      profession,
      attribute: box?.["attribute"] ? stripMarkup(box["attribute"]) : null,
      isElite: box?.["elite"] === "y",
      campaign,
      energyCost: parseWikiNumber(box?.["energy"]),
      adrenalineCost: parseWikiNumber(box?.["adrenaline"]),
      activation: parseWikiNumber(box?.["activation"]),
      recharge: parseWikiNumber(box?.["recharge"]) ?? 0,
      description: box?.["description"] ? stripMarkup(box["description"]) : "",
      acquisition,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Trainer
// ---------------------------------------------------------------------------

export interface ParsedTrainer {
  name: string;
  wikiPage: string;
  location: string | null;
  skillsOffered: string[];
  /** "''all Prophecies and core''" marker (e.g. Dakk) — driver expands. */
  offersAllPropheciesAndCore?: boolean;
  /** "only offers skills from previous trainers [[X]]..." — driver expands. */
  inheritsFrom?: string[];
}

/**
 * Parse a {{Skill trainer list}} template (from a "Name/Skills" subpage, or
 * from the trainer's inline block on the Prophecies trainer list page).
 * `locationFromList` is the outpost from the list page's "[[X]] in [[Y]]"
 * heading — authoritative over the template's location parameter.
 */
export function parseTrainer(
  name: string,
  wikitext: string,
  locationFromList: string | null,
): Parsed<ParsedTrainer> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "Skill trainer list");
  if (!box) issues.push("no Skill trainer list template");

  const skills = new Set<string>();
  let offersAll = false;
  for (const [key, value] of Object.entries(box ?? {})) {
    if (key === "location" || key === "note") continue;
    if (/''all (Prophecies and core|core and Prophecies)''/i.test(value)) offersAll = true;
    for (const m of value.matchAll(/\{\{\s*skill icon\s*\|([^}|]+)/gi)) skills.add(m[1].trim());
  }

  // e.g. Master Scout Kiera: "This trainer only offers skills from the
  // previous trainers [[Captain Greywind]], [[Ephaz]] and [[Sorim]]."
  const inheritsFrom =
    skills.size === 0 && !offersAll && box?.["note"] && /previous trainers/i.test(box.note)
      ? linkTargets(box.note)
      : [];

  if (skills.size === 0 && !offersAll && inheritsFrom.length === 0) issues.push("no skills parsed");

  const location = locationFromList ?? (box?.["location"] ? stripMarkup(box["location"]) : null);
  if (!location) issues.push("no location");

  return {
    entity: {
      name,
      wikiPage: name,
      location,
      skillsOffered: [...skills].sort(),
      ...(offersAll ? { offersAllPropheciesAndCore: true } : {}),
      ...(inheritsFrom.length > 0 ? { inheritsFrom } : {}),
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Foes/bosses extraction with section context (shared by locations/missions)
// ---------------------------------------------------------------------------

export interface FoeLists {
  foes: string[];
  bosses: string[];
}

/**
 * Extract monster links from Foes/Bosses sections. Section context decides
 * boss status; anything under a "Hard mode" heading is skipped (scope:
 * normal mode only).
 */
export function extractFoes(wikitext: string): FoeLists {
  const foes = new Set<string>();
  const bosses = new Set<string>();
  for (const s of sections(wikitext)) {
    const inHardMode = [s.title, ...s.ancestors].some((t) => /hard mode/i.test(t));
    if (inHardMode) continue;
    const isBossSection = /^boss(es)?( |$)|boss-like/i.test(s.title);
    const isFoeSection = /^foes$/i.test(s.title);
    if (!isBossSection && !isFoeSection) continue;
    for (const line of s.body.split("\n")) {
      if (!/^\*[^*]/.test(line)) continue;
      const target = firstLinkTarget(line);
      if (target && !/^(File|Image|Category|Template):/i.test(target)) {
        (isBossSection ? bosses : foes).add(target);
      }
    }
  }
  return { foes: [...foes], bosses: [...bosses] };
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export interface ParsedLocation {
  kind: string;
  name: string;
  wikiPage: string;
  campaign: string | null;
  region: string | null;
  neighbors: string[];
  trainer?: string;
  foes: string[];
  bosses: string[];
}

export function parseLocation(title: string, wikitext: string, kind: string): Parsed<ParsedLocation> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "Location infobox");
  if (!box) issues.push("no Location infobox");

  const neighbors = box?.["exits"] ? linkTargets(box["exits"]) : [];
  if (kind !== "explorable" && !box?.["exits"]) issues.push("no exits in infobox");

  const { foes, bosses } = extractFoes(wikitext);
  if (kind === "explorable" && foes.length + bosses.length === 0) issues.push("no foes parsed");

  // The trainer standing here (if any) is resolved by the driver from the
  // trainer list — location pages mark them inconsistently.
  return {
    entity: {
      kind,
      name: title,
      wikiPage: title,
      campaign: box?.["campaign"] ? stripMarkup(box["campaign"]) : null,
      region: box?.["region"] ? stripMarkup(box["region"]) : null,
      neighbors,
      foes,
      bosses,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Monster
// ---------------------------------------------------------------------------

export interface ParsedMonster {
  name: string;
  wikiPage: string;
  species: string | null;
  level: number | null;
  levelRaw?: string;
  armor: number | null;
  armorTable: Array<{ damageType: string; rating: number }>;
  skills: string[];
  isBoss: boolean;
  bossElite?: string;
  locations: string[];
  profession: string | null;
}

/** "7, 9 (23)" → highest normal-mode level (parenthesized = hard mode). */
function parseLevel(raw: string | undefined): number | null {
  if (!raw) return null;
  const normal = stripMarkup(raw).replace(/\([^)]*\)/g, "");
  const nums = [...normal.matchAll(/\d+/g)].map((m) => Number(m[0]));
  return nums.length > 0 ? Math.max(...nums) : null;
}

export function parseMonster(title: string, wikitext: string): Parsed<ParsedMonster> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "NPC infobox");
  if (!box) issues.push("no NPC infobox");

  const level = parseLevel(box?.["level"]);
  if (level === null) issues.push("no normal-mode level parsed");

  // Armor: the whole {{NPC statistics}} table as structured data — many
  // pages only break armor out by damage type, with no single base value.
  const stats = parseTemplate(wikitext, "NPC statistics");
  const armorTable: ParsedMonster["armorTable"] = [];
  let armor: number | null = null;
  for (const [key, value] of Object.entries(stats ?? {})) {
    const rating = parseWikiNumber(value);
    if (rating === null || key === "prof" || key === "level") continue;
    if (key === "base" || key === "armor") armor = rating;
    armorTable.push({ damageType: key, rating });
  }

  // Skills used: {{skill icon|X}} bullets in the Skills section(s), normal
  // mode only — bullets annotated "hard mode" are dropped.
  const skills: string[] = [];
  const eliteSkills: string[] = [];
  for (const s of sections(wikitext)) {
    if (!/^skills/i.test(s.title)) continue;
    if ([s.title, ...s.ancestors].some((t) => /hard mode/i.test(t))) continue;
    for (const line of s.body.split("\n")) {
      if (!/^\*/.test(line)) continue;
      const m = line.match(/\{\{\s*skill icon\s*\|([^}|]+)/i);
      if (!m) continue;
      if (/hard mode/i.test(line)) continue;
      const skill = m[1].trim();
      skills.push(skill);
      if (/\(\s*(\[\[)?elite/i.test(line)) eliteSkills.push(skill);
    }
  }

  const isBoss = box?.["boss"] === "y";
  const bossElite = isBoss ? eliteSkills[0] : undefined;
  if (isBoss && eliteSkills.length === 0) issues.push("boss with no elite skill marked");
  if (isBoss && eliteSkills.length > 1) issues.push(`boss with multiple elites: ${eliteSkills.join(", ")}`);

  // Where it spawns: {{NPC location|X}} entries under Locations/Missions.
  const locations = new Set<string>();
  for (const s of sections(wikitext)) {
    if (!/^(locations?|missions?)$/i.test(s.title)) continue;
    for (const m of s.body.matchAll(/\{\{\s*NPC location\s*\|([^}|]+)/gi)) locations.add(m[1].trim());
  }
  if (locations.size === 0) issues.push("no locations parsed");

  return {
    entity: {
      name: title,
      wikiPage: title,
      species: box?.["type"] ? stripMarkup(box["type"]) : null,
      level,
      levelRaw: box?.["level"] ? stripMarkup(box["level"]) : undefined,
      armor,
      armorTable,
      skills,
      isBoss,
      bossElite,
      locations: [...locations],
      profession: normalizeProfession(box?.["profession"]),
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Mission
// ---------------------------------------------------------------------------

export interface ParsedMission {
  name: string;
  wikiPage: string;
  outpost: string | null;
  region: string | null;
  foes: string[];
  bosses: string[];
}

export function parseMission(title: string, wikitext: string): Parsed<ParsedMission> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "Mission infobox");
  if (!box) issues.push("no Mission infobox");
  const { foes, bosses } = extractFoes(wikitext);
  if (foes.length + bosses.length === 0) issues.push("no foes parsed");
  return {
    entity: {
      name: title,
      wikiPage: title,
      outpost: null, // resolved by the driver against the manifest's mission outposts
      region: box?.["region"] ? stripMarkup(box["region"]) : null,
      foes,
      bosses,
    },
    issues,
  };
}
