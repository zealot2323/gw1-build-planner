import { describe, expect, it } from "vitest";
import { mergeGuestCharacters, Profession, type SavedCharacter } from "../src/index.js";

function char(name: string, extra: Partial<SavedCharacter> = {}): SavedCharacter {
  return {
    name,
    primaryProfession: Profession.Warrior,
    unlockedSecondaries: [],
    knownSkills: [],
    unlockedLocations: [],
    completedMissions: [],
    builds: [],
    ...extra,
  };
}

describe("mergeGuestCharacters", () => {
  it("adopts guest characters into an empty account", () => {
    const r = mergeGuestCharacters([], [char("Guesty")]);
    expect(r.characters.map((c) => c.name)).toEqual(["Guesty"]);
    expect(r.added).toEqual(["Guesty"]);
  });

  it("adds guest characters to an account that already has some", () => {
    // the case the old code got wrong: guest work was hidden behind the cloud save
    const r = mergeGuestCharacters([char("Main")], [char("Alt")]);
    expect(r.characters.map((c) => c.name)).toEqual(["Main", "Alt"]);
    expect(r.added).toEqual(["Alt"]);
  });

  it("skips a guest character already in the account unchanged", () => {
    const same = char("Main", { knownSkills: ["Sprint"] });
    // same contents, different key order — still identical
    const { builds, ...rest } = same;
    const reordered = JSON.parse(JSON.stringify({ builds, ...rest })) as SavedCharacter;
    const r = mergeGuestCharacters([same], [reordered]);
    expect(r.characters).toHaveLength(1);
    expect(r.alreadyThere).toEqual(["Main"]);
  });

  it("keeps both when the names clash but the characters differ", () => {
    const account = char("Main", { knownSkills: ["Sprint"] });
    const guest = char("Main", {
      knownSkills: ["Frenzy"],
      builds: [{ name: "b", character: "Main", primary: Profession.Warrior, secondary: null, skills: [null, null, null, null, null, null, null, null] }],
    });
    const r = mergeGuestCharacters([account], [guest]);
    expect(r.characters.map((c) => c.name)).toEqual(["Main", "Main (guest)"]);
    expect(r.characters[0]).toBe(account); // the account's version is untouched
    expect(r.renamed).toEqual([{ from: "Main", to: "Main (guest)" }]);
    expect(r.characters[1].knownSkills).toEqual(["Frenzy"]);
    expect(r.characters[1].builds[0].character).toBe("Main (guest)");
  });

  it("never reuses a taken guest name", () => {
    const r = mergeGuestCharacters(
      [char("Main"), char("Main (guest)")],
      [char("Main", { knownSkills: ["Frenzy"] })],
    );
    expect(r.renamed).toEqual([{ from: "Main", to: "Main (guest 2)" }]);
  });

  it("never drops a character", () => {
    const account = [char("A"), char("B", { knownSkills: ["x"] })];
    const guest = [char("B", { knownSkills: ["y"] }), char("C"), char("A")];
    const r = mergeGuestCharacters(account, guest);
    expect(r.characters.length).toBe(account.length + r.added.length + r.renamed.length);
    expect(r.added.length + r.renamed.length + r.alreadyThere.length).toBe(guest.length);
  });
});
