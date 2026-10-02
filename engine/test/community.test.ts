import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  campaignsUsed,
  decodeBuildCode,
  extractTemplateCodes,
  encodeTemplate,
  indexDataset,
  effectiveDate,
  mergeCommunityBuilds,
  Profession,
  staleSkills,
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

describe("dating a build and spotting stale ones", () => {
  const log = {
    generatedAt: "2026-10-02",
    since: "2024-10-02",
    windowMonths: 24,
    skills: [
      {
        skill: "Sever Artery",
        changes: [
          { date: "2026-08-26", note: "adrenaline 4 to 3", kind: "balance" as const, section: null },
        ],
        previous: null,
        previousIsStale: false,
      },
      {
        skill: "Gash",
        changes: [{ date: "2026-05-01", note: "fixed a typo", kind: "bugfix" as const, section: null }],
        previous: null,
        previousIsStale: false,
      },
    ],
  };
  const base = toCommunityBuild(CODE, decodeBuildCode(CODE, index)!, { kind: "other" }, "Sword bar", {
    firstSeen: "2026-09-18",
  });

  it("prefers the source's publication date over when we imported it", () => {
    expect(effectiveDate(base)).toBe("2026-09-18");
    const dated = { ...base, source: { ...base.source, postedAt: "2024-01-01" } };
    expect(effectiveDate(dated)).toBe("2024-01-01");
  });

  it("flags skills rebalanced after the build was published", () => {
    const dated = { ...base, source: { ...base.source, postedAt: "2024-01-01" } };
    const stale = staleSkills(dated, log);
    expect(stale.map((s) => s.skill)).toEqual(["Sever Artery"]);
    expect(stale[0].date).toBe("2026-08-26");
  });

  it("ignores changes the build already includes", () => {
    const recent = { ...base, source: { ...base.source, postedAt: "2026-09-01" } };
    expect(staleSkills(recent, log)).toEqual([]);
  });

  it("counts only balance changes, not bug fixes or AI retunes", () => {
    const dated = { ...base, source: { ...base.source, postedAt: "2024-01-01" } };
    // Gash's only change is a bugfix, so it must not appear
    expect(staleSkills(dated, log).map((s) => s.skill)).not.toContain("Gash");
  });

  it("judges nothing when the publication date is unknown", () => {
    // firstSeen alone is when WE imported it — not evidence about the build
    expect(base.source.postedAt).toBeUndefined();
    expect(staleSkills(base, log)).toEqual([]);
  });
});
