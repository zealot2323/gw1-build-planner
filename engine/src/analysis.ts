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
  | "Enemy healing"
  | "Resurrection"
  | "Enchantment removal"
  | "Knockdown"
  | "Life stealing"
  | "Armor ignoring";

/** Does this skill act on the enemy's own side (heals, buffs, protection)? */
function isFriendlySkill(text: string): boolean {
  return /target (other )?all(y|ies)|all allies|your allies|party members|target's? party|yourself|\bself\b/.test(text)
    && !/target foe|target's? foes|enemy|foes in/.test(text);
}

const TAG_PATTERNS: Array<[ThreatTag, RegExp]> = [
  // NOTE: patterns are word-anchored on purpose. A bare "heal" substring
  // also matches "Health", which tagged every damage skill as healing.
  ["Interrupts", /\binterrupt/],
  ["Energy denial", /loses? \d[^.]*energy|\bsteal[^.]*energy|energy loss|lose all[^.]*energy/],
  ["Melee denial", /\bblind|cannot attack|\bmiss\b|attack speed[^.]*(reduced|slowed)|\bblocks?\b|\bevade/],
  ["Caster denial", /\bdazed\b|spell failure|cannot cast|casting time[^.]*doubled|\bbackfire\b|takes? damage[^.]*cast/],
  ["Knockdown", /knock(ed|s)? ?down|\bknockdown\b/],
  ["Degeneration", /health degeneration|energy degeneration/],
  ["Condition pressure", /\bpoison|\bdiseas|\bbleed|\bburning\b|\bcrippl|\bweakness\b|deep wound|\bdazed\b|negative condition|spread[^.]*condition|transfer[^.]*condition/],
  ["Hex pressure", /\bhex(es|ed)?\b/],
  ["Enchantment removal", /remove [^.]*enchantment|strip[^.]*enchantment|enchantment[^.]*removed|lose[^.]*enchantment/],
  ["Enemy healing", /\bheals?\b|\bhealed\b|\bhealing\b|health regeneration|\bregenerat/],
  ["Resurrection", /\bresurrect|return to life|\brebirth\b/],
  ["Life stealing", /\bsteals?\b[^.]*health|life steal/],
  ["Armor ignoring", /armor.?ignoring|ignores armor|holy damage|shadow damage|chaos damage/],
];

/** Area-of-effect wording, regardless of who it lands on. */
const AOE = /all adjacent|all nearby|adjacent foes|nearby foes|in th(e|at) area\b|foes near|foes adjacent|foes in that|all foes|party members|all allies/;

/**
 * Classify a skill by what it does TO A PLAYER PARTY, from its description
 * text — the wiki has no structured "this is an interrupt" field.
 *
 * Two judgement calls worth knowing about:
 *  - "Heavy AoE" means area PRESSURE, not merely an area-shaped skill. Heal
 *    Area hits an area but heals the enemy's own side, so it is enemy
 *    healing, not AoE. Conversely an area hex or an area condition IS AoE
 *    pressure even though it deals no direct damage.
 *  - friendly-target skills never earn offensive tags.
 */
export function threatTagsForSkill(description: string, name: string): ThreatTag[] {
  const text = `${name}. ${description}`.toLowerCase();
  const friendly = isFriendlySkill(text);
  const tags = new Set<ThreatTag>();

  for (const [tag, re] of TAG_PATTERNS) {
    if (!re.test(text)) continue;
    // an enemy monk's protective//healing kit shouldn't read as pressure
    const offensive = tag !== "Enemy healing" && tag !== "Resurrection";
    if (friendly && offensive) continue;
    tags.add(tag);
  }

  // Area pressure: an AoE shape that actually threatens the party — damage,
  // a condition, a hex, or degeneration.
  const pressures: ThreatTag[] = ["Condition pressure", "Hex pressure", "Degeneration", "Knockdown"];
  const dealsDamage = /\bdamage\b/.test(text) && !friendly;
  if (AOE.test(text) && !friendly && (dealsDamage || pressures.some((p) => tags.has(p)))) {
    tags.add("Heavy AoE");
  }
  return [...tags];
}

export interface ThreatCount {
  tag: ThreatTag;
  /** How many distinct skills across the zone carry this tag. */
  skills: number;
  /** The skills behind the tag, so the UI can show its working. */
  examples: SkillRef[];
}

export interface SpeciesCount {
  species: string;
  count: number;
  /** Professions seen in this group. */
  professions: Profession[];
  bosses: string[];
}

/** A zone-wide tactical note that is not a skill tag. */
export interface ZoneNote {
  kind: "weakness" | "strength";
  text: string;
  /** Which creatures it applies to. */
  detail: string;
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
  /** One-off threats that didn't clear the noise floor. */
  minorThreats: ThreatCount[];
  /** Zone-wide weaknesses and resistances worth building around. */
  notes: ZoneNote[];
}

/**
 * Creature types that take double damage from holy. The infobox
 * "affiliation" field is the reliable marker — species alone is not, since
 * "Zombie"/"Skeleton" pages vary.
 */
const UNDEAD_AFFILIATIONS = /undead/i;

/** Below this many distinct skills a tag is noise, not a zone trait. */
const THREAT_FLOOR = 2;

/**
 * Summarize a zone: who lives there, what tactics they bring, and what to
 * build around. Built from the skill bars that actually apply in this
 * location (so it respects per-zone variants and the hard mode toggle).
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
  let undead = 0;

  for (const entry of monsters) {
    const { monster, level, isBossHere, skills, armor } = entry;
    if (isBossHere) bossCount++;
    if (level !== null) {
      min = Math.min(min, level);
      max = Math.max(max, level);
    }
    if (UNDEAD_AFFILIATIONS.test(monster.affiliation ?? "")) undead++;

    const species = monster.species ?? "Unknown";
    if (!bySpecies.has(species)) bySpecies.set(species, { monsters: [], professions: new Set(), bosses: [] });
    const group = bySpecies.get(species)!;
    group.monsters.push(monster);
    if (monster.profession) group.professions.add(monster.profession);
    if (isBossHere) group.bosses.push(monster.name);

    for (const { ref, skill } of skills) {
      for (const t of threatTagsForSkill(skill?.description ?? "", ref)) {
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

  const allTags: ThreatCount[] = [...tagSkills.entries()]
    .map(([tag, set]) => ({ tag, skills: set.size, examples: [...set].sort() }))
    .sort((a, b) => b.skills - a.skills || a.tag.localeCompare(b.tag));

  // a damage type is worth calling out when a third of the zone shares it
  const threshold = Math.max(2, Math.ceil(monsters.length / 3));
  const pick = (m: Map<string, number>) =>
    [...m.entries()].filter(([, n]) => n >= threshold).sort(([, a], [, b]) => b - a).map(([t]) => t);

  const notes: ZoneNote[] = [];
  if (undead >= Math.max(2, Math.ceil(monsters.length / 4))) {
    notes.push({
      kind: "weakness",
      text: "Holy damage does double damage",
      detail: `${undead} undead foe${undead === 1 ? "" : "s"}`,
    });
  }
  const exploit = pick(weak);
  if (exploit.length > 0) {
    notes.push({ kind: "weakness", text: `Low armor vs ${exploit.join(", ")}`, detail: "most foes here" });
  }
  const resisted = pick(strong);
  if (resisted.length > 0) {
    notes.push({ kind: "strength", text: `High armor vs ${resisted.join(", ")}`, detail: "most foes here" });
  }

  return {
    location,
    monsterCount: monsters.length,
    bossCount,
    levelRange: min === Infinity ? null : { min, max },
    groups,
    threats: allTags.filter((t) => t.skills >= THREAT_FLOOR),
    minorThreats: allTags.filter((t) => t.skills < THREAT_FLOOR),
    notes,
  };
}
