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
  stripMarkupKeepBreaks,
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
  allegianceSkillIds?: { Kurzick: number; Luxon: number };
  profession: string | null;
  attribute: string | null;
  isElite: boolean;
  campaign: string | null;
  energyCost: number | null;
  adrenalineCost: number | null;
  /** Health sacrificed to cast, as a percent (Blood Magic and friends). */
  sacrificePercent: number | null;
  /** Energy degeneration while maintained ("upkeep"), in pips. */
  upkeep: number | null;
  activation: number | null;
  recharge: number | null;
  description: string;
  acquisition: {
    trainers: string[];
    quests: string[];
    captureBosses: string[];
    conditionalCaptureBosses?: string[];
    /**
     * NPCs who teach a skill in exchange for standing in a title track
     * (allegiance, Sunspear, Lightbringer) rather than gold. Kept separate
     * because the gate is a rank, not a place.
     */
    titleNpcs?: string[];
    titleLocations?: Record<string, string | null>;
    /** The rank requirement, quoted from the page's Notes. */
    titleRequirement?: string;
    /** Where each quest is given (second link on the acquisition line). */
    questLocations?: Record<string, string | null>;
    /** Where each capture boss spawns (second link on the acquisition line). */
    captureLocations?: Record<string, string | null>;
    /** Campaign each source was listed under. */
    sourceCampaigns?: Record<string, string>;
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
  let group: "trainers" | "quests" | "captureBosses" | "titleNpcs" | null = isElite ? "captureBosses" : null;
  // Sources from every campaign are kept: which ones a character can
  // actually use is decided later by whether the location is reachable,
  // and a Factions trainer simply never appears in a Tyrian's unlocked set.
  let campaign: string | null = null;

  const isCampaignLine = (line: string): boolean =>
    /^\*\s*(\[\[)?\s*(guild wars )?(prophecies|factions|nightfall|eye of the north|core|beyond)\b/i.test(line);
  const conditional: string[] = [];
  const captureLocations: Record<string, string | null> = {};
  const questLocations: Record<string, string | null> = {};
  const sourceCampaigns: Record<string, string> = {};
  const titleNpcs: string[] = [];
  const titleLocations: Record<string, string | null> = {};
  const push = (line: string): void => {
    if (!group || /hard mode/i.test(line)) return; // normal mode only
    const targets = linkTargets(line);
    const target = targets[0];
    if (!target) return;
    if (campaign) sourceCampaigns[target] = campaign;
    if (group === "quests") {
      // Quest lines come in several shapes:
      //   [[Quest]] ([[Location]])
      //   [[Quest]] ([[Location]] - [[Ascalon (pre-Searing)|pre-Searing]])
      //   [[Quest]] (Churrhir Fields)                 — location not linked
      //   [[Quest A]]/[[Quest B]] ([[Location]])       — two quests, one place
      //   [[Quest]] (from [[NPC]] in [[Location]])     — EotN names the giver
      // Everything before the first "(" names quests; the location lives in
      // the parentheses. Reading "the second link" as the location turned
      // the second of two slash-joined quests into a place.
      const paren = line.indexOf("(", line.indexOf("]]"));
      const head = paren === -1 ? line : line.slice(0, paren);
      const tail = paren === -1 ? "" : line.slice(paren);
      const quests = linkTargets(head);
      const inPlace = tail.match(/\bin \[\[([^\]|#]+)/);
      const linked = linkTargets(tail)[0];
      const plain = tail.match(/^\(\s*([^\[\]()]+?)\s*\)/);
      // plain text can carry the same " - pre-Searing" suffix as the linked form
      const plainPlace = plain ? plain[1].split(" - ")[0].trim() : null;
      const location = inPlace ? inPlace[1].trim() : (linked ?? plainPlace);
      for (const quest of quests.length > 0 ? quests : [target]) {
        if (campaign) sourceCampaigns[quest] = campaign;
        questLocations[quest] = location;
        if (!out.quests.includes(quest)) out.quests.push(quest);
      }
      return;
    }
    if (group === "titleNpcs") {
      if (!titleNpcs.includes(target)) titleNpcs.push(target);
      titleLocations[target] = targets[1] ?? null;
      return;
    }
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
    // Group headers come in two flavours: bold ('''[[Skill trainer]]s''')
    // and the definition-list form (;[[Skill trainer]]s). 22 pages use the
    // latter and were losing every source before it was recognised.
    const bold = line.match(/'''(.*?)'''/) ?? line.match(/^;\s*(.+)$/);
    if (bold) {
      const label = stripMarkup(bold[1]).toLowerCase();
      if (label.includes("trainer")) group = "trainers";
      else if (label.includes("quest")) group = "quests";
      // "Signet of Capture", "Skill Capture", "Capture" all appear
      else if (label.includes("capture")) group = "captureBosses";
      else group = null; // profession changers, unlock-only, ...
      campaign = null;
      continue;
    }
    if (/^\*[^*]/.test(line)) {
      if (isCampaignLine(line)) {
        campaign = stripMarkup(line).replace(/^\*+\s*/, "").replace(/^guild wars /i, "").trim();
      } else if (/\[\[.*\(/.test(line)) {
        // "* [[X]] ([[Location]])" with no group header at all. For a
        // non-elite that is a faction/title NPC (Signet of Corruption is
        // sold by the Kurzick Bureaucrat for allegiance rank, not gold);
        // for an elite it is a bare capture list.
        const wasNull = group === null;
        if (wasNull) group = "titleNpcs";
        push(line);
        if (wasNull) group = null;
      }
      continue;
    }
    if (/^\*\*[^*]/.test(line)) push(line);
  }
  if (conditional.length > 0) out.conditionalCaptureBosses = conditional;
  if (Object.keys(questLocations).length > 0) out.questLocations = questLocations;
  if (Object.keys(captureLocations).length > 0) out.captureLocations = captureLocations;
  if (Object.keys(sourceCampaigns).length > 0) out.sourceCampaigns = sourceCampaigns;
  if (titleNpcs.length > 0) {
    out.titleNpcs = titleNpcs;
    out.titleLocations = titleLocations;
  }
  return { acquisition: out };
}

/**
 * The ten Factions allegiance skills carry both versions in one id field:
 * `id = 1954<!-- Luxon -->, 2097<!-- Kurzick -->`. The side is only ever
 * recorded in an HTML comment, so that comment is the parse key.
 */
function parseAllegianceIds(raw: string | undefined): { Kurzick: number; Luxon: number } | null {
  if (!raw) return null;
  const bySide: Record<string, number> = {};
  for (const [, id, side] of raw.matchAll(/(\d+)\s*<!--\s*(Kurzick|Luxon)\s*-->/gi)) {
    bySide[side[0].toUpperCase() + side.slice(1).toLowerCase()] = Number(id);
  }
  return bySide.Kurzick !== undefined && bySide.Luxon !== undefined
    ? { Kurzick: bySide.Kurzick, Luxon: bySide.Luxon }
    : null;
}

/**
 * Infobox booleans are hand-written: 236 skill pages say `elite = y` and 18
 * say `elite = yes`. Matching "y" exactly left those 18 non-elite, which let
 * them into the "all non-elite skills" trainer expansion — Tainted Flesh
 * looked purchasable from Dakk — and out of the one-elite-per-build rule.
 */
const isEliteFlag = (value: string | undefined): boolean => /^y(es)?$/i.test(value?.trim() ?? "");

export function parseSkill(title: string, wikitext: string): Parsed<ParsedSkill> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "Skill infobox");
  if (!box) issues.push("no Skill infobox");

  const gwSkillId = parseWikiNumber(box?.["id"]);
  const allegianceSkillIds = parseAllegianceIds(box?.["id"]);
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
    ? parseAcquisition(acqBodies.join("\n"), isEliteFlag(box?.["elite"]))
    : { acquisition: { trainers: [], quests: [], captureBosses: [] } };
  if (acqBodies.length === 0) issues.push("no Acquisition section");

  // The rank gate is stated in prose, not a field: "After reaching the first
  // allegiance rank, level 20 characters may learn this skill from ...".
  if (acquisition.titleNpcs) {
    const note = sections(wikitext)
      .filter((sec) => /^notes$/i.test(sec.title))
      .flatMap((sec) => sec.body.split("\n"))
      .map(stripMarkup)
      .find((line) => /\brank\b|\btitle\b|allegiance/i.test(line));
    if (note) acquisition.titleRequirement = note.replace(/^\*+\s*/, "").trim();
  }

  return {
    entity: {
      name: box?.["name"] ? stripMarkup(box["name"]) : title,
      wikiPage: title,
      gwSkillId,
      ...(allegianceSkillIds ? { allegianceSkillIds } : {}),
      profession,
      attribute: box?.["attribute"] ? stripMarkup(box["attribute"]) : null,
      isElite: isEliteFlag(box?.["elite"]),
      campaign,
      energyCost: parseWikiNumber(box?.["energy"]),
      adrenalineCost: parseWikiNumber(box?.["adrenaline"]),
      sacrificePercent: parseWikiNumber(box?.["sacrifice"]),
      upkeep: parseWikiNumber(box?.["upkeep"]),
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
  // "only offers skills from the previous trainers [[A]], [[B]]" (Prophecies)
  // and "Offers the same skills as [[Michiko]]" (Factions/Nightfall) are the
  // same idea: this trainer's stock is another's.
  const inheritsFrom =
    skills.size === 0 && !offersAll && box?.["note"] && /previous trainers|same skills as/i.test(box.note)
      ? linkTargets(box.note)
      : [];

  if (skills.size === 0 && !offersAll && inheritsFrom.length === 0) issues.push("no skills parsed");

  // Prophecies takes the location from the list page heading; other
  // campaigns' trainers only state it on their own page, either as a
  // template parameter or an {{NPC location|X}} entry under "Locations".
  const npcLocation = wikitext.match(/\{\{\s*NPC location\s*\|([^}|]+)/i)?.[1]?.trim() ?? null;
  const location =
    locationFromList ?? (box?.["location"] ? stripMarkup(box["location"]) : null) ?? npcLocation;
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
  /** Normal-mode level per foe, from the "8 (23)" prefix on each line. */
  foeLevels: Record<string, number>;
  /** Hard-mode level per foe, from the parenthesized value. */
  foeLevelsHard: Record<string, number>;
}

/**
 * Extract monster links from Foes/Bosses sections. Section context decides
 * boss status; anything under a "Hard mode" heading is skipped (scope:
 * normal mode only).
 */
export function extractFoes(wikitext: string): FoeLists {
  const foes = new Set<string>();
  const bosses = new Set<string>();
  const foeLevels: Record<string, number> = {};
  const foeLevelsHard: Record<string, number> = {};

  for (const s of sections(wikitext)) {
    const inHardMode = [s.title, ...s.ancestors].some((t) => /hard mode/i.test(t));
    if (inHardMode) continue;
    const isBossSection = /^boss(es)?( |$)|boss-like/i.test(s.title);
    const isFoeSection = /^foes$/i.test(s.title);
    if (!isBossSection && !isFoeSection) continue;
    for (const line of s.body.split("\n")) {
      if (!/^\*[^*]/.test(line)) continue;
      const target = firstLinkTarget(line);
      if (!target || /^(File|Image|Category|Template):/i.test(target)) continue;
      (isBossSection ? bosses : foes).add(target);

      // "* {{w}} 8 (23) [[Charr Axe Fiend]]" — the level prefix is the
      // encounter level FOR THIS ZONE, which is far more reliable than the
      // monster page's list of every level it appears at anywhere.
      const prefix = line.slice(0, line.indexOf("[[")).replace(/\{\{[^}]*\}\}/g, "");
      const hard = prefix.match(/\(\s*(\d+)/);
      const normals = [...prefix.replace(/\([^)]*\)/g, "").matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (normals.length > 0) foeLevels[target] = Math.max(...normals);
      if (hard) foeLevelsHard[target] = Number(hard[1]);
    }
  }
  return { foes: [...foes], bosses: [...bosses], foeLevels, foeLevelsHard };
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
  /** Encounter level per foe here (see extractFoes). */
  foeLevels?: Record<string, number>;
  foeLevelsHard?: Record<string, number>;
  /** Pre-Searing Ascalon (set by the driver from the overrides list). */
  preSearing?: boolean;
}

export function parseLocation(title: string, wikitext: string, kind: string): Parsed<ParsedLocation> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "Location infobox");
  if (!box) issues.push("no Location infobox");

  const neighbors = box?.["exits"] ? linkTargets(box["exits"]) : [];
  if (kind !== "explorable" && !box?.["exits"]) issues.push("no exits in infobox");

  const { foes, bosses, foeLevels, foeLevelsHard } = extractFoes(wikitext);
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
      ...(Object.keys(foeLevels).length > 0 ? { foeLevels } : {}),
      ...(Object.keys(foeLevelsHard).length > 0 ? { foeLevelsHard } : {}),
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
  /** Campaign/release the block's label names, when it names one. */
  campaign?: string;
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
  /** Infobox "affiliation": faction / creature type ("Undead", "Titans"). */
  affiliation?: string | null;
  /** Present only when the page splits skills into more than one block. */
  variants?: ParsedMonsterVariant[];
  /**
   * Encounter level per location, from "(level N)" annotations on the
   * Locations/Missions groups — the key that ties a location to a variant.
   */
  locationLevels?: Record<string, number>;
}

/**
 * Split an infobox level string into entries. Two shapes exist and they
 * collide: "<br>" separates individual entries on some pages
 * ("1 (22),<br>4 (22),<br>8 (23),<br>15") and separates whole
 * campaign groups on others ("5, 6 (23)<br>10, 12, 14"). If any
 * <br>-group holds a comma it is a campaign group, and only the first
 * (the Prophecies one) counts.
 */
function levelEntries(raw: string): Array<{ normal: number; hard: number | null }> {
  const groups = raw.split(/<br\s*\/?>/i).map((g) => g.trim()).filter(Boolean);
  const source = groups.some((g) => g.includes(",")) ? [groups[0] ?? ""] : groups;
  const entries: Array<{ normal: number; hard: number | null }> = [];
  for (const part of source.join(",").split(",")) {
    // brackets are a special (Titan quest) version, never the normal level
    const text = part.replace(/\[[^\]]*\]/g, "");
    const hardMatch = text.match(/\(([^)]*)\)/);
    const normalMatch = text.replace(/\([^)]*\)/g, "").match(/\d+/);
    if (!normalMatch) continue;
    const hardNums = hardMatch ? [...hardMatch[1].matchAll(/\d+/g)].map((m) => Number(m[0])) : [];
    entries.push({
      normal: Number(normalMatch[0]),
      hard: hardNums.length > 0 ? Math.max(...hardNums) : null,
    });
  }
  return entries;
}

/**
 * Normal-mode level. Entries that carry a hard-mode value are real
 * encounters; when some do and some don't, the bare ones are event-only
 * versions (Carrion Devourer's "15" is the April Fools Lakeside County)
 * and are dropped.
 */
function parseLevel(raw: string | undefined): number | null {
  if (!raw) return null;
  const entries = levelEntries(stripMarkupKeepBreaks(raw));
  if (entries.length === 0) return null;
  const paired = entries.filter((e) => e.hard !== null);
  const use = paired.length > 0 ? paired : entries;
  return Math.max(...use.map((e) => e.normal));
}

/** "7 (23) [30]" -> 23: the parenthesized value is the hard-mode level. */
function parseHardLevel(raw: string | undefined): number | null {
  if (!raw) return null;
  const hard = levelEntries(stripMarkupKeepBreaks(raw))
    .map((e) => e.hard)
    .filter((h): h is number => h !== null);
  return hard.length > 0 ? Math.max(...hard) : null;
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
  // Blocks that are never real PvE loadouts, whatever the campaign.
  // War in Kryta and Winds of Change are Beyond releases that re-arm
  // existing monsters; their bars are not what you meet in the campaign
  // zones, so they are dropped rather than tagged. Mind the pages that
  // label the ordinary bar "Non-War in Kryta version" — that one stays.
  const EXCLUDED_CONTEXT =
    /cinematic|halloween|wintersday|festival|mausoleum|annihilat|1070 ae|snowball|(?<!non-)\bwar in kryta\b|hearts of the north|rise of the white mantle|winds of change/i;
  // Blocks whose label names a campaign or a Beyond release — kept, but
  // tagged, so the engine can pick the right one per zone.
  const CAMPAIGN_CONTEXT: Array<[string, RegExp]> = [
    ["Prophecies", /\bprophecies\b/i],
    ["Factions", /\bfactions\b/i],
    ["Nightfall", /\bnightfall\b/i],
    // Bonus Mission Pack is its own mini-campaign, not EotN content; left
    // untagged so it is never preferred as a campaign match, only used as a
    // fallback when a monster has nothing better.
    ["Eye of the North", /eye of the north|\beotn\b|special ops|fronis/i],
  ];
  const campaignOf = (label: string | null): string | undefined =>
    label === null ? undefined : CAMPAIGN_CONTEXT.find(([, re]) => re.test(label))?.[0];

  const variants: ParsedMonsterVariant[] = [];
  let current: ParsedMonsterVariant | null = null;
  const startBlock = (label: string | null, hardMode = false, campaign?: string) => {
    current = {
      label,
      levels: labelLevels(label),
      skills: [],
      ...(hardMode ? { hardMode: true } : {}),
      ...(campaign ? { campaign } : {}),
    };
    variants.push(current);
  };

  for (const s of sections(wikitext)) {
    const isSkillsHeading = /^skills/i.test(s.title);
    if (!isSkillsHeading && !s.ancestors.some((a) => /^skills/i.test(a))) continue;
    // the Skills heading itself is neutral; every other heading in the
    // chain (including ancestors of nested subsections) is context
    const contextTitles = [s.title, ...s.ancestors].filter((t) => !/^skills/i.test(t));
    if (contextTitles.some((t) => EXCLUDED_CONTEXT.test(t))) continue;
    const headingCampaign = contextTitles.map(campaignOf).find((c) => c !== undefined);
    // Hard-mode blocks are kept and flagged rather than dropped — the zone
    // browser has a hard mode toggle and needs both bars.
    const headingIsHardMode = contextTitles.some((t) => /hard\s*mode/i.test(t));

    current = null;
    let suppressed = false; // inside a marker-delimited non-Prophecies block
    let markerIsHardMode = false;
    let markerCampaign: string | undefined;
    const headingLabel = isSkillsHeading ? null : s.title;
    for (const line of s.body.split("\n")) {
      const marker = line.match(/^;\s*(.+)$|^'''([^']+)'''|^\s*(Level\s+[\d,\s]+)\s*$/i);
      if (marker) {
        const label = stripMarkup((marker[1] ?? marker[2] ?? marker[3]).trim());
        current = null;
        suppressed = EXCLUDED_CONTEXT.test(label);
        markerIsHardMode = /hard\s*mode/i.test(label);
        markerCampaign = campaignOf(label);
        if (!suppressed) startBlock(label, headingIsHardMode || markerIsHardMode, markerCampaign ?? headingCampaign);
        continue;
      }
      if (suppressed || !/^\*/.test(line)) continue;
      const m = line.match(/\{\{\s*skill icon\s*\|([^}|]+)/i);
      if (!m) continue;
      if (current === null) {
        startBlock(headingLabel, headingIsHardMode || markerIsHardMode, markerCampaign ?? headingCampaign);
      }
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
      levelRaw: box?.["level"] ? stripMarkupKeepBreaks(box["level"]).replace(/ ?<br> ?/g, " / ") : undefined,
      levelHard: parseHardLevel(box?.["level"]),
      armor,
      armorTable,
      skills,
      isBoss,
      bossElite,
      locations: [...locations],
      profession: normalizeProfession(box?.["profession"]),
      affiliation: box?.["affiliation"] ? stripMarkup(box["affiliation"]) : null,
      // keep variants for single-block pages too when they carry hard-mode
      // data — that is where hardModeSkills lives (e.g. Charr Blade Storm's
      // Hundred Blades)
      ...(withSkills.length > 1 || withSkills.some((v) => v.hardModeSkills || v.hardMode)
        ? { variants: withSkills }
        : {}),
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
  /** Which campaign's mission list this came from (set by the driver). */
  campaign?: string | null;
  region: string | null;
  foes: string[];
  bosses: string[];
  foeLevels?: Record<string, number>;
  foeLevelsHard?: Record<string, number>;
}

export function parseMission(title: string, wikitext: string): Parsed<ParsedMission> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "Mission infobox");
  if (!box) issues.push("no Mission infobox");
  const { foes, bosses, foeLevels, foeLevelsHard } = extractFoes(wikitext);
  if (foes.length + bosses.length === 0) issues.push("no foes parsed");
  return {
    entity: {
      name: title,
      wikiPage: title,
      outpost: null, // resolved by the driver against the manifest's mission outposts
      region: box?.["region"] ? stripMarkup(box["region"]) : null,
      foes,
      bosses,
      ...(Object.keys(foeLevels).length > 0 ? { foeLevels } : {}),
      ...(Object.keys(foeLevelsHard).length > 0 ? { foeLevelsHard } : {}),
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Game updates (Feedback:Game updates/YYYYMMDD) and skill history subpages
// ---------------------------------------------------------------------------

/** What kind of change an update bullet describes. */
export type SkillChangeKind = "balance" | "bugfix" | "ai" | "note";

export interface ParsedSkillChange {
  skill: string;
  /** ISO date of the update (from the page title). */
  date: string;
  /** The bullet's text, minus the skill icon templates. */
  note: string;
  kind: SkillChangeKind;
  /** Heading path the bullet sat under, for context in the UI. */
  section: string | null;
}

/** Bug reports, not changes. */
const EXCLUDED_SECTION = /known\s*issues?/i;

/**
 * "Guild Wars Wiki notes" is written by wiki editors, and the page intro
 * says undocumented changes go there — so it cannot be skipped (the only
 * skill content in the 2026-05-04 update is a real recharge change filed
 * under it). But it also carries corrections stating a skill did NOT change
 * ("Symbols of Inspiration did not have its recharge time ... changed") and
 * clarifications of long-standing behaviour ("the health threshold is
 * actually 20%"). Recording either as a change would be wrong, so bullets
 * here must show positive evidence of a change to count as one.
 */
const EDITOR_NOTE_SECTION = /wiki\s*notes?/i;
const NEGATION = /\b(?:unchanged|was not|were not|did not|does not|do not|is not|are not)\b/i;
// Whole words only: "additional" is not "added" and "reduction" is not
// "reduced" — loose stems tagged plain clarifications as balance changes.
const CHANGE_VERB =
  /\b(?:increased|increases|decreased|decreases|reduced|reduces|lowered|raised|changed|changes|adjusted|added|removed|moved|split|reworked|renamed|replaced|now (?:deals?|costs?|lasts?|applies|grants?|heals?|recharges?))\b/i;

/**
 * Update notes name skills with {{skill icon|Name}}. A bullet that STARTS
 * with one or more of those templates is a change to those skills; a
 * template mid-sentence is prose and is ignored.
 */
const CHANGE_BULLET = /^\*+\s*((?:\{\{\s*skill icon\s*\|[^}]+\}\}[\s,]*(?:and\s*)?)+)(.*)$/i;
const SKILL_ICON = /\{\{\s*skill icon\s*\|([^}|]+?)\s*\}\}/gi;
/** "(PvE)", "(PvP)", "(BOTH)" scope marker between the icons and the note. */
const SCOPE_MARKER = /^\s*\(([^)]{1,40})\)/;
/** The note is separated from the skill by a dash, colon or nothing at all. */
const NOTE_SEPARATOR = /^\s*(?:-|–|—|&ndash;|&mdash;|:)\s*/;

function changeKind(sectionPath: string, note: string): SkillChangeKind {
  // AI sections retune when heroes/NPCs choose a skill — the skill itself is
  // untouched, so these are not balance changes.
  if (/\bAI\b/.test(sectionPath)) return "ai";
  if (/bug\s*fix/i.test(sectionPath)) return "bugfix";
  if (/^(fix|fixed|fixes|correct|corrected)\b/i.test(note.trim())) return "bugfix";
  return "balance";
}

/**
 * Parse one "Feedback:Game updates/YYYYMMDD" page into per-skill changes.
 *
 * The wiki's update notes are hand-written and the formatting drifts: the
 * separator is variously "-", ":", "&ndash;" or nothing, {{skill icon}} is
 * sometimes capitalised, one bullet can name several skills, and PvP-split
 * versions are mixed in with PvE ones.
 */
export function parseGameUpdate(title: string, wikitext: string): Parsed<ParsedSkillChange[]> {
  const issues: string[] = [];
  const m = title.match(/(\d{4})(\d{2})(\d{2})\s*$/);
  if (!m) {
    return { entity: [], issues: [`update page title has no date: "${title}"`] };
  }
  const date = `${m[1]}-${m[2]}-${m[3]}`;

  const out: ParsedSkillChange[] = [];
  const seen = new Set<string>();
  for (const section of sections(wikitext)) {
    const path = [...section.ancestors, section.title];
    if (path.some((t) => EXCLUDED_SECTION.test(t))) continue;
    const editorNotes = path.some((t) => EDITOR_NOTE_SECTION.test(t));
    // drop the "Update - August 26, 2026" wrapper heading from the label
    const label = path.filter((t) => !/^update\b/i.test(t)).join(" › ") || null;

    // A plain top-level bullet can head the sub-bullets beneath it
    // ("* Sword adrenaline reductions:" / "** {{skill icon|Sever Artery}} from
    // 4 to 3", or "* Skill AI adjustments:"). Without it the child note is a
    // meaningless fragment, and an AI tweak gets classified as balance.
    let parent: string | null = null;
    for (const line of section.body.split("\n")) {
      if (/^\*[^*]/.test(line) && !CHANGE_BULLET.test(line)) {
        parent = stripMarkup(line.replace(/^\*+/, "")).replace(/:\s*$/, "").trim() || null;
        continue;
      }
      const bullet = line.match(CHANGE_BULLET);
      if (!bullet) continue;
      const context = /^\*\*/.test(line) ? parent : null;
      const names = [...bullet[1].matchAll(SKILL_ICON)].map((s) => s[1].trim());
      let rest = bullet[2];

      // A "(PvP)" marker means the bullet changes the PvP-split version,
      // which is a different skill and out of scope for a PvE planner.
      const scope = rest.match(SCOPE_MARKER);
      if (scope) {
        if (/^pvp$/i.test(scope[1].trim())) continue;
        rest = rest.slice(scope[0].length);
      }
      let note = stripMarkup(rest.replace(NOTE_SEPARATOR, "")).replace(/\s+/g, " ").trim();
      // "Dust Cloak's range was increased" leaves a dangling "'s"
      note = note.replace(/^'s\s+/, "");
      if (note === "") continue;
      if (context && /^(from|to)\b/i.test(note)) note = `${context}: ${note}`;

      let kind = changeKind([label ?? "", context ?? ""].join(" › "), note);
      if (editorNotes) {
        if (NEGATION.test(note)) continue; // "recharge is unchanged"
        if (!CHANGE_VERB.test(note)) kind = "note"; // clarification, not a change
      }

      for (const skill of names) {
        if (/\(PvP\)\s*$/i.test(skill)) continue;
        const key = `${skill}|${note}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ skill, date, note, kind, section: label });
      }
    }
  }
  if (out.length === 0 && /\{\{\s*skill icon\s*\|/i.test(wikitext)) {
    issues.push("page names skills but no change bullets parsed");
  }
  return { entity: out, issues };
}

/** One dated snapshot from a skill's /Skill history subpage. */
export interface ParsedSkillVersion {
  /** ISO date of the update that produced this version; null for "Original". */
  date: string | null;
  /** Heading as written ("December 11, 2008", "Original"). */
  label: string;
  energyCost: number | null;
  adrenalineCost: number | null;
  sacrificePercent: number | null;
  upkeep: number | null;
  activation: number | null;
  recharge: number | null;
  attribute: string | null;
  isElite: boolean;
  description: string;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "December 11, 2008" -> "2008-12-11"; anything else (e.g. "Original") -> null. */
function headingDate(label: string): string | null {
  const m = label.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month === -1) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * Parse a "<Skill>/Skill history" subpage into its dated snapshots, newest
 * first. Each section carries a full {{Skill infobox}} of the skill as it
 * was; the final "Original" section is the release version.
 */
export function parseSkillHistory(title: string, wikitext: string): Parsed<ParsedSkillVersion[]> {
  const issues: string[] = [];
  const out: ParsedSkillVersion[] = [];
  for (const section of sections(wikitext)) {
    if (section.level !== 2) continue;
    const box = parseTemplate(section.body, "Skill infobox");
    if (!box) continue;
    out.push({
      date: headingDate(section.title),
      label: section.title,
      energyCost: parseWikiNumber(box["energy"]),
      adrenalineCost: parseWikiNumber(box["adrenaline"]),
      sacrificePercent: parseWikiNumber(box["sacrifice"]),
      upkeep: parseWikiNumber(box["upkeep"]),
      activation: parseWikiNumber(box["activation"]),
      recharge: parseWikiNumber(box["recharge"]),
      attribute: box["attribute"] ? stripMarkup(box["attribute"]) : null,
      isElite: isEliteFlag(box["elite"]),
      description: box["description"] ? stripMarkup(box["description"]) : "",
    });
  }
  if (out.length === 0) issues.push("no skill infobox snapshots found");
  // newest first; undated ("Original") sorts last
  out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { entity: out, issues };
}

// ---------------------------------------------------------------------------
// Quest
// ---------------------------------------------------------------------------

export interface ParsedQuest {
  name: string;
  wikiPage: string;
  campaign: string | null;
  region: string | null;
  /** "Primary", "Secondary", "Mini-mission", ... (template default: Secondary). */
  type: string;
  givenBy: string[];
  /** Where the quest is picked up. Several when the wiki lists alternatives. */
  givenAt: string[];
  /** Profession-specific quests only. */
  profession: string | null;
  /** `primary = y`: only characters whose PRIMARY is `profession`. */
  primaryOnly: boolean;
  /** `secondary = n`: characters with no secondary profession also qualify. */
  allowsNoSecondary: boolean;
  /** Quests listed as coming before. Shown for context, not enforced. */
  precededBy: string[];
}

/** Links in an infobox value; falls back to the plain text when unlinked. */
function refsOrText(value: string | undefined): string[] {
  if (!value) return [];
  const links = linkTargets(value).map((l) => l.replace(/%28/g, "(").replace(/%29/g, ")"));
  if (links.length > 0) return [...new Set(links)];
  const text = stripMarkup(value).trim();
  return text ? [text] : [];
}

/**
 * Parse a quest page's {{Quest infobox}}. Field meanings follow the
 * template's own documentation (Template:Quest infobox /
 * Template:Standard prerequisites), since they are easy to misread:
 * `primary = y` restricts to that PRIMARY profession (default: primary or
 * secondary), and `secondary = n` additionally admits characters with no
 * secondary at all.
 */
export function parseQuest(title: string, wikitext: string): Parsed<ParsedQuest> {
  const issues: string[] = [];
  const box = parseTemplate(wikitext, "Quest infobox");
  if (!box) issues.push("no Quest infobox");
  const givenAt = refsOrText(box?.["given at"]);
  if (box && givenAt.length === 0) issues.push("no 'given at' location");
  return {
    entity: {
      name: box?.["name"] ? stripMarkup(box["name"]) : title,
      wikiPage: title,
      campaign: box?.["campaign"] ? stripMarkup(box["campaign"]) : null,
      region: box?.["region"] ? stripMarkup(box["region"]) : null,
      type: box?.["type"] ? stripMarkup(box["type"]).replace(/<!--.*$/, "").trim() || "Secondary" : "Secondary",
      givenBy: refsOrText(box?.["given by"]),
      givenAt,
      profession: normalizeProfession(box?.["profession"]),
      primaryOnly: /^y/i.test(box?.["primary"]?.trim() ?? ""),
      allowsNoSecondary: /^n/i.test(box?.["secondary"]?.trim() ?? ""),
      precededBy: refsOrText(box?.["preceded by"]),
    },
    issues,
  };
}
