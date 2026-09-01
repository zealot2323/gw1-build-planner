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
  skills: Array<{ ref: SkillRef; skill: Skill | null; hardModeOnly: boolean }>;
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
 *
 * `hardMode` selects between normal and hard-mode-only blocks.
 */
export function variantsForLocation(
  monster: Monster,
  location: LocationRef,
  hardMode = false,
  /** Level for this zone from the location page, which beats the monster page. */
  levelHere?: number,
): MonsterVariant[] {
  const all = monster.variants ?? [];
  // hard-mode-only blocks are additional loadouts, shown only in hard mode
  const variants = hardMode ? all : all.filter((v) => !v.hardMode);
  if (variants.length <= 1) return variants;

  const named = variants.filter((v) => v.label !== null && v.label.includes(location));
  if (named.length > 0) return named;

  const level = levelHere ?? monster.locationLevels?.[location];
  if (level !== undefined) {
    const byLevel = variants.filter((v) => v.levels.includes(level));
    if (byLevel.length > 0) return byLevel;
  }
  return variants;
}

/** Every skill this creature can use in a given place, for a given mode. */
export function skillsForLocation(
  monster: Monster,
  location: LocationRef,
  hardMode = false,
  levelHere?: number,
): Array<{ ref: SkillRef; hardModeOnly: boolean }> {
  const applicable = variantsForLocation(monster, location, hardMode, levelHere);
  const out: Array<{ ref: SkillRef; hardModeOnly: boolean }> = [];
  const seen = new Set<SkillRef>();
  const add = (ref: SkillRef, hardModeOnly: boolean) => {
    if (seen.has(ref)) return;
    seen.add(ref);
    out.push({ ref, hardModeOnly });
  };
  if (applicable.length === 0) {
    for (const ref of monster.skills) add(ref, false);
    return out;
  }
  for (const v of applicable) {
    for (const ref of v.skills) add(ref, v.hardMode === true);
    if (hardMode) for (const ref of v.hardModeSkills ?? []) add(ref, true);
  }
  return out;
}

/**
 * Locations where this creature's stat block includes `skill` — the places
 * you could actually capture it. A boss whose elite only appears in its
 * high-level block can't be capped in the zones where the low-level block
 * applies (Riine Windrot's Offering of Blood is Thunderhead Keep only).
 */
export function locationsWithSkill(monster: Monster, skill: SkillRef): LocationRef[] {
  const variants = (monster.variants ?? []).filter((v) => !v.hardMode);
  if (variants.length === 0) {
    return monster.skills.includes(skill) ? monster.locations : [];
  }
  return monster.locations.filter((loc) =>
    variantsForLocation(monster, loc).some((v) => v.skills.includes(skill)),
  );
}

/**
 * Monsters spawning in a location (explorable) or a mission — the name is
 * looked up in both — with the skill bar and level for THIS place.
 * Unknown monster refs are skipped.
 */
export function monstersInLocation(
  location: LocationRef,
  index: DataIndex,
  hardMode = false,
): MonsterDisplay[] {
  const loc = index.locationByPage.get(location) ?? index.missionByName.get(location);
  if (!loc) return [];
  const bossSet = new Set(loc.bosses ?? []);
  const out: MonsterDisplay[] = [];
  for (const ref of [...loc.foes, ...(loc.bosses ?? [])]) {
    const monster = index.monsterByPage.get(ref);
    if (!monster) continue;

    // The location page's own foe line is the best source for the level
    // here; the monster page lists every level it appears at anywhere.
    const levelHere = loc.foeLevels?.[ref];
    const applicable = variantsForLocation(monster, location, hardMode, levelHere);
    const level = hardMode
      ? (loc.foeLevelsHard?.[ref] ?? monster.levelHard ?? monster.level)
      : (levelHere ??
        monster.locationLevels?.[location] ??
        (applicable.length === 1 ? (applicable[0].levels[0] ?? monster.level) : monster.level));

    out.push({
      monster,
      isBossHere: bossSet.has(ref) || monster.isBoss,
      skills: skillsForLocation(monster, location, hardMode, levelHere).map((s) => ({
        ...s,
        skill: index.skillByPage.get(s.ref) ?? null,
      })),
      armor: { base: monster.armor, table: monster.armorTable },
      level: level ?? null,
      variants: applicable.length > 1 ? applicable : [],
    });
  }
  return out;
}
