/**
 * Engine tests against the FULL scraped dataset in /data — sanity checks
 * that the logic holds on real data, not just fixtures.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  indexDataset,
  Profession,
  reachableExplorables,
  skillAvailability,
  validateBuild,
  type Build,
  type Character,
  type Dataset,
} from "../src/index.js";

function data(file: string): unknown {
  const path = fileURLToPath(new URL(`../../data/${file}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

const index = indexDataset({
  skills: data("skills.json"),
  locations: data("locations.json"),
  trainers: data("trainers.json"),
  monsters: data("monsters.json"),
  missions: data("missions.json"),
} as Dataset);

/** A fresh post-Searing Warrior who has only reached Ascalon City. */
const freshWarrior: Character = {
  name: "Fresh of Ascalon",
  primaryProfession: Profession.Warrior,
  unlockedSecondaries: [],
  knownSkills: [],
  unlockedLocations: ["Ascalon City"],
  completedMissions: [],
};

describe("full dataset: fresh Ascalon warrior", () => {
  const availability = skillAvailability(freshWarrior, null, index);
  const byPage = new Map(availability.map((e) => [e.skill.wikiPage, e]));

  it("sees Sir Bertran's warrior skills as PURCHASABLE_NOW", () => {
    const bertran = index.trainerByName.get("Sir Bertran")!;
    expect(bertran.location).toBe("Ascalon City");
    const offered = bertran.skillsOffered.filter(
      (s) => index.skillByPage.get(s)?.profession === Profession.Warrior,
    );
    expect(offered.length).toBeGreaterThan(0);
    for (const s of offered) {
      expect(byPage.get(s)?.status, s).toBe("PURCHASABLE_NOW");
    }
  });

  it("sees the late-game elite Backbreaker as FUTURE, with the boss as the source", () => {
    const entry = byPage.get("Backbreaker")!;
    expect(entry.status).toBe("FUTURE");
    expect(entry.sources).toContainEqual(
      expect.objectContaining({ kind: "capture", via: "Ferk Mallet", availableNow: false }),
    );
  });

  it("all warrior elites are FUTURE (no elite is reachable from Ascalon City)", () => {
    for (const e of availability.filter((e) => e.skill.isElite)) {
      expect(e.status, e.skill.wikiPage).toBe("FUTURE");
    }
  });

  it("only Warrior and common skills appear", () => {
    for (const e of availability) {
      expect([Profession.Warrior, null, undefined]).toContain(e.skill.profession);
    }
  });

  it("reaches Old Ascalon (adjacent explorable) but not Traveler's Vale", () => {
    const reachable = reachableExplorables(freshWarrior, index);
    expect(reachable.has("Old Ascalon")).toBe(true);
    expect(reachable.has("Traveler's Vale")).toBe(false);
  });
});

describe("full dataset: progressed character", () => {
  it("a character at Yak's Bend can capture something in Traveler's Vale", () => {
    const c: Character = { ...freshWarrior, unlockedLocations: ["Yak's Bend"] };
    const reachable = reachableExplorables(c, index);
    expect(reachable.has("Traveler's Vale")).toBe(true);
  });

  it("Dakk at Ember Light Camp makes every non-elite warrior skill purchasable", () => {
    const c: Character = { ...freshWarrior, unlockedLocations: ["Ember Light Camp"] };
    const availability = skillAvailability(c, null, index);
    const nonElites = availability.filter((e) => !e.skill.isElite && e.skill.profession === Profession.Warrior);
    expect(nonElites.length).toBeGreaterThan(50);
    for (const e of nonElites) {
      expect(e.status, e.skill.wikiPage).toBe("PURCHASABLE_NOW");
    }
  });
});

describe("full dataset: build validation", () => {
  it("flags a two-elite warrior build", () => {
    const b: Build = {
      name: "double elite",
      character: "Fresh of Ascalon",
      primary: Profession.Warrior,
      secondary: null,
      skills: ["Backbreaker", "Hundred Blades", null, null, null, null, null, null],
    };
    expect(validateBuild(b, index).map((e) => e.code)).toEqual(["TOO_MANY_ELITES"]);
  });

  it("accepts a classic W/Mo bar", () => {
    const b: Build = {
      name: "wammo",
      character: "Fresh of Ascalon",
      primary: Profession.Warrior,
      secondary: Profession.Monk,
      skills: [
        "Sever Artery", "Gash", "Final Thrust", "Sprint",
        "Healing Breeze", "Mending", "Healing Signet", "Resurrection Signet",
      ],
    };
    expect(validateBuild(b, index)).toEqual([]);
  });
});
