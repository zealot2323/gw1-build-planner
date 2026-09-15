/**
 * Engine tests against the FULL scraped dataset in /data — sanity checks
 * that the logic holds on real data, not just fixtures.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canTakeQuest,
  indexDataset,
  questBoard,
  travelDistances,
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
  quests: data("quests.json"),
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

  it("Dakk at Ember Light Camp makes every non-elite warrior skill purchasable", async () => {
    const { indexDataset: reindex, scopedDataset } = await import("../src/index.js");
    // Dakk sells "all Prophecies and core", so the claim only holds inside a
    // Prophecies-scoped dataset — a Factions skill like "None Shall Pass!"
    // is not his to sell.
    const c: Character = {
      ...freshWarrior,
      campaign: "Prophecies",
      unlockedLocations: ["Ember Light Camp"],
    };
    const scoped = reindex(scopedDataset(index.dataset, c));
    const availability = skillAvailability(c, null, scoped);
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

describe("full dataset: hard mode and capture scoping", () => {
  it("Riine Windrot's elite is NOT capturable from his low-level zones", async () => {
    const { locationsWithSkill } = await import("../src/index.js");
    const riine = index.monsterByPage.get("Riine Windrot")!;
    // Offering of Blood is only on his level-28 block (Thunderhead Keep)
    expect(locationsWithSkill(riine, "Offering of Blood")).toEqual(["Thunderhead Keep"]);
    // ...while a skill on both blocks stays available everywhere he spawns
    expect(locationsWithSkill(riine, "Plague Touch").sort()).toEqual(
      ["Anvil Rock", "Borlis Pass", "Thunderhead Keep", "Traveler's Vale"],
    );
  });

  it("a character limited to the early Shiverpeaks cannot capture Offering of Blood", () => {
    const c: Character = {
      ...freshWarrior,
      primaryProfession: Profession.Necromancer,
      unlockedLocations: ["Anvil Rock", "Traveler's Vale", "Borlis Pass (outpost)"],
    };
    const entry = skillAvailability(c, null, index).find(
      (e) => e.skill.wikiPage === "Offering of Blood",
    )!;
    expect(entry.status).toBe("FUTURE");
    const riineSource = entry.sources.find((s) => s.via === "Riine Windrot");
    expect(riineSource?.availableNow).toBe(false);
    expect(riineSource?.location).toBe("Thunderhead Keep");
  });

  it("hard mode adds the hard-mode-only bars and level", async () => {
    const { monstersInLocation } = await import("../src/index.js");
    const normal = monstersInLocation("Nolani Academy", index, false).find(
      (m) => m.monster.name === "Charr Shaman",
    )!;
    const hard = monstersInLocation("Nolani Academy", index, true).find(
      (m) => m.monster.name === "Charr Shaman",
    )!;
    // Shield of Judgment is annotated "elite, Hard mode only"
    expect(normal.skills.map((s) => s.ref)).not.toContain("Shield of Judgment");
    expect(hard.skills.map((s) => s.ref)).toContain("Shield of Judgment");
    expect(hard.skills.find((s) => s.ref === "Shield of Judgment")!.hardModeOnly).toBe(true);
    expect(hard.level).toBeGreaterThan(normal.level!);
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

describe("full dataset: zone analysis", () => {
  it("reduces an armor table to base + deviations", async () => {
    const { armorProfile } = await import("../src/index.js");
    const bladeStorm = index.monsterByPage.get("Charr Blade Storm")!;
    const p = armorProfile(bladeStorm.armorTable);
    // 73 physical / 53 elemental -> baseline is the 4-way elemental value
    expect(p.base).toBe(53);
    expect(p.strongVs.sort()).toEqual(["blunt", "piercing", "slashing"]);
    expect(p.weakVs).toEqual([]);
  });

  it("Charr Blade Storm's hard-mode elite is now parsed", async () => {
    const { skillsForLocation } = await import("../src/index.js");
    const m = index.monsterByPage.get("Charr Blade Storm")!;
    const normal = skillsForLocation(m, "Nolani Academy", false).map((s) => s.ref);
    const hard = skillsForLocation(m, "Nolani Academy", true).map((s) => s.ref);
    expect(normal).not.toContain("Hundred Blades");
    expect(hard).toContain("Hundred Blades");
  });

  it("tags what a zone throws at you", async () => {
    const { zoneSummary } = await import("../src/index.js");
    const s = zoneSummary("Nolani Academy", index);
    expect(s.monsterCount).toBeGreaterThan(10);
    expect(s.bossCount).toBeGreaterThan(0);
    expect(s.levelRange!.min).toBeGreaterThan(0);
    // Charr country: multiple species groups, and healing from the Shamans
    expect(s.groups.length).toBeGreaterThan(1);
    expect(s.threats.map((t) => t.tag)).toContain("Enemy healing");
  });

  it("does not tag damage skills as Healing (the 'heal' in 'Health' trap)", async () => {
    const { threatTagsForSkill } = await import("../src/index.js");
    const tagsOf = (page: string) =>
      threatTagsForSkill(index.skillByPage.get(page)!.description, page);
    // "steal up to N Health" / "inflict a Deep Wound" must not read as healing
    expect(tagsOf("Dismember")).not.toContain("Enemy healing");
    expect(tagsOf("Sever Artery")).not.toContain("Enemy healing");
    expect(tagsOf("Vampiric Touch")).not.toContain("Enemy healing");
    // ...while real healing still is
    expect(tagsOf("Heal Other")).toContain("Enemy healing");
    expect(tagsOf("Healing Signet")).toContain("Enemy healing");
    // and a few other categories land where they should
    expect(tagsOf("Distracting Shot")).toContain("Interrupts");
    expect(tagsOf("Fire Storm")).toContain("Heavy AoE");
    expect(tagsOf("Backfire")).toContain("Caster denial");
  });

  it("uses the median for the armor baseline on a 3/3 split", async () => {
    const { armorProfile } = await import("../src/index.js");
    // 3x63 physical, 1x64 cold, 3x43 elemental — the mode ties, median wins
    const p = armorProfile(index.monsterByPage.get("Shiverpeak Warrior")!.armorTable);
    expect(p.base).toBe(63);
    expect(p.weakVs.sort()).toEqual(["earth", "fire", "lightning"]);
    expect(p.strongVs).toEqual(["cold"]);
  });

  it("separates enemy healing from area pressure", async () => {
    const { threatTagsForSkill } = await import("../src/index.js");
    const tagsOf = (page: string) =>
      threatTagsForSkill(index.skillByPage.get(page)!.description, page);
    // area-shaped but heals the enemy's own side — not AoE pressure
    expect(tagsOf("Heal Area")).toEqual(["Enemy healing"]);
    expect(tagsOf("Heal Party")).toEqual(["Enemy healing"]);
    // area damage is
    expect(tagsOf("Fire Storm")).toContain("Heavy AoE");
    // ...and so is an area hex or an area condition, which deal no damage
    expect(tagsOf("Suffering")).toContain("Heavy AoE");
    expect(tagsOf("Epidemic")).toContain("Heavy AoE");
    // an enemy monk's protective kit is not pressure either
    expect(tagsOf("Mending")).toEqual(["Enemy healing"]);
  });

  it("flags holy damage in undead zones and hides one-off traits", async () => {
    const { zoneSummary } = await import("../src/index.js");
    const s = zoneSummary("The Catacombs", index);
    const holy = s.notes.find((n) => n.text.includes("Holy"));
    expect(holy?.kind).toBe("weakness");
    // every surfaced trait clears the noise floor; singles are kept aside
    for (const t of s.threats) expect(t.skills).toBeGreaterThanOrEqual(2);
    for (const t of s.minorThreats) expect(t.skills).toBe(1);
  });

  it("lists explorables reachable from an outpost", async () => {
    const { explorablesFrom } = await import("../src/index.js");
    expect(explorablesFrom("Yak's Bend", index)).toContain("Traveler's Vale");
    // explorables themselves are not tree parents
    expect(explorablesFrom("Traveler's Vale", index)).toEqual([]);
  });
});

describe("full dataset: travel distance", () => {
  const atGrendich: Character = {
    ...freshWarrior,
    unlockedLocations: ["Grendich Courthouse"],
  };

  it("counts hops from the unlocked set, with adjacent explorables free", async () => {
    const { travelDistances } = await import("../src/index.js");
    const g = travelDistances(atGrendich, index);
    expect(g.distance.get("Grendich Courthouse")).toBe(0);
    // explorables you can already walk into are 0, not 1
    expect(g.distance.get("Diessa Lowlands")).toBe(0);
    // and somewhere across the map is far
    expect(g.distance.get("Ring of Fire (outpost)")!).toBeGreaterThan(5);
  });

  it("ranks a nearby skill ahead of a late-game one", async () => {
    const { travelDistances, planForSkill, proximityOf } = await import("../src/index.js");
    const g = travelDistances(atGrendich, index);
    const availability = skillAvailability(atGrendich, null, index);
    const planOf = (page: string) =>
      planForSkill(availability.find((e) => e.skill.wikiPage === page)!, g);

    const near = planOf("Healing Signet"); // sold in Ascalon City, next door
    const far = planOf("Hundred Blades"); // capture in Hell's Precipice
    expect(near.distance!).toBeLessThan(far.distance!);
    expect(proximityOf(near.distance)).not.toBe("far");
  });

  it("builds a todo route for skills you can't reach yet", async () => {
    const { travelDistances, buildTodo } = await import("../src/index.js");
    const g = travelDistances(atGrendich, index);
    const availability = skillAvailability(atGrendich, null, index);
    const todo = buildTodo(["Healing Signet", "Hundred Blades", null], availability, g);
    expect(todo.map((t) => t.skill)).toEqual(["Healing Signet", "Hundred Blades"]);
    // nearest first, and the far one comes with a route to walk
    expect(todo[0].plan.distance!).toBeLessThanOrEqual(todo[1].plan.distance!);
    expect(todo[1].plan.route.length).toBeGreaterThan(0);
  });

  it("gives friendly, actionable validation errors", async () => {
    const b: Build = {
      name: "oops",
      character: "Fresh of Ascalon",
      primary: Profession.Warrior,
      secondary: null,
      skills: ["Flare", null, null, null, null, null, null, null],
    };
    const [err] = validateBuild(b, index);
    expect(err.code).toBe("ILLEGAL_PROFESSION");
    expect(err.message).toContain("Elementalist");
    expect(err.message).not.toContain('"'); // no code-ish quoting
    expect(err.fix).toContain("secondary");
  });
});

describe("full dataset: what an outpost offers", () => {
  it("lists trainer stock and quest skills for a town", async () => {
    const { skillsAtLocation } = await import("../src/index.js");
    const at = skillsAtLocation("Ascalon City", index);
    expect(at.trainer?.name).toBe("Sir Bertran");
    expect(at.trainer!.skills.length).toBeGreaterThan(10);
    expect(at.trainer!.skills.every((s) => typeof s.name === "string")).toBe(true);
  });

  it("returns nothing for an explorable", async () => {
    const { skillsAtLocation } = await import("../src/index.js");
    const at = skillsAtLocation("Old Ascalon", index);
    expect(at.trainer).toBeNull();
    expect(at.quests).toEqual([]);
  });
});

describe("full dataset: per-zone levels beat the monster page", () => {
  it("uses the location's own foe line for the level", async () => {
    const { monstersInLocation } = await import("../src/index.js");
    const at = monstersInLocation("Nolani Academy", index);
    const axeFiend = at.find((m) => m.monster.name === "Charr Axe Fiend")!;
    const gargoyle = at.find((m) => m.monster.name === "Flash Gargoyle")!;
    // the monster pages list every level these appear at anywhere (20 and 3);
    // Nolani's own foe list says 8 and 7
    expect(axeFiend.monster.level).toBe(20);
    expect(axeFiend.level).toBe(8);
    expect(gargoyle.monster.level).toBe(3);
    expect(gargoyle.level).toBe(7);
  });

  it("hard mode uses the parenthesized level from the same line", async () => {
    const { monstersInLocation } = await import("../src/index.js");
    const hard = monstersInLocation("Nolani Academy", index, true);
    expect(hard.find((m) => m.monster.name === "Charr Axe Fiend")!.level).toBe(23);
  });

  it("still picks the right variant when the zone level disambiguates", async () => {
    const { monstersInLocation } = await import("../src/index.js");
    const inVale = monstersInLocation("Traveler's Vale", index).find(
      (m) => m.monster.name === "Riine Windrot",
    )!;
    expect(inVale.level).toBe(12);
    expect(inVale.skills.map((s) => s.ref)).not.toContain("Offering of Blood");
  });
});

describe("campaign scope", () => {
  it("keeps Core and own-campaign content, drops other campaigns", async () => {
    const { inScope, ownedCampaigns } = await import("../src/index.js");
    const tyrian: Character = { ...freshWarrior, campaign: "Prophecies" };
    const owned = ownedCampaigns(tyrian);
    expect(owned).toEqual(["Prophecies"]);

    expect(inScope({ campaign: "Prophecies" }, owned)).toBe(true);
    expect(inScope({ campaign: "Core" }, owned)).toBe(true);
    expect(inScope({ campaign: null }, owned)).toBe(true); // unknown -> keep
    expect(inScope({ campaign: "Factions" }, owned)).toBe(false);
  });

  it("owning a second campaign widens the scope", async () => {
    const { inScope, ownedCampaigns } = await import("../src/index.js");
    const both: Character = {
      ...freshWarrior,
      campaign: "Prophecies",
      ownedCampaigns: ["Prophecies", "Factions"],
    };
    const owned = ownedCampaigns(both);
    expect(inScope({ campaign: "Factions" }, owned)).toBe(true);
    expect(inScope({ campaign: "Nightfall" }, owned)).toBe(false);
  });

  it("a character with no campaign set sees everything (back-compat)", async () => {
    const { inScope, ownedCampaigns, scopedDataset } = await import("../src/index.js");
    const owned = ownedCampaigns(freshWarrior);
    expect(owned).toEqual([]);
    expect(inScope({ campaign: "Factions" }, owned)).toBe(true);
    expect(scopedDataset(index.dataset, freshWarrior).skills.length).toBe(
      index.dataset.skills.length,
    );
  });

  it("scoping drops out-of-campaign locations, trainers and monsters together", async () => {
    const { scopedDataset } = await import("../src/index.js");
    const tyrian: Character = { ...freshWarrior, campaign: "Prophecies" };
    const scoped = scopedDataset(index.dataset, tyrian);
    const names = new Set(scoped.locations.map((l) => l.wikiPage));
    // every surviving trainer stands somewhere still in scope
    for (const t of scoped.trainers) expect(names.has(t.location)).toBe(true);
    // and every monster spawns somewhere still in scope
    for (const m of scoped.monsters) {
      expect(m.locations.some((l) => names.has(l))).toBe(true);
    }
  });
});

describe("full dataset: Kurzick/Luxon allegiance skills", () => {
  const allegiance = index.dataset.skills.filter((s) => s.allegianceSkillIds);

  it("finds all ten, each with a distinct id per side", () => {
    expect(allegiance).toHaveLength(10);
    for (const s of allegiance) {
      const { Kurzick, Luxon } = s.allegianceSkillIds!;
      expect(Kurzick).not.toBe(Luxon);
      // gwSkillId is whichever the infobox lists first, so it must be one of them
      expect([Kurzick, Luxon]).toContain(s.gwSkillId);
    }
  });

  it("has a downloaded icon for both sides", () => {
    for (const s of allegiance) {
      for (const id of Object.values(s.allegianceSkillIds!)) {
        const icon = fileURLToPath(new URL(`../../app/public/icons/${id}.jpg`, import.meta.url));
        expect(existsSync(icon), `${s.name} icon ${id}.jpg`).toBe(true);
      }
    }
  });
});

describe("full dataset: no unlearnable skills leak in as common", () => {
  it("never gives a profession-less skill a profession's attribute", () => {
    // A skill with no profession is treated as common and offered to every
    // build. If it carries an attribute that belongs to a profession, it is
    // almost certainly a summoned creature's attack or a monster skill that
    // slipped past the page exclusions — "Pain (attack) (Signet of Spirits)"
    // did, and showed up for a Necromancer/Elementalist as Ritualist "Pain".
    const owner = new Map<string, string>();
    for (const s of index.dataset.skills) {
      if (s.profession && s.attribute) owner.set(s.attribute, s.profession);
    }
    const leaked = index.dataset.skills
      .filter((s) => !s.profession && s.attribute && owner.has(s.attribute))
      .map((s) => `${s.wikiPage} (${s.attribute})`);
    expect(leaked).toEqual([]);
  });

  it("offers a Necromancer/Elementalist no skill named Pain", () => {
    const character: Character = {
      name: "Nec", primaryProfession: Profession.Necromancer,
      unlockedSecondaries: [Profession.Elementalist], knownSkills: [],
      unlockedLocations: [], completedMissions: [],
    };
    const names = skillAvailability(character, Profession.Elementalist, index).map((e) => e.skill.name);
    expect(names).not.toContain("Pain");
  });
});

describe("full dataset: quests", () => {
  const quests = index.dataset.quests ?? [];

  it("has every skill's quest reference backed by exactly one quest record", () => {
    const pages = quests.map((q) => q.wikiPage);
    expect(new Set(pages).size).toBe(pages.length);
    for (const s of index.dataset.skills) {
      for (const q of s.acquisition.quests) expect(index.questByPage.has(q), `${s.wikiPage} -> ${q}`).toBe(true);
    }
  });

  it("resolves every pickup location and reward", () => {
    for (const q of quests) {
      for (const l of q.givenAt) expect(index.locationByPage.has(l), `${q.wikiPage} @ ${l}`).toBe(true);
      for (const r of q.rewards) expect(index.skillByPage.has(r), `${q.wikiPage} -> ${r}`).toBe(true);
    }
  });

  it("folds redirect aliases into one quest instead of splitting its rewards", () => {
    // skill pages link both "Rally the Recruits" (a redirect) and its target
    const rally = quests.filter((q) => /^Rally the Recruits/.test(q.wikiPage));
    expect(rally).toHaveLength(1);
    expect(rally[0].rewards).toContain("Resurrection Signet");
  });

  it("gates primary-only quests on the primary profession", () => {
    const jinzo = index.questByPage.get("Locate Jinzo")!;
    expect(jinzo).toMatchObject({ profession: "Assassin", primaryOnly: true, givenAt: ["Shing Jea Monastery"] });
    const assassin: Character = { ...freshWarrior, primaryProfession: Profession.Assassin };
    const warriorWithAssassin: Character = { ...freshWarrior, unlockedSecondaries: [Profession.Assassin] };
    expect(canTakeQuest(jinzo, assassin)).toBe(true);
    expect(canTakeQuest(jinzo, warriorWithAssassin)).toBe(false);
  });

  it("drops a quest source the character can never take", () => {
    // Dancing Daggers is a Locate Jinzo reward; a W/A must not be told to go do it
    const wa: Character = {
      ...freshWarrior,
      unlockedSecondaries: [Profession.Assassin],
      unlockedLocations: ["Shing Jea Monastery"],
    };
    const entry = skillAvailability(wa, Profession.Assassin, index).find((e) => e.skill.wikiPage === "Dancing Daggers")!;
    expect(entry.sources.some((s) => s.kind === "quest" && s.via === "Locate Jinzo")).toBe(false);
  });

  it("uses the quest page's location over a skill page that disagrees", () => {
    const a: Character = { ...freshWarrior, primaryProfession: Profession.Assassin, unlockedLocations: ["Shing Jea Monastery"] };
    const entry = skillAvailability(a, null, index).find((e) => e.skill.wikiPage === "Unsuspecting Strike")!;
    const src = entry.sources.find((s) => s.via === "Locate Jinzo")!;
    expect(src).toMatchObject({ location: "Shing Jea Monastery", availableNow: true });
  });
});

describe("full dataset: quest board", () => {
  const board = questBoard(freshWarrior, index, travelDistances(freshWarrior, index));

  it("offers a fresh Ascalon warrior quests next door, nearest first", () => {
    expect(board.length).toBeGreaterThan(0);
    const helping = board.find((e) => e.quest.wikiPage === "Helping the People of Ascalon")!;
    // given in Old Ascalon, which borders Ascalon City
    expect(helping).toMatchObject({ availableNow: true, distance: 0, location: "Old Ascalon" });
    const distances = board.map((e) => (e.availableNow ? -1 : (e.distance ?? Infinity)));
    expect(distances).toEqual([...distances].sort((x, y) => x - y));
  });

  it("only lists rewards the character could learn", () => {
    for (const e of board) {
      for (const s of e.rewards) expect([null, Profession.Warrior]).toContain(s.profession);
    }
    const helping = board.find((e) => e.quest.wikiPage === "Helping the People of Ascalon")!;
    expect(helping.rewards.map((s) => s.name)).toEqual(['"For Great Justice!"']);
  });

  it("hides quests with nothing for this character", () => {
    // Mesmer-only primary quest: nothing a Warrior could take or use
    expect(board.some((e) => e.quest.wikiPage === "A Mesmer's Burden")).toBe(false);
  });

  it("leaves out pre-Searing quests once the character has left", () => {
    expect(board.some((e) => e.preSearing)).toBe(false);
    const stillThere: Character = { ...freshWarrior, unlockedLocations: ["Ascalon City (pre-Searing)"] };
    const pre = questBoard(stillThere, index, travelDistances(stillThere, index));
    expect(pre.some((e) => e.quest.wikiPage === "Warrior Test" && e.preSearing)).toBe(true);
  });

  it("counts rewards already known", () => {
    const knows: Character = { ...freshWarrior, knownSkills: ['"For Great Justice!"'] };
    const e = questBoard(knows, index, travelDistances(knows, index)).find(
      (x) => x.quest.wikiPage === "Helping the People of Ascalon",
    )!;
    expect(e.known).toBe(1);
  });
});

describe("full dataset: travel distance agrees with availability", () => {
  it("puts nothing at distance 0 that availability calls unreachable", () => {
    // Monastery Overlook exits to Shing Jea Monastery but not back; the
    // undirected graph once rated it "0 zones away" while availability said
    // it was not reachable.
    const characters: Character[] = [
      freshWarrior,
      { ...freshWarrior, unlockedLocations: ["Shing Jea Monastery", "Kaineng Center"] },
      { ...freshWarrior, unlockedLocations: ["Kamadan, Jewel of Istan", "Chahbek Village (outpost)", "Boreal Station"] },
    ];
    for (const c of characters) {
      const reachable = reachableExplorables(c, index);
      const unlocked = new Set(c.unlockedLocations);
      for (const [place, d] of travelDistances(c, index).distance) {
        if (d === 0) expect(unlocked.has(place) || reachable.has(place), place).toBe(true);
      }
    }
  });
});
