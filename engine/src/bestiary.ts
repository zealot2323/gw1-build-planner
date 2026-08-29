/**
 * Bestiary views. Pure — no I/O.
 */
import type { DataIndex } from "./data.js";
import type {
  ArmorEntry,
  LocationRef,
  Monster,
  MonsterVariant,
  Skill,
  SkillRef,
} from "./types.js";

export interface MonsterDisplay {
  monster: Monster;
  /** Listed in this location's Bosses section (vs regular foe). */
  isBossHere: boolean;
  /** Skill bar with dataset skills resolved (null = not a player skill). */
  skills: Array<{ ref: SkillRef; skill: Skill | null }>;
  armor: { base: number | null; table: ArmorEntry[] };
  /** Encounter level here, which can differ from the page's headline level. */
  level: number | null;
  /**
   * The stat block(s) that apply here. Empty when the page has only one.
   * More than one means the wiki lists simultaneous loadouts (e.g. Charr
   * Scout's "Warrior version" / "Ranger version") and we can't narrow it.
   */
  variants: MonsterVariant[];
}

/**
 * Which stat block applies to this creature in this place? Wiki pages key
 * their blocks three ways, so we try each in turn:
 *  1. the label names the location ("Gates of Kryta", "During Iron Mines
 *     of Moladune"),
 *  2. the label names a level and the Locations section says this place is
 *     that level (Riine Windrot is level 12 in Traveler's Vale, 28 in
 *     Thunderhead Keep),
 *  3. no match — the blocks are alternative loadouts for the same place, so
 *     all of them apply.
 */
export function variantsForLocation(monster: Monster, location: LocationRef): MonsterVariant[] {
  const variants = monster.variants ?? [];
  if (variants.length <= 1) return variants;

  const named = variants.filter((v) => v.label !== null && v.label.includes(location));
  if (named.length > 0) return named;

  const level = monster.locationLevels?.[location];
  if (level !== undefined) {
    const byLevel = variants.filter((v) => v.levels.includes(level));
    if (byLevel.length > 0) return byLevel;
  }
  return variants;
}

/**
 * Monsters spawning in a location (explorable) or a mission — the name is
 * looked up in both — with the skill bar and level for THIS place.
 * Unknown monster refs are skipped.
 */
export function monstersInLocation(location: LocationRef, index: DataIndex): MonsterDisplay[] {
  const loc = index.locationByPage.get(location) ?? index.missionByName.get(location);
  if (!loc) return [];
  const bossSet = new Set(loc.bosses ?? []);
  const out: MonsterDisplay[] = [];
  for (const ref of [...loc.foes, ...(loc.bosses ?? [])]) {
    const monster = index.monsterByPage.get(ref);
    if (!monster) continue;

    const applicable = variantsForLocation(monster, location);
    const skillRefs =
      applicable.length > 0 ? [...new Set(applicable.flatMap((v) => v.skills))] : monster.skills;
    const level =
      monster.locationLevels?.[location] ??
      (applicable.length === 1 ? (applicable[0].levels[0] ?? monster.level) : monster.level);

    out.push({
      monster,
      isBossHere: bossSet.has(ref) || monster.isBoss,
      skills: skillRefs.map((s) => ({ ref: s, skill: index.skillByPage.get(s) ?? null })),
      armor: { base: monster.armor, table: monster.armorTable },
      level: level ?? null,
      variants: applicable.length > 1 ? applicable : [],
    });
  }
  return out;
}
