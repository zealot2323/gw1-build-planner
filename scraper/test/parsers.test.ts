/**
 * Parser unit tests against real cached wiki pages (no network).
 * Known-awkward pages covered:
 * - Boulder Elemental: multi-level "7, 9 (23)", a hard-mode-only elite skill
 *   that must be DROPPED, armor table with no base value.
 * - Healing Breeze: acquisition with piped pre-Searing links, profession
 *   changers and unlock-only groups that must be ignored.
 * - Crude Swing: a NON-elite with Signet of Capture entries.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLocation, parseMission, parseMonster, parseSkill, parseTrainer } from "../src/parsers.js";

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "cache");

function cached(title: string): string {
  const path = join(CACHE_DIR, `${encodeURIComponent(title)}.json`);
  return JSON.parse(readFileSync(path, "utf8")).wikitext;
}

describe("parseSkill", () => {
  it("parses Crude Swing (trainer + capture entries on a non-elite)", () => {
    const { entity, issues } = parseSkill("Crude Swing", cached("Crude Swing"));
    expect(issues).toEqual([]);
    expect(entity.gwSkillId).toBe(353);
    expect(entity.profession).toBe("Warrior");
    expect(entity.attribute).toBe("Hammer Mastery");
    expect(entity.isElite).toBe(false);
    expect(entity.campaign).toBe("Prophecies");
    expect(entity.energyCost).toBe(5);
    expect(entity.adrenalineCost).toBeNull();
    expect(entity.recharge).toBe(5);
    expect(entity.description).toContain("adjacent");
    expect(entity.acquisition.trainers).toEqual(["Harnil", "Dakk"]);
    // Prophecies capture bosses only — Factions/EotN entries excluded;
    // Disgruntled Zombie only spawns during Evil Residents → conditional
    expect(entity.acquisition.captureBosses).toEqual(["Cairn the Berserker"]);
    expect(entity.acquisition.conditionalCaptureBosses).toEqual(["Disgruntled Zombie"]);
  });

  it("parses Backbreaker (elite, adrenaline cost, capture-only)", () => {
    const { entity } = parseSkill("Backbreaker", cached("Backbreaker"));
    expect(entity.isElite).toBe(true);
    expect(entity.adrenalineCost).toBe(9);
    expect(entity.energyCost).toBeNull();
    expect(entity.acquisition.trainers).toEqual([]);
    // Ferk Mallet always spawns; the other two only during a quest/event
    expect(entity.acquisition.captureBosses).toEqual(["Ferk Mallet"]);
    expect(entity.acquisition.conditionalCaptureBosses).toEqual([
      "Cairn the Grave",
      "Ingenious Ettin",
    ]);
  });

  it("parses Healing Breeze (awkward acquisition: quests, piped pre-Searing links, ignored groups)", () => {
    const { entity } = parseSkill("Healing Breeze", cached("Healing Breeze"));
    expect(entity.campaign).toBe("Core");
    expect(entity.acquisition.quests).toEqual(["Monk Test"]);
    expect(entity.acquisition.trainers).toEqual(["Halbrik", "Sir Bertran", "Dakk"]);
    // profession changers / hero unlocks must not leak into any list
    const all = [...entity.acquisition.trainers, ...entity.acquisition.quests, ...entity.acquisition.captureBosses];
    expect(all).not.toContain("Nausuan");
    expect(all).not.toContain("Dunkoro");
  });

  it("parses Hundred Blades (awkward: headerless capture list, hard-mode entry dropped)", () => {
    const { entity } = parseSkill("Hundred Blades", cached("Hundred Blades"));
    expect(entity.isElite).toBe(true);
    // no '''Signet of Capture''' header — elites default to capture group;
    // Galrath is hard-mode-only and must be dropped
    expect(entity.acquisition.captureBosses).toEqual(["Spoiler-related boss"]);
  });

  it("parses Aura of Faith (awkward: capture entries with no campaign bullets)", () => {
    const { entity } = parseSkill("Aura of Faith", cached("Aura of Faith"));
    expect(entity.isElite).toBe(true);
    expect(entity.acquisition.captureBosses).toContain("Demetrios the Enduring");
    expect(entity.acquisition.captureBosses).toContain("Willa the Unpleasant");
  });
});

describe("parseTrainer", () => {
  it("parses Captain Osric/Skills with the list-page location", () => {
    const { entity, issues } = parseTrainer("Captain Osric", cached("Captain Osric/Skills"), "Yak's Bend");
    expect(issues).toEqual([]);
    expect(entity.location).toBe("Yak's Bend");
    expect(entity.skillsOffered).toContain("Power Attack");
    expect(entity.skillsOffered).toContain("Heal Party");
    expect(entity.skillsOffered.length).toBeGreaterThan(30);
  });
});

describe("parseLocation", () => {
  it("parses Yak's Bend (outpost: infobox + exits)", () => {
    const { entity, issues } = parseLocation("Yak's Bend", cached("Yak's Bend"), "outpost");
    expect(issues).toEqual([]);
    expect(entity.campaign).toBe("Prophecies");
    expect(entity.region).toBe("Northern Shiverpeaks");
    expect(entity.neighbors).toEqual(["Shiverpeak Arena", "Traveler's Vale"]);
  });

  it("parses Ascalon Foothills (explorable: foes, no bosses)", () => {
    const { entity, issues } = parseLocation("Ascalon Foothills", cached("Ascalon Foothills"), "explorable");
    expect(issues).toEqual([]);
    expect(entity.foes).toContain("Boulder Elemental");
    expect(entity.foes).toContain("Hydra (Ascalon)");
    expect(entity.bosses).toEqual([]);
    // Allies (collectors etc.) must not be extracted as foes
    expect(entity.foes).not.toContain("Dael");
  });
});

describe("parseMonster", () => {
  it("parses Boulder Elemental (awkward: multi-level, hard-mode-only elite, no base armor)", () => {
    const { entity } = parseMonster("Boulder Elemental", cached("Boulder Elemental"));
    expect(entity.species).toBe("Elemental");
    expect(entity.profession).toBe("Warrior");
    expect(entity.level).toBe(9); // max normal-mode level from "7, 9 (23)"
    expect(entity.levelRaw).toBe("7, 9 (23)");
    expect(entity.isBoss).toBe(false);
    expect(entity.skills).toEqual(["Crude Swing"]); // Warrior's Endurance is hard-mode-only → dropped
    expect(entity.armor).toBeNull();
    expect(entity.armorTable).toContainEqual({ damageType: "blunt", rating: 18 });
    expect(entity.armorTable).toContainEqual({ damageType: "slashing", rating: 58 });
    expect(entity.locations).toContain("Ascalon Foothills");
  });

  it("parses Stone Summit Crusher (awkward: campaign sub-blocks in Skills)", () => {
    const { entity } = parseMonster("Stone Summit Crusher", cached("Stone Summit Crusher"));
    // Only the ;Prophecies block counts — EotN and Fronis Irontoe's Lair
    // blocks dropped, and Dwarven Battle Stance is hard-mode-only.
    expect(entity.skills.sort()).toEqual(['"For Great Justice!"', "Griffon's Sweep", "Protector's Strike"]);
  });

  it("parses Drub Gorefang (boss without an elite — legitimate, not an issue)", () => {
    const { entity, issues } = parseMonster("Drub Gorefang", cached("Drub Gorefang"));
    expect(entity.isBoss).toBe(true);
    expect(entity.bossElite).toBeUndefined();
    expect(issues).toEqual([]);
    expect(entity.skills).toContain("Cyclone Axe");
    expect(entity.locations).toEqual(["The Great Northern Wall"]);
  });

  it("parses Riine Windrot (per-level stat blocks tied to locations)", () => {
    const { entity } = parseMonster("Riine Windrot", cached("Riine Windrot"));
    expect(entity.variants?.map((v) => v.label)).toEqual(["Level 12", "Level 28"]);
    const [low, high] = entity.variants!;
    expect(low.levels).toEqual([12]);
    expect(low.skills).toEqual([
      "Plague Touch", "Soul Feast", "Strip Enchantment", "Vampiric Touch", "Vile Touch",
    ]);
    expect(low.eliteSkill).toBeUndefined();
    expect(high.levels).toEqual([28]);
    expect(high.eliteSkill).toBe("Offering of Blood");
    // the level annotations that tie a zone to a block
    expect(entity.locationLevels).toEqual({
      "Anvil Rock": 12,
      "Traveler's Vale": 12,
      "Borlis Pass": 12,
      "Thunderhead Keep": 28,
    });
  });
});

describe("parseMission", () => {
  it("parses The Great Northern Wall (foes + bosses with section context)", () => {
    const { entity, issues } = parseMission("The Great Northern Wall", cached("The Great Northern Wall"));
    expect(issues).toEqual([]);
    expect(entity.region).toBe("Ascalon");
    expect(entity.foes).toContain("Carrion Devourer");
    expect(entity.bosses).toContain("Drub Gorefang");
    expect(entity.foes).not.toContain("Drub Gorefang");
  });
});
