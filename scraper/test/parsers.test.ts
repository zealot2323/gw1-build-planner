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
import {
  parseGameUpdate,
  parseLocation,
  parseMission,
  parseMonster,
  parseQuest,
  parseSkill,
  parseSkillHistory,
  parseTrainer,
} from "../src/parsers.js";

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
    // Every campaign's sources are kept and tagged; whether a character can
    // use one is decided later by whether the location is reachable.
    expect(entity.acquisition.captureBosses).toContain("Cairn the Berserker");
    expect(entity.acquisition.captureBosses).toContain("Tuila the Club"); // Factions
    expect(entity.acquisition.sourceCampaigns?.["Cairn the Berserker"]).toBe("Prophecies");
    expect(entity.acquisition.sourceCampaigns?.["Tuila the Club"]).toBe("Factions");
    // Disgruntled Zombie only spawns during Evil Residents → conditional
    expect(entity.acquisition.conditionalCaptureBosses).toContain("Disgruntled Zombie");
  });

  it("parses Backbreaker (elite, adrenaline cost, capture-only)", () => {
    const { entity } = parseSkill("Backbreaker", cached("Backbreaker"));
    expect(entity.isElite).toBe(true);
    expect(entity.adrenalineCost).toBe(9);
    expect(entity.energyCost).toBeNull();
    expect(entity.acquisition.trainers).toEqual([]);
    // Ferk Mallet always spawns; two Prophecies bosses are quest-gated
    expect(entity.acquisition.captureBosses).toContain("Ferk Mallet");
    expect(entity.acquisition.conditionalCaptureBosses).toEqual(
      expect.arrayContaining(["Cairn the Grave", "Ingenious Ettin"]),
    );
    expect(entity.acquisition.sourceCampaigns?.["Ferk Mallet"]).toBe("Prophecies");
  });

  it("parses Healing Breeze (awkward acquisition: quests, piped pre-Searing links, ignored groups)", () => {
    const { entity } = parseSkill("Healing Breeze", cached("Healing Breeze"));
    expect(entity.campaign).toBe("Core");
    // sources from every campaign, each tagged with where it came from
    expect(entity.acquisition.quests).toContain("Monk Test");
    expect(entity.acquisition.sourceCampaigns?.["Monk Test"]).toBe("Prophecies");
    expect(entity.acquisition.sourceCampaigns?.["Locate Sister Tai"]).toBe("Factions");
    expect(entity.acquisition.trainers).toEqual(
      expect.arrayContaining(["Halbrik", "Sir Bertran", "Dakk"]),
    );
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
    expect(entity.acquisition.captureBosses).toContain("Spoiler-related boss");
    expect(entity.acquisition.captureBosses).not.toContain("Galrath");
  });

  it("parses Aura of Faith (awkward: capture entries with no campaign bullets)", () => {
    const { entity } = parseSkill("Aura of Faith", cached("Aura of Faith"));
    expect(entity.isElite).toBe(true);
    expect(entity.acquisition.captureBosses).toContain("Demetrios the Enduring");
    expect(entity.acquisition.captureBosses).toContain("Willa the Unpleasant");
  });

  it('parses "Save Yourselves!" (allegiance skill: one skill id per side)', () => {
    const { entity } = parseSkill('"Save Yourselves!"', cached('"Save Yourselves!"'));
    // id = 1954<!-- Luxon -->, 2097<!-- Kurzick --> — the side is only ever
    // recorded in an HTML comment.
    expect(entity.allegianceSkillIds).toEqual({ Kurzick: 2097, Luxon: 1954 });
    expect(entity.acquisition.titleNpcs).toEqual(["Kurzick Bureaucrat", "Luxon Scavenger"]);
  });

  it("treats 'elite = yes' as elite, not just 'y'", () => {
    // 18 skill pages spell it out; matching "y" exactly made them non-elite,
    // which let them into the all-non-elite trainer expansion.
    const { entity } = parseSkill("Tainted Flesh", cached("Tainted Flesh"));
    expect(entity.isElite).toBe(true);
  });

  it("leaves allegianceSkillIds off ordinary skills", () => {
    const { entity } = parseSkill("Crude Swing", cached("Crude Swing"));
    expect(entity.allegianceSkillIds).toBeUndefined();
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

  it("parses Stone Summit Crusher (campaign sub-blocks become tagged variants)", () => {
    const { entity } = parseMonster("Stone Summit Crusher", cached("Stone Summit Crusher"));
    // Each campaign's bar is kept as its own tagged variant, so the engine
    // can pick the one that applies in a given zone.
    const proph = entity.variants!.find((v) => v.campaign === "Prophecies")!;
    expect(proph.skills.sort()).toEqual([
      '"For Great Justice!"', "Griffon's Sweep", "Protector's Strike",
    ]);
    expect(proph.hardModeSkills).toContain("Dwarven Battle Stance");
    expect(entity.variants!.some((v) => v.campaign === "Eye of the North")).toBe(true);
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

describe("parseGameUpdate", () => {
  const update = (d: string) => cached(`Feedback:Game updates/${d}`);

  it("parses a plain skill-update page", () => {
    const { entity } = parseGameUpdate("Feedback:Game updates/20260901", update("20260901"));
    const byName = new Map(entity.map((c) => [c.skill, c]));
    expect(entity[0].date).toBe("2026-09-01");
    expect(byName.get("Symbols of Inspiration")?.note).toContain("Reduce recharge from 15 to 10");
    expect(byName.get("Symbols of Inspiration")?.kind).toBe("balance");
    // "Fix bug where..." is a bug fix, not a rebalance
    expect(byName.get("Mistrust")?.kind).toBe("bugfix");
  });

  it("handles the August page: ' - ' separators, per-profession sections, PvP splits", () => {
    const { entity } = parseGameUpdate("Feedback:Game updates/20260826", update("20260826"));
    const dash = entity.find((c) => c.skill === "Aura of Displacement");
    expect(dash?.note).toBe("Reduce energy cost from 10 to 5.");
    expect(dash?.section).toContain("Assassin");
    // PvP-split versions are separate skills and out of scope for a PvE planner
    expect(entity.some((c) => c.skill.includes("(PvP)"))).toBe(false);
    expect(entity.some((c) => /Split for PvP/i.test(c.note))).toBe(false);
  });

  it("takes real undocumented changes out of the wiki-notes section", () => {
    // The only skill content on this page is a wiki editor's note recording
    // a change the official notes omitted.
    const { entity } = parseGameUpdate("Feedback:Game updates/20260504", update("20260504"));
    expect(entity).toHaveLength(1);
    expect(entity[0]).toMatchObject({ skill: "Shadow Prison", kind: "balance" });
    expect(entity[0].note).toBe("Recharge reduced to 15.");
  });

  it("never records a wiki note that says a skill did NOT change", () => {
    const { entity } = parseGameUpdate("Feedback:Game updates/20260826", update("20260826"));
    // The page's wiki-notes section says "Crippling Dagger and Dancing
    // Daggers both were not changed" and "Symbols of Inspiration did not
    // have its recharge time ... changed". All three skills DO appear
    // elsewhere on the page with real changes, so the thing that must never
    // survive is the negating note itself.
    expect(entity.some((c) => /were not changed|did not have|is unchanged/i.test(c.note))).toBe(false);
    // ...and what is recorded for them comes from the real update sections
    for (const c of entity.filter((c) => c.skill === "Symbols of Inspiration")) {
      expect(c.section).not.toMatch(/wiki note/i);
    }
  });

  it("carries a parent bullet's context down to its sub-bullets", () => {
    // * Sword [[adrenaline]] reductions:
    // **{{skill icon|Sever Artery}} from 4 to 3
    const aug = parseGameUpdate("Feedback:Game updates/20260826", update("20260826"));
    expect(aug.entity.find((c) => c.skill === "Sever Artery")?.note).toBe("Sword adrenaline reductions: from 4 to 3");
    // * Skill AI adjustments:  /  ** {{skill icon|Preservation}} - No longer casts ...
    const may = parseGameUpdate("Feedback:Game updates/20260512", update("20260512"));
    const pres = may.entity.find((c) => c.skill === "Preservation" && /no longer casts/i.test(c.note));
    expect(pres?.kind).toBe("ai");
  });

  it("classifies AI retuning separately from balance", () => {
    const { entity } = parseGameUpdate("Feedback:Game updates/20260527", update("20260527"));
    expect(entity.length).toBeGreaterThan(0);
    expect(entity.every((c) => c.kind === "ai")).toBe(true);
  });
});

describe("parseSkillHistory", () => {
  it("parses dated snapshots newest first, with Original last", () => {
    const { entity } = parseSkillHistory(
      "Symbols of Inspiration/Skill history",
      cached("Symbols of Inspiration/Skill history"),
    );
    expect(entity).toHaveLength(2);
    expect(entity[0].date).toBe("2008-12-11");
    expect(entity[0].recharge).toBe(15);
    expect(entity[0].energyCost).toBe(5);
    expect(entity[1].date).toBeNull();
    expect(entity[1].label).toBe("Original");
    expect(entity[1].recharge).toBe(30);
  });

  it("handles a history page that only has the release version", () => {
    const { entity } = parseSkillHistory("Frenzy/Skill history", cached("Frenzy/Skill history"));
    expect(entity).toHaveLength(1);
    expect(entity[0].label).toBe("Original");
    expect(entity[0].description).toContain("take double");
  });
});

describe("isExcludedSkillPage", () => {
  it("excludes spirit attacks wherever the (attack) disambiguator sits", async () => {
    const { isExcludedSkillPage } = await import("../src/overrides.js");
    expect(isExcludedSkillPage("Bloodsong (attack)")).toBe(true);
    expect(isExcludedSkillPage("Pain (attack) (Signet of Spirits)")).toBe(true);
    // ...without catching real skills that merely contain the word
    expect(isExcludedSkillPage("Pain")).toBe(false);
    expect(isExcludedSkillPage("Attacker's Insight")).toBe(false);
  });
});

describe("quest lines on skill pages", () => {
  it("splits slash-joined quests instead of reading the second as a location", () => {
    // ** [[Primary Training]]/[[Secondary Training]] ([[Churrhir Fields]])
    const { entity } = parseSkill("Sprint", cached("Sprint"));
    expect(entity.acquisition.quests).toEqual(expect.arrayContaining(["Primary Training", "Secondary Training"]));
    expect(entity.acquisition.questLocations?.["Primary Training"]).toBe("Churrhir Fields");
    expect(entity.acquisition.questLocations?.["Secondary Training"]).toBe("Churrhir Fields");
    expect(Object.values(entity.acquisition.questLocations ?? {})).not.toContain("Secondary Training");
  });

  it("reads an unlinked location in parentheses", () => {
    // ** [[Choose Your Secondary Profession (Nightfall quest)|...]] (Churrhir Fields)
    const { entity } = parseSkill("Healing Touch", cached("Healing Touch"));
    expect(entity.acquisition.questLocations?.["Choose Your Secondary Profession (Nightfall quest)"]).toBe(
      "Churrhir Fields",
    );
  });
});

describe("parseQuest", () => {
  it("parses Locate Jinzo (primary-only profession quest)", () => {
    const { entity, issues } = parseQuest("Locate Jinzo", cached("Locate Jinzo"));
    expect(issues).toEqual([]);
    expect(entity).toMatchObject({
      campaign: "Factions",
      type: "Primary",
      givenBy: ["Headmaster Lee"],
      givenAt: ["Shing Jea Monastery"],
      profession: "Assassin",
      primaryOnly: true,
    });
    // "%28Assassin%29" in the wikitext link is decoded
    expect(entity.precededBy).toContain("Speak with Headmaster Lee (Assassin)");
  });

  it("keeps every alternative pickup location", () => {
    const { entity } = parseQuest("Prenuptial Disagreement (female)", cached("Prenuptial Disagreement (female)"));
    expect(entity.givenAt.length).toBeGreaterThan(0);
    expect(entity.profession).toBeNull();
  });
});
