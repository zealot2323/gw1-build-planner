/**
 * Zone analysis: what is this place actually going to do to you?
 * Pure functions over the dataset — no I/O.
 */
import { monstersInLocation } from "./bestiary.js";
import type { DataIndex } from "./data.js";
import type { ArmorEntry, LocationRef, Monster, Profession, SkillRef } from "./types.js";

// ---------------------------------------------------------------------------
// Armor
// ---------------------------------------------------------------------------

export interface ArmorProfile {
  /** The rating this creature has against most damage types. */
  base: number | null;
  /** Damage types it takes LESS damage from (higher armor) — avoid these. */
  strongVs: string[];
  /** Damage types it takes MORE damage from (lower armor) — exploit these. */
  weakVs: string[];
}

/**
 * Reduce a 7-row armor table to the part worth reading: the baseline rating
 * plus the damage types that deviate from it. Listing seven numbers hides
 * the one fact that matters — where the soft spot is.
 */
export function armorProfile(table: ArmorEntry[]): ArmorProfile {
  const rows = table.filter((r) => r.damageType !== "base" && r.damageType !== "armor");
  if (rows.length === 0) {
    const base = table.find((r) => r.damageType === "base" || r.damageType === "armor");
    return { base: base?.rating ?? null, strongVs: [], weakVs: [] };
  }
  // baseline = the median rating. The mode breaks badly on the common
  // 3-physical / 3-elemental / 1-odd split, where both sides tie and the
  // "baseline" becomes arbitrary; the median always lands on the bulk.
  const sorted = rows.map((r) => r.rating).sort((a, b) => a - b);
  const base = sorted[Math.floor(sorted.length / 2)];
  return {
    base,
    strongVs: rows.filter((r) => r.rating > base).map((r) => r.damageType),
    weakVs: rows.filter((r) => r.rating < base).map((r) => r.damageType),
  };
}

/**
 * Explorables reachable from an outpost/town, for the zone browser's tree.
 * A zone can hang off several outposts — that mirrors the game, where most
 * areas have more than one entrance.
 */
export function explorablesFrom(outpost: LocationRef, index: DataIndex): LocationRef[] {
  const loc = index.locationByPage.get(outpost);
  if (!loc || loc.kind === "explorable") return [];
  return loc.neighbors.filter((n) => index.locationByPage.get(n)?.kind === "explorable");
}

// ---------------------------------------------------------------------------
// Threat tags
// ---------------------------------------------------------------------------

export type ThreatTag =
  | "Heavy AoE"
  | "Interrupts"
  | "Energy denial"
  | "Melee denial"
  | "Caster denial"
  | "Hex pressure"
  | "Condition pressure"
  | "Degeneration"
  | "Healing"
  | "Resurrection"
  | "Enchantment removal"
  | "Knockdown"
  | "Life stealing"
  | "Armor ignoring";

/**
 * Classify a skill by what it does TO A PLAYER PARTY. Driven by the skill's
 * description text and type, because the wiki has no structured field for
 * "this is an interrupt". Deliberately generous: a zone summary is a warning,
 * not a spreadsheet.
 */
const TAG_PATTERNS: Array<[ThreatTag, RegExp]> = [
  // NOTE: patterns are word-anchored on purpose. A bare "heal" substring
  // also matches "Health", which tagged every damage skill as healing.
  ["Heavy AoE", /all adjacent|all nearby|adjacent foes|nearby foes|in th(e|at) area\b|foes near|foes adjacent|foes in that/],
  ["Interrupts", /\binterrupt/],
  ["Energy denial", /loses? \d[^.]*energy|\bsteal[^.]*energy|energy loss|lose all[^.]*energy/],
  ["Melee denial", /\bblind|cannot attack|\bmiss\b|attack speed[^.]*(reduced|slowed)|\bblocks?\b|\bevade/],
  ["Caster denial", /\bdazed\b|spell failure|cannot cast|casting time[^.]*doubled|\bbackfire\b|takes? damage[^.]*cast/],
  ["Knockdown", /knock(ed|s)? ?down|\bknockdown\b/],
  ["Degeneration", /health degeneration|energy degeneration/],
  ["Condition pressure", /\bpoison|\bdiseas|\bbleed|\bburning\b|\bcrippl|\bweakness\b|deep wound/],
  ["Hex pressure", /\bhex(es|ed)?\b/],
  ["Enchantment removal", /remove [^.]*enchantment|strip[^.]*enchantment|enchantment[^.]*removed|lose[^.]*enchantment/],
  ["Healing", /\bheals?\b|\bhealed\b|\bhealing\b|health regeneration|\bregenerat/],
  ["Resurrection", /\bresurrect|return to life|\brebirth\b/],
  ["Life stealing", /\bsteals?\b[^.]*health|life steal/],
  ["Armor ignoring", /armor.?ignoring|ignores armor|holy damage|shadow damage|chaos damage/],
];

/**
 * Classify a skill by what it does TO A PLAYER PARTY, from its description
 * text — the wiki has no structured "this is an interrupt" field. A zone
 * summary is a warning, not a spreadsheet, so the matching is deliberately
 * broad; it is anchored on word boundaries to avoid false hits.
 */
export function threatTagsForSkill(description: string, name: string): ThreatTag[] {
  const text = `${name}. ${description}`.toLowerCase();
  return TAG_PATTERNS.filter(([, re]) => re.test(text)).map(([tag]) => tag);
}

export interface ThreatCount {
  tag: ThreatTag;
  /** How many distinct skills across the zone carry this tag. */
  skills: number;
  /** Example skills, for the tooltip. */
  examples: SkillRef[];
}

export interface SpeciesCount {
  species: string;
  count: number;
  /** Professions seen in this group. */
  professions: Profession[];
  bosses: string[];
}

export interface ZoneSummary {
  location: LocationRef;
  monsterCount: number;
  bossCount: number;
  levelRange: { min: number; max: number } | null;
  /** Enemy groups, largest first. */
  groups: SpeciesCount[];
  /** What the zone throws at you, most common first. */
  threats: ThreatCount[];
  /** Damage types most enemies here are soft against. */
  exploitDamage: string[];
  /** Damage types most enemies here resist. */
  resistedDamage: string[];
}

/**
 * Summarize a zone: who lives there and what tactics they bring. Built from
 * the skill bars that actually apply in this location (so it respects the
 * per-zone variants and the hard mode toggle).
 */
export function zoneSummary(
  location: LocationRef,
  index: DataIndex,
  hardMode = false,
): ZoneSummary {
  const monsters = monstersInLocation(location, index, hardMode);

  const bySpecies = new Map<string, { monsters: Monster[]; professions: Set<Profession>; bosses: string[] }>();
  const tagSkills = new Map<ThreatTag, Set<SkillRef>>();
  const strong = new Map<string, number>();
  const weak = new Map<string, number>();
  let min = Infinity;
  let max = -Infinity;
  let bossCount = 0;

  for (const entry of monsters) {
    const { monster, level, isBossHere, skills, armor } = entry;
    if (isBossHere) bossCount++;
    if (level !== null) {
      min = Math.min(min, level);
      max = Math.max(max, level);
    }

    const species = monster.species ?? "Unknown";
    if (!bySpecies.has(species)) bySpecies.set(species, { monsters: [], professions: new Set(), bosses: [] });
    const group = bySpecies.get(species)!;
    group.monsters.push(monster);
    if (monster.profession) group.professions.add(monster.profession);
    if (isBossHere) group.bosses.push(monster.name);

    for (const { ref, skill } of skills) {
      const tags = threatTagsForSkill(skill?.description ?? "", ref);
      for (const t of tags) {
        if (!tagSkills.has(t)) tagSkills.set(t, new Set());
        tagSkills.get(t)!.add(ref);
      }
    }

    const profile = armorProfile(armor.table);
    for (const t of profile.strongVs) strong.set(t, (strong.get(t) ?? 0) + 1);
    for (const t of profile.weakVs) weak.set(t, (weak.get(t) ?? 0) + 1);
  }

  const groups: SpeciesCount[] = [...bySpecies.entries()]
    .map(([species, g]) => ({
      species,
      count: g.monsters.length,
      professions: [...g.professions],
      bosses: g.bosses,
    }))
    .sort((a, b) => b.count - a.count || a.species.localeCompare(b.species));

  const threats: ThreatCount[] = [...tagSkills.entries()]
    .map(([tag, set]) => ({ tag, skills: set.size, examples: [...set].slice(0, 6) }))
    .sort((a, b) => b.skills - a.skills || a.tag.localeCompare(b.tag));

  // a damage type is worth calling out when it applies to a third of the zone
  const threshold = Math.max(2, Math.ceil(monsters.length / 3));
  const pick = (m: Map<string, number>) =>
    [...m.entries()].filter(([, n]) => n >= threshold).sort(([, a], [, b]) => b - a).map(([t]) => t);

  return {
    location,
    monsterCount: monsters.length,
    bossCount,
    levelRange: min === Infinity ? null : { min, max },
    groups,
    threats,
    exploitDamage: pick(weak),
    resistedDamage: pick(strong),
  };
}
