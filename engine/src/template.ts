/**
 * Guild Wars build template codes — the "Bg..." strings you copy in and out
 * of the game.
 *
 * The binary format is implemented by @buildwars/gw-templates (MIT); this
 * module maps it onto our own types: profession ids to names, in-game skill
 * ids to our skills. Approach borrowed from gw1tools/gw1builds (MIT), which
 * wraps the same package.
 *
 * Attribute spreads travel in both directions: a pasted code keeps its
 * ranks, and a build exports the ranks it has.
 */
// @ts-expect-error — the package ships no type definitions
import { SkillTemplate } from "@buildwars/gw-templates";
import { ATTRIBUTE_BY_ID, ATTRIBUTE_IDS } from "./attributes.js";
import type { DataIndex } from "./data.js";
import { Profession } from "./types.js";
import type { Build, Skill, SkillRef } from "./types.js";

/** Template profession ids; index 0 is "no profession". */
const PROFESSION_BY_ID: readonly (Profession | null)[] = [
  null,
  Profession.Warrior,
  Profession.Ranger,
  Profession.Monk,
  Profession.Necromancer,
  Profession.Mesmer,
  Profession.Elementalist,
  Profession.Assassin,
  Profession.Ritualist,
  Profession.Paragon,
  Profession.Dervish,
];

const idOf = (profession: Profession | null): number =>
  profession === null ? 0 : Math.max(0, PROFESSION_BY_ID.indexOf(profession));

export interface DecodedTemplate {
  primary: Profession | null;
  secondary: Profession | null;
  /** Exactly 8 entries; null = empty slot or a skill we don't have. */
  skills: Array<Skill | null>;
  /** In-game ids the dataset has no skill for (PvP-only splits, new skills). */
  unknownSkillIds: number[];
  /** Attribute ranks by name; ids the game no longer uses are dropped. */
  attributes: Record<string, number>;
}

export class TemplateError extends Error {}

/**
 * Decode a template code. Throws TemplateError on anything unusable — the
 * code is pasted by a human, so a bad one is expected, not exceptional.
 */
export function decodeTemplate(code: string, index: DataIndex): DecodedTemplate {
  const trimmed = code.trim();
  if (trimmed === "") throw new TemplateError("Paste a template code first.");

  let raw: { prof_pri: number; prof_sec: number; attributes: Record<number, number>; skills: number[] };
  try {
    raw = new SkillTemplate().decode(trimmed);
  } catch (err) {
    throw new TemplateError(`That doesn't look like a build template code (${(err as Error).message}).`);
  }
  if (!raw || !Array.isArray(raw.skills)) throw new TemplateError("That doesn't look like a build template code.");

  const byId = new Map<number, Skill>();
  for (const s of index.dataset.skills) {
    byId.set(s.gwSkillId, s);
    // an allegiance skill's two sides share a name; either id resolves to it
    for (const id of Object.values(s.allegianceSkillIds ?? {})) byId.set(id, s);
  }

  const skills: Array<Skill | null> = [];
  const unknownSkillIds: number[] = [];
  for (let i = 0; i < 8; i++) {
    const id = raw.skills[i] ?? 0;
    if (id === 0) {
      skills.push(null);
      continue;
    }
    const skill = byId.get(id);
    if (skill) skills.push(skill);
    else {
      skills.push(null);
      unknownSkillIds.push(id);
    }
  }

  const attributes: Record<string, number> = {};
  for (const [id, rank] of Object.entries(raw.attributes ?? {})) {
    const name = ATTRIBUTE_BY_ID.get(Number(id));
    if (name !== undefined && rank > 0) attributes[name] = rank;
  }

  return {
    primary: PROFESSION_BY_ID[raw.prof_pri] ?? null,
    secondary: PROFESSION_BY_ID[raw.prof_sec] ?? null,
    skills,
    unknownSkillIds,
    attributes,
  };
}

/** Encode a build — skills and attribute ranks — as a template code. */
export function encodeTemplate(build: Build, index: DataIndex): string {
  const ids = build.skills.map((ref: SkillRef | null) => {
    if (ref === null) return 0;
    return index.skillByPage.get(ref)?.gwSkillId ?? 0;
  });
  const attributes: Record<number, number> = {};
  for (const [name, rank] of Object.entries(build.attributes ?? {})) {
    const id = ATTRIBUTE_IDS[name];
    if (id !== undefined && rank > 0) attributes[id] = rank;
  }
  try {
    return new SkillTemplate().encode(idOf(build.primary), idOf(build.secondary), attributes, ids);
  } catch (err) {
    throw new TemplateError(`Couldn't build a template code: ${(err as Error).message}`);
  }
}
