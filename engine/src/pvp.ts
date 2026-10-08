/**
 * PvP skill splits.
 *
 * ArenaNet balances ~200 skills separately for PvP: "Mantra of Resolve" lasts
 * 30...90 seconds in PvE and 5 in PvP. In-game they are two skills with two
 * ids, but a character that learns one has both, and the game swaps in the
 * PvP version in PvP areas. So the planner keeps ONE skill — its sources,
 * availability and build rules are the PvE skill's — and carries the split's
 * id, text and numbers alongside it as `skill.pvp`.
 *
 * The splits come from data/pvp-skills.json (`npm run pvp`), kept out of
 * skills.json so it can be regenerated without re-running the wiki parse.
 */
import type { Skill, SkillPvpVersion, SkillRef } from "./types.js";

/** data/pvp-skills.json. */
export interface PvpSkillsFile {
  /** Where the numbers came from. */
  source: string;
  /** PvE skill page -> its PvP split. */
  skills: Record<SkillRef, SkillPvpVersion>;
}

/**
 * Return the skills with their PvP splits attached. New objects — the
 * caller's array is left as it was.
 */
export function attachPvpVersions(skills: Skill[], file: PvpSkillsFile | null | undefined): Skill[] {
  if (!file) return skills;
  return skills.map((s) => {
    const pvp = file.skills[s.wikiPage];
    return pvp ? { ...s, pvp } : s;
  });
}

/**
 * The skill as it plays in the chosen mode: in PvP, the split's id, text
 * and numbers over the PvE skill; otherwise the skill unchanged. Name,
 * sources and everything else stay the PvE skill's.
 */
export function skillInMode(skill: Skill, pvp: boolean): Skill {
  if (!pvp || !skill.pvp) return skill;
  const v = skill.pvp;
  return {
    ...skill,
    gwSkillId: v.gwSkillId,
    description: v.description,
    concise: v.concise ?? skill.concise,
    energyCost: v.energyCost,
    adrenalineCost: v.adrenalineCost,
    sacrificePercent: v.sacrificePercent ?? null,
    activation: v.activation,
    aftercast: v.aftercast ?? null,
    exhaustion: v.exhaustion ?? null,
    recharge: v.recharge,
    tags: v.tags ?? skill.tags,
  };
}
