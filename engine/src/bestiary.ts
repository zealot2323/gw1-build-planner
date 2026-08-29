/**
 * Bestiary views. Pure — no I/O.
 */
import type { DataIndex } from "./data.js";
import type { ArmorEntry, LocationRef, Monster, Skill, SkillRef } from "./types.js";

export interface MonsterDisplay {
  monster: Monster;
  /** Listed in this location's Bosses section (vs regular foe). */
  isBossHere: boolean;
  /** Skill bar with dataset skills resolved (null = not a player skill). */
  skills: Array<{ ref: SkillRef; skill: Skill | null }>;
  armor: { base: number | null; table: ArmorEntry[] };
}

/**
 * Monsters spawning in a location (explorable) or a mission — the name is
 * looked up in both — with skill bars and armor, ready for display.
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
    out.push({
      monster,
      isBossHere: bossSet.has(ref) || monster.isBoss,
      skills: monster.skills.map((s) => ({ ref: s, skill: index.skillByPage.get(s) ?? null })),
      armor: { base: monster.armor, table: monster.armorTable },
    });
  }
  return out;
}
