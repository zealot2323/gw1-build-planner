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
  acquisition: {
    trainers: string[];
    quests: string[];
    captureBosses: string[];
    conditionalCaptureBosses?: string[];
    /** Where each quest is given (second link on the acquisition line). */
    questLocations?: Record<string, string | null>;
    /** Where each capture boss spawns (second link on the acquisition line). */
    captureLocations?: Record<string, string | null>;
  };
}

/**
 * Parse the Acquisition section. Structure on skill pages:
 *   '''[[Skill quest]]s''' / '''[[Skill trainer]]s''' / '''[[Signet of Capture]]'''
 *   * [[Prophecies]]            (campaign context — sometimes unlinked)
 *   ** [[Name]] ([[Location]], optional conditions)
 * Only Prophecies entries are kept (scope: Prophecies campaign only).
 */
function parseAcquisition(
  body: string,
  isElite: boolean,
): { acquisition: ParsedSkill["acquisition"] } {
  const out: ParsedSkill["acquisition"] = { trainers: [], quests: [], captureBosses: [] };
  // Elite pages sometimes skip the '''[[Signet of Capture]]''' header and
  // start straight with campaign bullets — capture is the only way to get
  // most elites, so that's the default group for them.
  let group: "trainers" | "quests" | "captureBosses" | null = isElite ? "captureBosses" : null;
  let inProphecies = false;

  const isCampaignLine = (line: string): boolean =>
    /^\*\s*(\[\[)?\s*(guild wars )?(prophecies|factions|nightfall|eye of the north|core|beyond)\b/i.test(line);
  const conditional: string[] = [];
  const captureLocations: Record<string, string | null> = {};
  const questLocations: Record<string, string | null> = {};
  const push = (line: string): void => {
    if (!group || /hard mode/i.test(line)) return; // normal mode only
    const targets = linkTargets(line);
    const target = targets[0];
    if (!target) return;
    if (group === "quests") questLocations[target] = targets[1] ?? null;
    if (group === "captureBosses") {
      captureLocations[target] = targets[1] ?? null;
      // Bosses that only spawn during a quest/event don't appear in base
      // foe lists — track them separately (gating not modeled yet).
      if (/only (during|after|before|available)|, during |requires/i.test(line)) {
        if (!conditional.includes(target)) conditional.push(target);
        return;
      }
    }
    if (!out[group].includes(target)) out[group].push(target);
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
  if (conditional.length > 0) out.conditionalCaptureBosses = conditional;
  if (Object.keys(questLocations).length > 0) out.questLocations = questLocations;
  if (Object.keys(captureLocations).length > 0) out.captureLocations = captureLocations;
  return { acquisition: out };
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
  const { acquisition } = acqBodies.length
    ? parseAcquisition(acqBodies.join("\n"), box?.["elite"] === "y")
    : { acquisition: { trainers: [], quests: [], captureBosses: [] } };
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

/**
 * One stat/skill block from a monster page. Many creatures — bosses
 * especially — are listed with several blocks keyed by encounter level
 * ("Level 12" / "Level 28", e.g. Riine Windrot), by zone ("Gates of Kryta",
 * "During Iron Mines of Moladune"), or by loadout ("Ranger version").
 * Which one applies is a per-location question, answered in the engine.
 */
export interface ParsedMonsterVariant {
  /** Block label as written on the wiki; null for an unlabelled block. */
  label: string | null;
  /** Levels named by the label, e.g. "Level 4, 5, 10, 12" -> [4,5,10,12]. */
  levels: number[];
  /** Normal-mode skill bar. */
  skills: string[];
  /** Skills this creature only has in hard mode (annotated "hard mode only"). */
  hardModeSkills?: string[];
  eliteSkill?: string;
  hardModeEliteSkill?: string;
  /** The whole block is hard-mode content (e.g. "During Hard mode Titan quests"). */
  hardMode?: boolean;
}

export interface ParsedMonster {
  name: string;
  wikiPage: string;
  species: string | null;
  level: number | null;
  levelRaw?: string;
  /** Hard-mode level — the parenthesized value in the infobox. */
  levelHard?: number | null;
  armor: number | null;
  armorTable: Array<{ damageType: string; rating: number }>;
  /** Union of every variant's skills (all loadouts this creature can have). */
  skills: string[];
  isBoss: boolean;
  bossElite?: string;
  locations: string[];
  profession: string | null;
  /** Present only when the page splits skills into more than one block. */
  variants?: ParsedMonsterVariant[];
  /**
   * Encounter level per location, from "(level N)" annotations on the
   * Locations/Missions groups — the key that ties a location to a variant.
   */
  locationLevels?: Record<string, number>;
}

/** "7, 9 (23)" → highest normal-mode level (parenthesized = hard mode). */
function parseLevel(raw: string | undefined): number | null {
  if (!raw) return null;
  // "7 (23) [30]": parens are the hard-mode level, brackets a special
  // (e.g. Titan quest) version — neither is the normal-mode level.
  const normal = stripMarkup(raw).replace(/\([^)]*\)|\[[^\]]*\]/g, "");
  const nums = [...normal.matchAll(/\d+/g)].map((m) => Number(m[0]));
  return nums.length > 0 ? Math.max(...nums) : null;
}

/** "7, 9 (23)" -> 23: the parenthesized value is the hard-mode level. */
function parseHardLevel(raw: string | undefined): number | null {
  if (!raw) return null;
  const inParens = stripMarkup(raw).match(/\(([^)]*)\)/);
  if (!inParens) return null;
  const nums = [...inParens[1].matchAll(/\d+/g)].map((m) => Number(m[0]));
  return nums.length > 0 ? Math.max(...nums) : null;
}

/** "Level 4, 5, 10, 12" -> [4,5,10,12]; "Level 24 (30), Kessex Peak" -> [24]. */
function labelLevels(label: string | null): number[] {
  if (!label) return [];
  const m = label.match(/level\s+([\d,\s]+)/i);
  if (!m) return [];
  return [...m[1].matchAll(/\d+/g)].map((n) => Number(n[0]));
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

  // Skills used: {{skill icon|X}} bullets in the Skills section and its
  // subsections, normal mode only — bullets annotated "hard mode" are
  // dropped. Context blocks come in two shapes and both must be filtered
  // to Prophecies content:
  // - marker lines (";Prophecies", "'''Eye of the North'''", ";As warrior
  //   (cinematic only)")
  // - subsection headings ("===During Iron Mines of Moladune===",
  //   "===Level 24 (30), Kessex Peak===", "===The Rise of the White
  //   Mantle===")
  // A block is excluded only when it names another campaign / Beyond
  // content / a cinematic; encounter levels, professions, and Prophecies
  // mission names all stay.
  const NON_PROPHECIES_CONTEXT =
    /factions|nightfall|eye of the north|war in kryta|winds of change|hearts of the north|beyond|cinematic|special ops|rise of the white mantle|fronis|halloween|wintersday|festival|mausoleum|annihilator/i;

  // Blocks are delimited by subsection headings AND by in-body marker lines
  // (";Prophecies", "'''Level 12'''", or a bare "Level 12" line).
  const variants: ParsedMonsterVariant[] = [];
  let current: ParsedMonsterVariant | null = null;
  const startBlock = (label: string | null, hardMode = false) => {
    current = { label, levels: labelLevels(label), skills: [], ...(hardMode ? { hardMode: true } : {}) };
    variants.push(current);
  };

  for (const s of sections(wikitext)) {
    const isSkillsHeading = /^skills/i.test(s.title);
    if (!isSkillsHeading && !s.ancestors.some((a) => /^skills/i.test(a))) continue;
    // the Skills heading itself is neutral; every other heading in the
    // chain (including ancestors of nested subsections) is context
    const contextTitles = [s.title, ...s.ancestors].filter((t) => !/^skills/i.test(t));
    if (contextTitles.some((t) => NON_PROPHECIES_CONTEXT.test(t))) continue;
    // Hard-mode blocks are kept and flagged rather than dropped — the zone
    // browser has a hard mode toggle and needs both bars.
    const headingIsHardMode = contextTitles.some((t) => /hard\s*mode/i.test(t));

    current = null;
    let suppressed = false; // inside a marker-delimited non-Prophecies block
    let markerIsHardMode = false;
    const headingLabel = isSkillsHeading ? null : s.title;
    for (const line of s.body.split("\n")) {
      const marker = line.match(/^;\s*(.+)$|^'''([^']+)'''|^\s*(Level\s+[\d,\s]+)\s*$/i);
      if (marker) {
        const label = stripMarkup((marker[1] ?? marker[2] ?? marker[3]).trim());
        current = null;
        suppressed = NON_PROPHECIES_CONTEXT.test(label);
        markerIsHardMode = /hard\s*mode/i.test(label);
        if (!suppressed) startBlock(label, headingIsHardMode || markerIsHardMode);
        continue;
      }
      if (suppressed || !/^\*/.test(line)) continue;
      const m = line.match(/\{\{\s*skill icon\s*\|([^}|]+)/i);
      if (!m) continue;
      if (current === null) startBlock(headingLabel, headingIsHardMode || markerIsHardMode);
      const skill = m[1].trim();
      const isElite = /\(\s*(\[\[)?elite/i.test(line);
      // {{verify|...}} editor notes discuss hard mode without the skill
      // being hard-mode-only — judge the annotation, not the note.
      const hardModeOnly =
        !current!.hardMode &&
        /hard\s*mode/i.test(line.replace(/\{\{\s*verify[^}]*\}\}/gi, ""));
      if (hardModeOnly) {
        const hm = (current!.hardModeSkills ??= []);
        if (!hm.includes(skill)) hm.push(skill);
        if (isElite) current!.hardModeEliteSkill ??= skill;
        continue;
      }
      if (!current!.skills.includes(skill)) current!.skills.push(skill);
      if (isElite) current!.eliteSkill ??= skill;
    }
  }

  const withSkills = variants.filter((v) => v.skills.length > 0 || (v.hardModeSkills?.length ?? 0) > 0);
  // Page-level skills stay NORMAL MODE only (hard-mode bars live on the
  // variants, surfaced by the zone browser's hard mode toggle).
  const skills: string[] = [];
  for (const v of withSkills.filter((v) => !v.hardMode)) {
    for (const s of v.skills) if (!skills.includes(s)) skills.push(s);
  }
  const eliteSkills = [
    ...new Set(
      withSkills.filter((v) => !v.hardMode).map((v) => v.eliteSkill).filter((e): e is string => !!e),
    ),
  ];

  const isBoss = /^y(es)?$/i.test(box?.["boss"] ?? "");
  const bossElite = isBoss ? eliteSkills[0] : undefined;
  if (isBoss && eliteSkills.length > 1) issues.push(`boss with multiple elites: ${eliteSkills.join(", ")}`);

  // Where it spawns: {{NPC location|X}} entries under Locations/Missions.
  // Group bullets carry "(level N)" annotations that tie each location to
  // one of the skill blocks above.
  const locations = new Set<string>();
  const locationLevels: Record<string, number> = {};
  for (const s of sections(wikitext)) {
    if (!/^(locations?|missions?)$/i.test(s.title)) continue;
    let groupLevel: number | null = null;
    for (const line of s.body.split("\n")) {
      if (/^\*[^*]/.test(line)) {
        const m = line.match(/\(\s*level\s+(\d+)/i);
        groupLevel = m ? Number(m[1]) : null;
      }
      for (const m of line.matchAll(/\{\{\s*NPC location\s*\|([^}|]+)/gi)) {
        const name = m[1].trim();
        locations.add(name);
        // a line may carry its own level, overriding the group's
        const own = line.match(/\(\s*level\s+(\d+)/i);
        const lvl = own ? Number(own[1]) : groupLevel;
        if (lvl !== null) locationLevels[name] = lvl;
      }
    }
  }
  if (locations.size === 0) issues.push("no locations parsed");

  return {
    entity: {
      name: title,
      wikiPage: title,
      // some pages use "affiliation" instead of "type" (e.g. Charr Shaman)
      species: box?.["type"]
        ? stripMarkup(box["type"])
        : box?.["affiliation"]
          ? stripMarkup(box["affiliation"])
          : null,
      level,
      levelRaw: box?.["level"] ? stripMarkup(box["level"]) : undefined,
      levelHard: parseHardLevel(box?.["level"]),
      armor,
      armorTable,
      skills,
      isBoss,
      bossElite,
      locations: [...locations],
      profession: normalizeProfession(box?.["profession"]),
      ...(withSkills.length > 1 ? { variants: withSkills } : {}),
      ...(Object.keys(locationLevels).length > 0 ? { locationLevels } : {}),
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
