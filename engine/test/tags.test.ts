import { describe, expect, it } from "vitest";
import { costBucket, skillTags, tagKeys } from "../src/tags.js";

/** A skill as far as tagging cares: name, text and two cost fields. */
const skill = (name: string, description: string, extra: { sacrificePercent?: number; exhaustion?: number } = {}) => ({
  name,
  description,
  sacrificePercent: extra.sacrificePercent ?? null,
  exhaustion: extra.exhaustion ?? null,
});

describe("skillTags", () => {
  it("reads the type line and the weapon an attack needs", () => {
    const t = skillTags(skill("Jagged Strike", "Lead Attack. If Jagged Strike hits, your target suffers from Bleeding for 5...20 seconds."), { target: 5, combo: 1 });
    expect(t.types).toEqual(["Attack"]);
    expect(t.weapon).toEqual(["Dagger", "Melee"]);
    expect(t.target).toEqual(["Foe"]);
    expect(t.inflicts).toEqual(["Bleeding"]);
  });

  it("splits compound spell types", () => {
    expect(skillTags(skill("Aegis", "Elite Flash Enchantment Spell. For 5 seconds, party members have a 50% chance to block.")).types)
      .toEqual(["Enchantment", "Flash enchantment", "Spell"]);
    expect(skillTags(skill("Empathy", "Hex Spell. For 5 seconds, target foe takes 15 damage whenever it attacks."), { target: 5 }).types)
      .toEqual(["Hex", "Spell"]);
  });

  it("maps the client's target codes", () => {
    expect(skillTags(skill("Heal Other", "Spell. Heal target other ally for 35...180 Health."), { target: 4 }).target).toEqual(["Other ally"]);
    expect(skillTags(skill("Rebirth", "Spell. Resurrect target party member."), { target: 6 }).target).toEqual(["Dead ally"]);
    expect(skillTags(skill("Balanced Stance", "Stance. For 8...20 seconds, you cannot be knocked down.")).target).toEqual(["No target"]);
  });

  it("does not read a skill's own name as a condition", () => {
    const t = skillTags(skill("Poison Arrow", "Bow Attack. If Poison Arrow hits, your target becomes Poisoned for 3...15 seconds."), { target: 5 });
    expect(t.inflicts).toEqual(["Poison"]);
    expect(t.worksWith).toEqual([]);
  });

  it("tells inflicting a condition from wanting one", () => {
    const t = skillTags(
      skill("Pulverizing Smash", "Hammer Attack. If you hit a knocked-down foe, that foe suffers from Weakness and a Deep Wound for 5...20 seconds."),
      { target: 5 },
    );
    expect(t.inflicts).toEqual(["Deep Wound", "Weakness"]);
    expect(t.worksWith).toContain("Knocked-down foe");

    const wants = skillTags(skill("Heavy Blow", "Hammer Attack. Lose all adrenaline. If this attack hits a foe suffering from Weakness, that foe is knocked down and you strike for +1...30 damage."), { target: 5 });
    expect(wants.inflicts).toEqual([]);
    expect(wants.worksWith).toContain("Weakness");
    expect(wants.effects).toContain("Knockdown");
  });

  it("keeps a condition on yourself out of inflicts", () => {
    const t = skillTags(skill("Headbutt", "Elite Skill. Target touched foe takes 40...100 damage. You are Dazed for 10 seconds."), { target: 5 });
    expect(t.inflicts).toEqual([]);
    expect(t.effects).toContain("Self condition");
    expect(t.target).toEqual(["Foe", "Touch"]);
  });

  it("does not count a removal list as inflicting every condition", () => {
    const t = skillTags(skill("Mend Condition", "Spell. Remove one condition (Poison, Disease, Blindness, Dazed, Bleeding, Crippled, Burning, Weakness, Cracked Armor, or Deep Wound) from target other ally."), { target: 4 });
    expect(t.inflicts).toEqual([]);
    expect(t.effects).toContain("Condition removal");
  });

  it("judges each mention by its own clause", () => {
    const t = skillTags(skill("Avatar of Grenth", "Elite Form. For 10...90 seconds, your scythe attacks deal dark damage. You are immune to Disease and inflict Disease on all adjacent foes for 3 seconds whenever you lose a Dervish enchantment."));
    expect(t.inflicts).toEqual(["Disease"]);
    expect(t.effects).not.toContain("Enchantment removal");
  });

  it("reads damage types it deals, not ones it defends against", () => {
    expect(skillTags(skill("Fireball", "Spell. Target foe and all adjacent foes are struck for 7...112 fire damage."), { target: 5 }).damage).toEqual(["Fire"]);
    expect(skillTags(skill("Frigid Armor", "Enchantment Spell. For 10...25 seconds, you have +10...40 armor against physical damage and cannot be set on fire.")).damage).toEqual([]);
    const empathy = skillTags(skill("Empathy", "Hex Spell. For 5...11 seconds, whenever target foe attacks, that foe takes 15...33 damage."), { target: 5 });
    expect(empathy.damage).toEqual(["Untyped"]);
    expect(empathy.effects).toContain("Armor-ignoring damage");
  });

  it("finds interactions in trailing if clauses", () => {
    const t = skillTags(skill("Words of Comfort", "Spell. Target ally is healed for 20...65 Health and an additional 20...50 Health if that ally is suffering from a condition."), { target: 3 });
    expect(t.effects).toContain("Healing");
    expect(t.worksWith).toEqual(["Target with a condition"]);
  });

  it("does not treat a hex naming itself as a hexed-foe bonus", () => {
    const t = skillTags(skill("Panic", "Elite Hex Spell. For 1...10 seconds, target foe and all nearby foes are hexed with Panic. When a foe hexed with Panic successfully uses a skill, all other nearby foes are interrupted."), { target: 5 });
    expect(t.worksWith).not.toContain("Hexed foe");
    expect(t.effects).toContain("Interrupt");
  });

  it("reads dagger chain requirements from the client", () => {
    const t = skillTags(skill("Fox Fangs", "Off-Hand Attack. Must follow a lead attack. Fox Fangs cannot be blocked."), { target: 5, combo: 2, comboReq: 2 });
    expect(t.worksWith).toEqual(["Lead attack"]);
    expect(t.effects).toContain("Unblockable");
  });

  it("counts only a foe's skills as disabled", () => {
    expect(skillTags(skill("Simple Thievery", "Elite Spell. Interrupt target foe's action. If that action was a skill, that skill is disabled for 5...20 seconds."), { target: 5 }).effects)
      .toContain("Skill disabling");
    expect(skillTags(skill("Oath Shot", "Elite Bow Attack. If Oath Shot hits, all of your skills except Oath Shot are recharged. If it misses, all of your skills are disabled for 10...4 seconds."), { target: 5 }).effects)
      .not.toContain("Skill disabling");
  });

  it("does not read protections or costs as offensive effects", () => {
    const t = skillTags(skill("Mantra of Resolve", "Stance. For 30...90 seconds, you cannot be interrupted. Whenever you are the target of an interrupt, you lose 2 Energy or Mantra of Resolve ends."));
    expect(t.effects).not.toContain("Interrupt");
    expect(t.effects).not.toContain("Energy denial");
    expect(skillTags(skill("Energy Burn", "Spell. Target foe loses 1...10 Energy."), { target: 5 }).effects).toContain("Energy denial");
  });

  it("carries costs from the skill's own fields", () => {
    const t = skillTags(skill("Blood Is Power", "Elite Enchantment Spell. For 10 seconds, target other ally gains +3...6 Energy regeneration."), { target: 4 });
    expect(t.effects).toContain("Energy gain");
    expect(skillTags(skill("X", "Spell. Something.", { sacrificePercent: 10, exhaustion: 10 })).effects)
      .toEqual(expect.arrayContaining(["Health sacrifice", "Exhaustion"]));
  });
});

describe("skillTags triggers", () => {
  const t = (name: string, text: string, target = 5) => skillTags(skill(name, text), { target });

  it("tells a foe attacking from an ally being attacked", () => {
    expect(t("Empathy", "Hex Spell. For 5...15 seconds, whenever target foe attacks, that foe takes 10...55 damage.").triggers).toEqual(["Foe attacks"]);
    // Being struck is also a foe attacking, so the wider tag finds both.
    expect(t("Shield of Judgment", "Elite Enchantment Spell. For 8...20 seconds, anyone striking target ally with an attack is knocked down and suffers 5...50 holy damage.", 3).triggers)
      .toEqual(["Foe attacks", "Attacked or struck"]);
  });

  it("reads they as the hexed foe only on a hex", () => {
    expect(t("Ineptitude", "Elite Hex Spell. For 4 seconds, the next time the target foe or any adjacent foe attacks, they take 30...135 damage.").triggers).toEqual(["Foe attacks"]);
    expect(t("Anthem of Fury", "Elite Chant. For 10 seconds, all party members within earshot gain 2...5 strikes of adrenaline the next time they use an attack skill.", 0).triggers)
      .toEqual(["You or ally attacks"]);
  });

  it("does not read an attack skill's own hit as a trigger", () => {
    expect(t("Leaping Mantis Sting", "Lead Attack. If Mantis Sting hits, target foe takes +5...15 damage. If this attack strikes a moving foe, that foe is Crippled.").triggers).toEqual([]);
    expect(t("Barrage", "Elite Bow Attack. All your preparations are removed. These arrows strike for +5...20 damage if they hit.").triggers).toEqual([]);
  });

  it("keeps how a stance ends out of what it reacts to", () => {
    expect(t("Tiger Stance", "Stance. For 4...10 seconds, you attack 33% faster. Tiger Stance ends if any of your attacks fail to hit.", 0).triggers).toEqual([]);
  });

  it("finds the other trigger families", () => {
    expect(t("Backfire", "Hex Spell. For 10 seconds, whenever target foe casts a spell, that foe takes 35...140 damage.").triggers).toEqual(["Foe casts a spell"]);
    expect(t("Spirit Bond", "Enchantment Spell. For 8 seconds, whenever target ally takes more than 50 damage from the next 10 attacks or spells, that ally is healed for 30...90 Health.", 3).triggers)
      .toEqual(["Takes damage"]);
    expect(t("Putrid Bile", "Hex Spell. If that foe dies while under the effects of this hex, all nearby foes take 25...85 damage.").triggers).toEqual(["Someone dies"]);
    expect(t("Avatar of Grenth", "Elite Form. You inflict Disease on all adjacent foes whenever you lose a Dervish enchantment.", 0).triggers).toEqual(["Enchantment ends or is lost"]);
    expect(t("Watchful Intervention", "Enchantment Spell. For 60 seconds, the next time damage drops target ally's Health below 25%, that ally is healed.", 3).triggers)
      .toEqual(["Health drops low"]);
  });

  it("does not count a state checked with if as a trigger", () => {
    expect(t("Discharge Enchantment", "Spell. Remove one enchantment from target foe. If that foe is hexed, this skill recharges faster.").triggers).toEqual([]);
  });
});

describe("skillTags requirements", () => {
  it("finds what a skill counts or needs", () => {
    expect(skillTags(skill('"I Will Avenge You!"', "Shout. For each dead ally, you gain 10 seconds of +3...7 Health regeneration."), {}).worksWith).toEqual(["Dead allies"]);
    expect(skillTags(skill("Rebirth", "Spell. Resurrect target dead party member."), { target: 6 }).worksWith).toEqual([]);
    expect(skillTags(skill("Flare", "Spell. Target foe is struck for 26...101 fire damage. If you are Overcast, this skill recharges 50% faster."), { target: 5 }).worksWith)
      .toEqual(["Overcast"]);
  });
});

describe("tagKeys", () => {
  it("flattens tags into facet-qualified keys", () => {
    const keys = tagKeys(skillTags(skill("Fireball", "Spell. Target foe is struck for 7...112 fire damage."), { target: 5 }));
    expect(keys.has("types:Spell")).toBe(true);
    expect(keys.has("damage:Fire")).toBe(true);
    expect(keys.has("target:Foe")).toBe(true);
  });
  it("is empty for an untagged skill", () => {
    expect(tagKeys(undefined).size).toBe(0);
  });
});

describe("costBucket", () => {
  it("buckets by the game's energy costs, adrenaline first", () => {
    expect(costBucket({ energyCost: 3, adrenalineCost: null })).toBe("5");
    expect(costBucket({ energyCost: 25, adrenalineCost: null })).toBe("25");
    expect(costBucket({ energyCost: null, adrenalineCost: 6 })).toBe("adrenaline");
    expect(costBucket({ energyCost: null, adrenalineCost: null })).toBe("free");
  });
});
