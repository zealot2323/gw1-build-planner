/**
 * Attributes and attribute points.
 *
 * Attribute ids are the game's own, taken from gw1tools/gw1builds (MIT);
 * the names are cross-checked against our scraped skills, which use exactly
 * these 44 for profession skills. Title-track "attributes" (Sunspear rank,
 * Asura rank, Allegiance rank...) scale with a title, not with points, and
 * are deliberately absent.
 */
import { Profession } from "./types.js";
import type { Build } from "./types.js";

/** Game attribute id per attribute name — the id template codes store. */
export const ATTRIBUTE_IDS: Readonly<Record<string, number>> = {
  "Fast Casting": 0,
  "Illusion Magic": 1,
  "Domination Magic": 2,
  "Inspiration Magic": 3,
  "Blood Magic": 4,
  "Death Magic": 5,
  "Soul Reaping": 6,
  Curses: 7,
  "Air Magic": 8,
  "Earth Magic": 9,
  "Fire Magic": 10,
  "Water Magic": 11,
  "Energy Storage": 12,
  "Healing Prayers": 13,
  "Smiting Prayers": 14,
  "Protection Prayers": 15,
  "Divine Favor": 16,
  Strength: 17,
  "Axe Mastery": 18,
  "Hammer Mastery": 19,
  Swordsmanship: 20,
  Tactics: 21,
  "Beast Mastery": 22,
  Expertise: 23,
  "Wilderness Survival": 24,
  Marksmanship: 25,
  "Dagger Mastery": 29,
  "Deadly Arts": 30,
  "Shadow Arts": 31,
  Communing: 32,
  "Restoration Magic": 33,
  "Channeling Magic": 34,
  "Critical Strikes": 35,
  "Spawning Power": 36,
  "Spear Mastery": 37,
  Command: 38,
  Motivation: 39,
  Leadership: 40,
  "Scythe Mastery": 41,
  "Wind Prayers": 42,
  "Earth Prayers": 43,
  Mysticism: 44,
};

export const ATTRIBUTE_BY_ID: ReadonlyMap<number, string> = new Map(
  Object.entries(ATTRIBUTE_IDS).map(([name, id]) => [id, name]),
);

/** Each profession's attributes, PRIMARY ATTRIBUTE FIRST. */
export const ATTRIBUTES_BY_PROFESSION: Readonly<Record<Profession, string[]>> = {
  [Profession.Warrior]: ["Strength", "Axe Mastery", "Hammer Mastery", "Swordsmanship", "Tactics"],
  [Profession.Ranger]: ["Expertise", "Beast Mastery", "Marksmanship", "Wilderness Survival"],
  [Profession.Monk]: ["Divine Favor", "Healing Prayers", "Smiting Prayers", "Protection Prayers"],
  [Profession.Necromancer]: ["Soul Reaping", "Blood Magic", "Curses", "Death Magic"],
  [Profession.Mesmer]: ["Fast Casting", "Domination Magic", "Illusion Magic", "Inspiration Magic"],
  [Profession.Elementalist]: ["Energy Storage", "Air Magic", "Earth Magic", "Fire Magic", "Water Magic"],
  [Profession.Assassin]: ["Critical Strikes", "Dagger Mastery", "Deadly Arts", "Shadow Arts"],
  [Profession.Ritualist]: ["Spawning Power", "Channeling Magic", "Communing", "Restoration Magic"],
  [Profession.Paragon]: ["Leadership", "Command", "Motivation", "Spear Mastery"],
  [Profession.Dervish]: ["Mysticism", "Earth Prayers", "Scythe Mastery", "Wind Prayers"],
};

export const primaryAttributeOf = (profession: Profession): string =>
  ATTRIBUTES_BY_PROFESSION[profession][0];

/** Attributes scaled by a title track, not by attribute points. */
export const isTitleAttribute = (attribute: string | null | undefined): boolean =>
  attribute !== null && attribute !== undefined && /\brank$/i.test(attribute);

/**
 * The attributes a build may spend points in: everything from the primary
 * profession, plus the secondary's — EXCEPT the secondary's primary
 * attribute, which only its own primaries have (no W/Mo has Divine Favor).
 */
export function attributesForBuild(build: Pick<Build, "primary" | "secondary">): string[] {
  const own = ATTRIBUTES_BY_PROFESSION[build.primary] ?? [];
  const second = build.secondary ? (ATTRIBUTES_BY_PROFESSION[build.secondary] ?? []).slice(1) : [];
  return [...own, ...second];
}

/** Highest rank attribute points alone can reach. */
export const MAX_RANK_FROM_POINTS = 12;

/**
 * Highest rank reachable in game: 12 from points, +1 from headgear, +3 from
 * a superior rune. Build sites quote these gear-inclusive numbers ("Dagger
 * Mastery 16"), so anything up to 16 is a real build, not a mistake.
 */
export const MAX_RANK_WITH_GEAR = 16;

/** Attribute points available at level 20 — the only level this plans for. */
export const ATTRIBUTE_POINTS_AT_20 = 200;

/** Cumulative point cost of each rank, index = rank. */
const CUMULATIVE_COST = [0, 1, 3, 6, 10, 15, 21, 28, 37, 48, 61, 77, 97];

/** Points to buy this rank from 0. Ranks above 12 cost nothing extra — they come from gear. */
export function costOfRank(rank: number): number {
  if (rank <= 0) return 0;
  return CUMULATIVE_COST[Math.min(rank, MAX_RANK_FROM_POINTS)];
}

/** Points the next rank would cost, or null at the cap. */
export function costOfNextRank(rank: number): number | null {
  if (rank >= MAX_RANK_FROM_POINTS) return null;
  return costOfRank(rank + 1) - costOfRank(rank);
}

export function pointsSpent(attributes: Record<string, number> | undefined): number {
  if (!attributes) return 0;
  return Object.values(attributes).reduce((sum, rank) => sum + costOfRank(rank), 0);
}

export const pointsRemaining = (attributes: Record<string, number> | undefined): number =>
  ATTRIBUTE_POINTS_AT_20 - pointsSpent(attributes);

/** Can this rank be afforded, given everything else already spent? */
export function canRaise(attributes: Record<string, number>, attribute: string): boolean {
  const rank = attributes[attribute] ?? 0;
  const next = costOfNextRank(rank);
  return next !== null && next <= pointsRemaining(attributes);
}
