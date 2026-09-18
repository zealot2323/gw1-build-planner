import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  campaignsUsed,
  decodeBuildCode,
  extractTemplateCodes,
  encodeTemplate,
  indexDataset,
  mergeCommunityBuilds,
  Profession,
  toCommunityBuild,
  type Build,
  type CommunityBuild,
  type Dataset,
} from "../src/index.js";

const data = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${f}`, import.meta.url)), "utf8"));
const index = indexDataset({
  skills: data("skills.json"), locations: data("locations.json"), trainers: data("trainers.json"),
  monsters: data("monsters.json"), missions: data("missions.json"), quests: data("quests.json"),
} as Dataset);

const build = (skills: string[], primary = Profession.Warrior, secondary: Profession | null = Profession.Monk): Build => ({
  name: "b", character: "c", primary, secondary,
  skills: [...skills, ...Array(8).fill(null)].slice(0, 8) as Build["skills"],
});

const swordBar = build(["Sever Artery", "Gash", "Final Thrust", "Healing Signet", "Frenzy", "Sprint"]);
const CODE = encodeTemplate(swordBar, index);

describe("finding template codes in text", () => {
  it("pulls a code out of a sentence", () => {
    const text = `Here's my sword warrior: ${CODE} — works great in HM.`;
    const found = extractTemplateCodes(text, index);
    expect(found).toHaveLength(1);
    expect(found[0].code).toBe(CODE);
    expect(found[0].decoded.primary).toBe(Profession.Warrior);
  });

  it("finds several codes and ignores repeats", () => {
    const other = encodeTemplate(build(["Backfire", "Empathy", "Shatter Delusions"], Profession.Mesmer, null), index);
    const found = extractTemplateCodes(`${CODE} and ${other} and ${CODE} again`, index);
    expect(found.map((f) => f.code).sort()).toEqual([CODE, other].sort());
  });

  it("ignores base64-looking text that isn't a build", () => {
    // image ids, tracking params and ordinary words all match the shape
    const text = "Check https://i.redd.it/Oabcdefghijklmnop.jpg?utm=OQQQQQQQQQQQ and OOOOOOOOOOOO";
    for (const { code } of extractTemplateCodes(text, index)) {
      // anything that survives must be a real build, not noise
      expect(decodeBuildCode(code, index)).not.toBeNull();
    }
  });

  it("rejects a code with too few skills we recognise", () => {
    const thin = encodeTemplate(build(["Sever Artery"]), index);
    expect(decodeBuildCode(thin, index)).toBeNull();
  });

  it("reports which campaigns a build needs, and none for an all-Core bar", () => {
    // every skill on the sword bar is Core, so it needs no particular campaign
    expect(campaignsUsed(decodeBuildCode(CODE, index)!)).toEqual([]);
    const canthan = encodeTemplate(
      build(["Shadow Refuge", "Unsuspecting Strike", "Dancing Daggers"], Profession.Assassin, null),
      index,
    );
    expect(campaignsUsed(decodeBuildCode(canthan, index)!)).toEqual(["Factions"]);
  });
});

describe("merging community builds", () => {
  const make = (code: string, kind: CommunityBuild["source"]["kind"], name: string, score?: number): CommunityBuild =>
    toCommunityBuild(code, decodeBuildCode(CODE, index)!, { kind, score }, name, { firstSeen: "2026-01-01" });

  it("adds builds it hasn't seen", () => {
    const r = mergeCommunityBuilds([], [make(CODE, "reddit", "From reddit")]);
    expect(r.added).toBe(1);
    expect(r.builds).toHaveLength(1);
  });

  it("keeps the first-seen date and curated name when a build reappears", () => {
    const curated = make(CODE, "file", "Cracked Armor Warrior");
    const crawled = { ...make(CODE, "reddit", "some reddit thread title", 120), firstSeen: "2026-09-18" };
    const r = mergeCommunityBuilds([curated], [crawled]);
    expect(r.builds).toHaveLength(1);
    expect(r.builds[0].name).toBe("Cracked Armor Warrior");
    expect(r.builds[0].firstSeen).toBe("2026-01-01");
    expect(r.builds[0].source.kind).toBe("file"); // curation wins over a crawl
    expect(r.builds[0].source.score).toBe(120); // but the fresh score is taken
  });

  it("refreshes a crawled build in place rather than duplicating it", () => {
    const first = make(CODE, "reddit", "thread", 10);
    const again = { ...make(CODE, "reddit", "thread", 400), firstSeen: "2026-09-18" };
    const r = mergeCommunityBuilds([first], [again]);
    expect(r.builds).toHaveLength(1);
    expect(r.builds[0].source.score).toBe(400);
    expect(r.builds[0].firstSeen).toBe("2026-01-01");
  });
});
