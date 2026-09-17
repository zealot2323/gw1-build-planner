import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeTemplate,
  encodeTemplate,
  indexDataset,
  Profession,
  TemplateError,
  type Build,
  type Dataset,
} from "../src/index.js";

const data = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${f}`, import.meta.url)), "utf8"));
const index = indexDataset({
  skills: data("skills.json"), locations: data("locations.json"), trainers: data("trainers.json"),
  monsters: data("monsters.json"), missions: data("missions.json"), quests: data("quests.json"),
} as Dataset);

const build = (skills: Array<string | null>, primary = Profession.Warrior, secondary: Profession | null = Profession.Monk): Build => ({
  name: "t", character: "c", primary, secondary,
  skills: [...skills, ...Array(8).fill(null)].slice(0, 8) as Build["skills"],
});

describe("build template codes", () => {
  it("round-trips a build through a code", () => {
    const original = build(["Sever Artery", "Gash", "Healing Signet", "Frenzy", null, null, null, "Resurrection Signet"]);
    const decoded = decodeTemplate(encodeTemplate(original, index), index);
    expect(decoded.primary).toBe(Profession.Warrior);
    expect(decoded.secondary).toBe(Profession.Monk);
    expect(decoded.skills.map((s) => s?.wikiPage ?? null)).toEqual(original.skills);
    expect(decoded.unknownSkillIds).toEqual([]);
  });

  it("writes attributes as zero, since they are out of scope", () => {
    const decoded = decodeTemplate(encodeTemplate(build(["Sever Artery"]), index), index);
    expect(Object.values(decoded.attributePoints).every((v) => v === 0)).toBe(true);
  });

  it("keeps empty slots empty", () => {
    const decoded = decodeTemplate(encodeTemplate(build([null, "Gash"]), index), index);
    expect(decoded.skills[0]).toBeNull();
    expect(decoded.skills[1]?.name).toBe("Gash");
    expect(decoded.skills).toHaveLength(8);
  });

  it("handles a build with no secondary", () => {
    const decoded = decodeTemplate(encodeTemplate(build(["Gash"], Profession.Warrior, null), index), index);
    expect(decoded.secondary).toBeNull();
  });

  it("reports skills the dataset doesn't have rather than dropping them silently", async () => {
    // A code from the game can name a PvP-split or brand-new skill we never
    // scraped. Build one directly with an id that isn't in the dataset.
    // @ts-expect-error - the package ships no type definitions
    const { SkillTemplate } = await import("@buildwars/gw-templates");
    const gash = index.skillByPage.get("Gash")!.gwSkillId;
    // 2040 is a valid-width id that no skill in the dataset uses
    const code = new SkillTemplate().encode(1, 3, {}, [gash, 2040, 0, 0, 0, 0, 0, 0]);
    const decoded = decodeTemplate(code, index);
    expect(decoded.skills[0]?.name).toBe("Gash");
    expect(decoded.skills[1]).toBeNull();
    expect(decoded.unknownSkillIds).toEqual([2040]);
  });

  it("rejects junk with a readable message", () => {
    expect(() => decodeTemplate("", index)).toThrow(TemplateError);
    expect(() => decodeTemplate("not-a-code!!", index)).toThrow(TemplateError);
    expect(() => decodeTemplate("   ", index)).toThrow(/Paste a template code/);
  });
});

describe("buildReadiness", () => {
  it("separates known from missing, nearest first, and knows when a build is ready", async () => {
    const { buildReadiness, travelDistances } = await import("../src/index.js");
    const character = {
      name: "W", primaryProfession: Profession.Warrior, unlockedSecondaries: [Profession.Monk],
      knownSkills: ["Sever Artery", "Gash"], unlockedLocations: ["Ascalon City"], completedMissions: [],
      campaign: "Prophecies" as const, ownedCampaigns: ["Prophecies" as const],
    };
    const b = build(["Sever Artery", "Gash", "Backbreaker", "Healing Signet"]);
    const r = buildReadiness(b, character, index, travelDistances(character, index));
    expect(r.filled).toBe(4);
    expect(r.known).toBe(2);
    expect(r.ready).toBe(false);
    expect(r.missing.map((s) => s.ref)).toHaveLength(2);
    // nearest first: Healing Signet is sold in Ascalon City, Backbreaker is a far capture
    expect(r.missing[0].ref).toBe("Healing Signet");
    expect(r.missing[0].entry?.status).toBe("PURCHASABLE_NOW");

    const allKnown = { ...character, knownSkills: ["Sever Artery", "Gash"] };
    const small = build(["Sever Artery", "Gash"]);
    expect(buildReadiness(small, allKnown, index).ready).toBe(true);
  });

  it("carries build validation errors", async () => {
    const { buildReadiness } = await import("../src/index.js");
    const character = {
      name: "W", primaryProfession: Profession.Warrior, unlockedSecondaries: [],
      knownSkills: [], unlockedLocations: [], completedMissions: [],
    };
    // two elites is illegal
    const r = buildReadiness(build(["Backbreaker", "Dragon Slash"]), character, index);
    expect(r.errors.some((e) => e.code === "TOO_MANY_ELITES")).toBe(true);
  });
});
