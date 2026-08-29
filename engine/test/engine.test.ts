/**
 * Engine logic tests against the hand-written fixtures (/data/fixtures).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  indexDataset,
  monstersInLocation,
  Profession,
  reachableExplorables,
  skillAvailability,
  validateBuild,
  type Build,
  type BuildErrorCode,
  type Character,
  type Dataset,
} from "../src/index.js";

function fixture(file: string): unknown {
  const path = fileURLToPath(new URL(`../../data/fixtures/${file}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

const index = indexDataset({
  skills: fixture("skills.json"),
  locations: fixture("locations.json"),
  trainers: fixture("trainers.json"),
  monsters: fixture("monsters.json"),
} as Dataset);

const baseCharacter: Character = {
  name: "Testa of Ascalon",
  primaryProfession: Profession.Warrior,
  unlockedSecondaries: [Profession.Monk],
  knownSkills: [],
  unlockedLocations: ["Ascalon City"],
  completedMissions: [],
};

describe("reachableExplorables (one-hop simplification)", () => {
  const cases: Array<{ unlocked: string[]; expected: string[] }> = [
    // Ascalon City's only fixture neighbor (Old Ascalon) isn't in the dataset
    { unlocked: ["Ascalon City"], expected: [] },
    { unlocked: ["Yak's Bend"], expected: ["Traveler's Vale"] },
    { unlocked: ["Ascalon City", "Yak's Bend"], expected: ["Traveler's Vale"] },
    // a directly-unlocked explorable counts as reachable
    { unlocked: ["Traveler's Vale"], expected: ["Traveler's Vale"] },
    { unlocked: ["Nowhere"], expected: [] },
  ];
  for (const { unlocked, expected } of cases) {
    it(`unlocked [${unlocked.join(", ")}] -> [${expected.join(", ")}]`, () => {
      const c = { ...baseCharacter, unlockedLocations: unlocked };
      expect([...reachableExplorables(c, index)].sort()).toEqual(expected.sort());
    });
  }
});

describe("skillAvailability (fixtures)", () => {
  const statusOf = (c: Character, secondary: Profession | null, skill: string) =>
    skillAvailability(c, secondary, index).find((e) => e.skill.wikiPage === skill)?.status;

  const cases: Array<{
    name: string;
    character: Partial<Character>;
    secondary: Profession | null;
    skill: string;
    expected: string | undefined;
  }> = [
    {
      name: "known skill is KNOWN even when also purchasable",
      character: { knownSkills: ["Healing Breeze"], unlockedLocations: ["Yak's Bend"] },
      secondary: Profession.Monk,
      skill: "Healing Breeze",
      expected: "KNOWN",
    },
    {
      name: "trainer in unlocked outpost -> PURCHASABLE_NOW",
      character: { unlockedLocations: ["Yak's Bend"] },
      secondary: Profession.Monk,
      skill: "Healing Breeze",
      expected: "PURCHASABLE_NOW",
    },
    {
      name: "trainer only in locked outposts -> FUTURE",
      character: { unlockedLocations: [] },
      secondary: Profession.Monk,
      skill: "Healing Breeze",
      expected: "FUTURE",
    },
    {
      name: "quest given from unlocked outpost -> QUESTABLE_NOW",
      character: { unlockedLocations: ["Ascalon City"] },
      secondary: Profession.Monk,
      skill: "Orison of Healing",
      expected: "QUESTABLE_NOW",
    },
    {
      name: "quest in explorable adjacent to unlocked outpost -> QUESTABLE_NOW (one-hop rule)",
      character: { unlockedLocations: ["Yak's Bend"] },
      secondary: null,
      skill: "Power Attack",
      expected: "QUESTABLE_NOW",
    },
    {
      name: "quest in explorable NOT adjacent to anything unlocked -> FUTURE",
      character: { unlockedLocations: ["Ascalon City"] },
      secondary: null,
      skill: "Power Attack",
      expected: "FUTURE",
    },
    {
      name: "boss in reachable explorable -> CAPTURABLE_NOW",
      character: { unlockedLocations: ["Yak's Bend"] },
      secondary: null,
      skill: "Backbreaker",
      expected: "CAPTURABLE_NOW",
    },
    {
      name: "boss not reachable -> FUTURE",
      character: { unlockedLocations: ["Ascalon City"] },
      secondary: null,
      skill: "Backbreaker",
      expected: "FUTURE",
    },
    {
      name: "skill of a profession the build doesn't use is filtered out",
      character: { unlockedLocations: ["Yak's Bend"] },
      secondary: null,
      skill: "Flare",
      expected: undefined,
    },
    {
      name: "secondary profession unlocks its skills",
      character: { unlockedLocations: ["Yak's Bend"] },
      secondary: Profession.Elementalist,
      skill: "Flare",
      expected: "PURCHASABLE_NOW",
    },
  ];
  for (const { name, character, secondary, skill, expected } of cases) {
    it(name, () => {
      expect(statusOf({ ...baseCharacter, ...character }, secondary, skill)).toBe(expected);
    });
  }

  it("FUTURE skills carry their sources so the UI can answer 'where do I go'", () => {
    const entry = skillAvailability({ ...baseCharacter, unlockedLocations: [] }, Profession.Monk, index).find(
      (e) => e.skill.wikiPage === "Healing Breeze",
    )!;
    expect(entry.status).toBe("FUTURE");
    expect(entry.sources).toContainEqual({
      kind: "trainer",
      via: "Captain Osric",
      location: "Yak's Bend",
      availableNow: false,
    });
  });
});

describe("validateBuild", () => {
  const build = (skills: Array<string | null>, overrides: Partial<Build> = {}): Build => ({
    name: "test",
    character: "Testa of Ascalon",
    primary: Profession.Warrior,
    secondary: Profession.Monk,
    skills: skills as Build["skills"],
    ...overrides,
  });
  const pad = (skills: Array<string | null>) => [...skills, ...Array(8 - skills.length).fill(null)];

  const cases: Array<{ name: string; build: Build; expected: BuildErrorCode[] }> = [
    { name: "empty build is valid", build: build(pad([])), expected: [] },
    {
      name: "valid W/Mo build",
      build: build(pad(["Power Attack", "Healing Breeze", "Backbreaker"])),
      expected: [],
    },
    { name: "wrong slot count", build: build(["Power Attack"]), expected: ["WRONG_SLOT_COUNT"] },
    {
      name: "duplicate skill",
      build: build(pad(["Power Attack", "Power Attack"])),
      expected: ["DUPLICATE_SKILL"],
    },
    {
      name: "skill outside primary/secondary",
      build: build(pad(["Flare"])),
      expected: ["ILLEGAL_PROFESSION"],
    },
    {
      name: "unknown skill",
      build: build(pad(["Totally Made Up"])),
      expected: ["UNKNOWN_SKILL"],
    },
    {
      name: "primary = secondary",
      build: build(pad([]), { secondary: Profession.Warrior }),
      expected: ["PRIMARY_EQUALS_SECONDARY"],
    },
  ];
  for (const { name, build: b, expected } of cases) {
    it(name, () => {
      expect(validateBuild(b, index).map((e) => e.code)).toEqual(expected);
    });
  }
});

describe("monstersInLocation", () => {
  it("returns Traveler's Vale monsters with skills and armor", () => {
    const monsters = monstersInLocation("Traveler's Vale", index);
    expect(monsters.map((m) => m.monster.name).sort()).toEqual([
      "Dagnar Stonepate",
      "Stone Summit Gnasher",
    ]);
    const dagnar = monsters.find((m) => m.monster.name === "Dagnar Stonepate")!;
    expect(dagnar.isBossHere).toBe(true);
    expect(dagnar.skills.find((s) => s.ref === "Backbreaker")?.skill?.isElite).toBe(true);
    const gnasher = monsters.find((m) => m.monster.name === "Stone Summit Gnasher")!;
    expect(gnasher.isBossHere).toBe(false);
    expect(gnasher.armor.table).toContainEqual({ damageType: "base", rating: 40 });
  });

  it("unknown location -> empty", () => {
    expect(monstersInLocation("Atlantis", index)).toEqual([]);
  });
});
