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

describe("full dataset: bestiary", () => {
  it("resolves a mission's monsters by mission name", async () => {
    const { monstersInLocation } = await import("../src/index.js");
    const monsters = monstersInLocation("The Great Northern Wall", index);
    expect(monsters.length).toBeGreaterThan(5);
    const drub = monsters.find((m) => m.monster.name === "Drub Gorefang");
    expect(drub?.isBossHere).toBe(true);
  });

  it("picks the level-12 block for Riine Windrot in early zones, level-28 in Thunderhead Keep", async () => {
    const { monstersInLocation, variantsForLocation } = await import("../src/index.js");
    const riine = index.monsterByPage.get("Riine Windrot")!;

    for (const early of ["Anvil Rock", "Traveler's Vale", "Borlis Pass"]) {
      const [variant] = variantsForLocation(riine, early);
      expect(variant.label, early).toBe("Level 12");
      expect(variant.skills, early).toContain("Vile Touch");
      expect(variant.skills, early).not.toContain("Offering of Blood");
    }

    const late = variantsForLocation(riine, "Thunderhead Keep");
    expect(late[0].label).toBe("Level 28");
    expect(late[0].eliteSkill).toBe("Offering of Blood");

    // and the display view uses the per-location level + skill bar
    const inVale = monstersInLocation("Traveler's Vale", index).find(
      (m) => m.monster.name === "Riine Windrot",
    )!;
    expect(inVale.level).toBe(12);
    expect(inVale.skills.map((s) => s.ref)).not.toContain("Offering of Blood");
  });

  it("picks zone-named blocks by label (Markis, Ignis Phanaura)", async () => {
    const { variantsForLocation } = await import("../src/index.js");
    const markis = index.monsterByPage.get("Markis")!;
    expect(variantsForLocation(markis, "Iron Mines of Moladune")[0].skills).toContain("Barrage");
    expect(variantsForLocation(markis, "The Wilds")[0].skills).toEqual(["Heal Area"]);

    const ignis = index.monsterByPage.get("Ignis Phanaura")!;
    expect(variantsForLocation(ignis, "Old Ascalon")[0].label).toBe("Old Ascalon");
    expect(variantsForLocation(ignis, "Diessa Lowlands")[0].label).toBe("Diessa Lowlands");
  });

  it("keeps simultaneous loadouts when no location key applies (Charr Scout)", async () => {
    const { variantsForLocation } = await import("../src/index.js");
    const scout = index.monsterByPage.get("Charr Scout")!;
    const variants = variantsForLocation(scout, "Old Ascalon");
    expect(variants.map((v) => v.label)).toEqual(["Warrior version", "Ranger version"]);
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
