/**
 * Reading GWToolbox completion files. The fixtures are built by setting
 * the same bits the game would, so the test exercises the real id tables
 * in data/map-ids.json rather than a hand-written sample.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bitAt,
  changedAnything,
  decodeCharacter,
  indexDataset,
  isCompletionFile,
  mergeCompletion,
  Profession,
  type Character,
  type Dataset,
  type MapIdTable,
  type ToolboxCharacter,
} from "../src/index.js";

const data = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${f}`, import.meta.url)), "utf8"));
const index = indexDataset({
  skills: data("skills.json"), locations: data("locations.json"), trainers: data("trainers.json"),
  monsters: data("monsters.json"), missions: data("missions.json"), quests: data("quests.json"),
} as Dataset);
const mapIds: MapIdTable = data("map-ids.json");

/** Pack ids into the 32-bit words the game uses. */
const bits = (ids: number[]): number[] => {
  const words: number[] = [];
  for (const id of ids) {
    const word = id >>> 5;
    while (words.length <= word) words.push(0);
    words[word] |= 1 << (id & 31);
  }
  return words;
};

const idsOf = (page: string) => mapIds.locations[page] ?? [];
const missionIds = (name: string) => mapIds.missions[name] ?? [];
const skillId = (page: string) => index.skillByPage.get(page)!.gwSkillId;

describe("bitfields", () => {
  it("reads the bit the game set", () => {
    const words = bits([0, 31, 32, 1000]);
    for (const id of [0, 31, 32, 1000]) expect(bitAt(words, id), String(id)).toBe(true);
    for (const id of [1, 30, 33, 999, 5000]) expect(bitAt(words, id), String(id)).toBe(false);
  });

  it("treats a missing or short array as nothing set", () => {
    expect(bitAt(undefined, 5)).toBe(false);
    expect(bitAt([0], 9999)).toBe(false);
  });

  it("does not sign-flip on bit 31", () => {
    // 1 << 31 is negative in JS; the word holds it anyway
    expect(bitAt(bits([31]), 31)).toBe(true);
    expect(bitAt(bits([31]), 30)).toBe(false);
  });
});

describe("decoding a character", () => {
  const record: ToolboxCharacter = {
    profession: 10, // Dervish
    skills: bits([skillId("Healing Breeze"), skillId("Mind Burn")]),
    maps_unlocked: bits([...idsOf("Lion's Arch"), ...idsOf("Kamadan, Jewel of Istan")]),
    mission: bits(missionIds("The Great Northern Wall")),
    mission_hm: bits(missionIds("The Great Northern Wall")),
    mission_bonus: bits(missionIds("The Great Northern Wall")),
    vanquishes: bits([...idsOf("Regent Valley"), ...idsOf("Lion's Arch")]),
  };
  const decoded = decodeCharacter("Kaela Sunreach", record, index, mapIds);

  it("reads the profession, skills, maps and missions", () => {
    expect(decoded.profession).toBe(Profession.Dervish);
    expect(decoded.knownSkills).toEqual(["Healing Breeze", "Mind Burn"]);
    expect(decoded.unlockedLocations).toContain("Lion's Arch");
    expect(decoded.unlockedLocations).toContain("Kamadan, Jewel of Istan");
    expect(decoded.completedMissions).toEqual(["The Great Northern Wall"]);
    expect(decoded.completedMissionsHard).toEqual(["The Great Northern Wall"]);
    expect(decoded.missionBonuses).toEqual(["The Great Northern Wall"]);
    expect(decoded.missionBonusesHard).toEqual([]);
  });

  it("counts only explorable areas as vanquished", () => {
    // the fixture sets a bit for a town as well, which cannot be vanquished
    expect(decoded.vanquishedAreas).toEqual(["Regent Valley"]);
  });

  it("keeps pre-Searing apart from post-Searing", () => {
    const pre = idsOf("Ascalon City (pre-Searing)");
    const post = idsOf("Ascalon City");
    expect(pre.length).toBeGreaterThan(0);
    expect(post.length).toBeGreaterThan(0);
    expect(pre.some((id) => post.includes(id))).toBe(false);

    const newbie = decodeCharacter("Pre", { is_pre_searing: true, maps_unlocked: bits(pre) }, index, mapIds);
    expect(newbie.unlockedLocations).toContain("Ascalon City (pre-Searing)");
    expect(newbie.unlockedLocations).not.toContain("Ascalon City");
  });
});

describe("merging an import into the save", () => {
  const base: Character = {
    name: "Kaela Sunreach",
    primaryProfession: Profession.Dervish,
    unlockedSecondaries: [Profession.Monk],
    knownSkills: ["Healing Breeze"],
    unlockedLocations: ["Lion's Arch"],
    completedMissions: [],
    campaign: "Nightfall",
    ownedCampaigns: ["Nightfall"],
    todos: [{ id: "t1", kind: "skill", ref: "Mind Burn", done: false, added: "2026-10-01" }],
  };
  const file = {
    "Kaela Sunreach": {
      profession: 10,
      skills: bits([skillId("Mind Burn")]),
      maps_unlocked: bits(idsOf("Kamadan, Jewel of Istan")),
      mission: bits(missionIds("Chahbek Village")),
    },
    "Shen Quickblade": {
      profession: 7,
      maps_unlocked: bits(idsOf("Shing Jea Monastery")),
    },
    "PvP Alt": { profession: 1, is_pvp: true, skills: bits([skillId("Mind Burn")]) },
  };
  const merged = mergeCompletion([base], file, index, mapIds, (c) => ({ ...c, builds: [] }));

  it("adds what the file knows without removing anything", () => {
    const kaela = merged.characters.find((c) => c.name === "Kaela Sunreach")!;
    expect(kaela.knownSkills).toEqual(["Healing Breeze", "Mind Burn"]);
    expect(kaela.unlockedLocations).toContain("Lion's Arch");
    expect(kaela.unlockedLocations).toContain("Kamadan, Jewel of Istan");
    expect(kaela.completedMissions).toEqual(["Chahbek Village"]);
  });

  it("leaves everything the player set by hand alone", () => {
    const kaela = merged.characters.find((c) => c.name === "Kaela Sunreach")!;
    expect(kaela.unlockedSecondaries).toEqual([Profession.Monk]);
    expect(kaela.ownedCampaigns).toEqual(["Nightfall"]);
    expect(kaela.todos).toHaveLength(1);
  });

  it("creates characters it has not seen, guessing their campaigns from where they have been", () => {
    const shen = merged.characters.find((c) => c.name === "Shen Quickblade")!;
    expect(shen.primaryProfession).toBe(Profession.Assassin);
    expect(shen.ownedCampaigns).toEqual(["Factions"]);
    expect((shen as unknown as { builds: unknown[] }).builds).toEqual([]);
  });

  it("skips PvP-only characters, which have no world progress", () => {
    expect(merged.characters.find((c) => c.name === "PvP Alt")).toBeUndefined();
  });

  it("reports what changed", () => {
    expect(changedAnything(merged.changes)).toBe(true);
    const kaela = merged.changes.find((c) => c.name === "Kaela Sunreach")!;
    expect(kaela).toMatchObject({ created: false, skills: 1, missions: 1 });
    expect(merged.changes.find((c) => c.name === "Shen Quickblade")!.created).toBe(true);
  });

  it("is a no-op the second time", () => {
    const again = mergeCompletion(merged.characters, file, index, mapIds, (c) => ({ ...c, builds: [] }));
    expect(changedAnything(again.changes)).toBe(false);
    expect(again.characters).toHaveLength(merged.characters.length);
  });
});

describe("recognising a completion file", () => {
  it("accepts GWToolbox's shape", () => {
    expect(isCompletionFile({ Thel: { profession: 8, skills: [0, 4], maps_unlocked: [] } })).toBe(true);
  });

  it("refuses a planner save, an empty object and records without bitfields", () => {
    expect(isCompletionFile({ version: 1, characters: [] })).toBe(false);
    expect(isCompletionFile({})).toBe(false);
    expect(isCompletionFile([])).toBe(false);
    expect(isCompletionFile({ Thel: { profession: 8 } })).toBe(false);
    expect(isCompletionFile({ Thel: { skills: ["a"] } })).toBe(false);
  });
});
