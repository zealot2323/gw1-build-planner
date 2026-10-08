import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import {
  attachPvpVersions,
  decodeTemplate,
  encodeTemplate,
  indexDataset,
  Profession,
  schemas,
  skillInMode,
  type Build,
  type Dataset,
  type PvpSkillsFile,
} from "../src/index.js";

const data = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${f}`, import.meta.url)), "utf8"));
const pvpFile = data("pvp-skills.json") as PvpSkillsFile;
const index = indexDataset({
  skills: attachPvpVersions(data("skills.json"), pvpFile), locations: data("locations.json"),
  trainers: data("trainers.json"), monsters: data("monsters.json"), missions: data("missions.json"),
  quests: data("quests.json"),
} as Dataset);

const build = (skills: Array<string | null>, pvp?: boolean): Build => ({
  name: "t", character: "c", primary: Profession.Mesmer, secondary: Profession.Monk,
  ...(pvp === undefined ? {} : { pvp }),
  skills: [...skills, ...Array(8).fill(null)].slice(0, 8) as Build["skills"],
});

describe("PvP skill splits", () => {
  it("attaches every split to a skill we have, and the result still validates", () => {
    expect(Object.keys(pvpFile.skills).length).toBeGreaterThan(150);
    for (const page of Object.keys(pvpFile.skills)) expect(index.skillByPage.has(page)).toBe(true);
    const validate = new Ajv({ allErrors: true }).compile(schemas.skill.properties.pvp);
    for (const v of Object.values(pvpFile.skills)) expect(validate(v), JSON.stringify(validate.errors)).toBe(true);
  });

  it("plays the split in PvP and the PvE skill otherwise", () => {
    const resolve = index.skillByPage.get("Mantra of Resolve")!;
    expect(resolve.pvp?.wikiPage).toBe("Mantra of Resolve (PvP)");
    expect(skillInMode(resolve, false)).toBe(resolve);
    const pvp = skillInMode(resolve, true);
    expect(pvp.description).toMatch(/For 5 seconds/);
    expect(pvp.gwSkillId).toBe(resolve.pvp!.gwSkillId);
    // sources stay the PvE skill's: you learn the pair together
    expect(pvp.acquisition).toBe(resolve.acquisition);
    // a skill with no split is the same in both modes
    const gash = index.skillByPage.get("Gash")!;
    expect(skillInMode(gash, true)).toBe(gash);
  });

  it("puts PvP ids in a PvP build's code, and reads them back to the same skills", () => {
    const skills = ["Mantra of Resolve", "Gash", null, "Panic"];
    const pvpCode = encodeTemplate(build(skills, true), index);
    const pveCode = encodeTemplate(build(skills), index);
    expect(pvpCode).not.toBe(pveCode);

    const fromPvp = decodeTemplate(pvpCode, index);
    expect(fromPvp.skills.map((s) => s?.wikiPage ?? null), JSON.stringify(fromPvp)).toEqual(build(skills).skills);
    expect(fromPvp.pvpSkillCount).toBe(1);
    expect(fromPvp.unknownSkillIds).toEqual([]);
    expect(decodeTemplate(pveCode, index).pvpSkillCount).toBe(0);
  });
});

describe("community builds saved as PvP", () => {
  it("is PvP only when the tags say so and nothing says PvE", async () => {
    const { isPvpCommunityBuild } = await import("../src/index.js");
    expect(isPvpCommunityBuild({ tags: ["pvp", "gvg"] })).toBe(true);
    expect(isPvpCommunityBuild({ tags: ["HA"] })).toBe(true);
    expect(isPvpCommunityBuild({ tags: ["pvp", "pve"] })).toBe(false);
    expect(isPvpCommunityBuild({ tags: ["farming"] })).toBe(false);
    expect(isPvpCommunityBuild({})).toBe(false);
  });
});
