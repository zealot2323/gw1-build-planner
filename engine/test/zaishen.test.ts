import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bountyStatus,
  indexDataset,
  missionStatus,
  nextReset,
  Profession,
  zaishenAt,
  zaishenIndexAt,
  zaishenUpcoming,
  type Character,
  type Dataset,
  type ZaishenData,
} from "../src/index.js";

const data = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${f}`, import.meta.url)), "utf8"));
const index = indexDataset({
  skills: data("skills.json"), locations: data("locations.json"), trainers: data("trainers.json"),
  monsters: data("monsters.json"), missions: data("missions.json"), quests: data("quests.json"),
} as Dataset);
const zaishen: ZaishenData = data("zaishen.json");

const character = (patch: Partial<Character> = {}): Character => ({
  name: "C", primaryProfession: Profession.Warrior, unlockedSecondaries: [],
  knownSkills: [], unlockedLocations: [], completedMissions: [],
  campaign: "Prophecies", ownedCampaigns: ["Prophecies"], ...patch,
});

describe("zaishen rotation", () => {
  it("matches the wiki's own answer for a known day", () => {
    // verified against the wiki's template expansion while building this
    const at = new Date("2026-10-03T07:58:00Z");
    expect(zaishenAt(zaishen.missions, at).name).toBe("Moddok Crevice");
    expect(zaishenAt(zaishen.bounties, at).boss).toBe("Priest of Menzies");
  });

  it("rolls over at 16:00 UTC, not midnight", () => {
    const before = new Date("2026-10-03T15:59:00Z");
    const after = new Date("2026-10-03T16:01:00Z");
    expect(zaishenAt(zaishen.missions, before).name).toBe("Moddok Crevice");
    expect(zaishenAt(zaishen.missions, after).name).not.toBe("Moddok Crevice");
    expect(nextReset(before).toISOString()).toBe("2026-10-03T16:00:00.000Z");
    expect(nextReset(after).toISOString()).toBe("2026-10-04T16:00:00.000Z");
  });

  it("stays inside the cycle for dates far from the epoch", () => {
    for (const iso of ["2005-04-28T12:00:00Z", "2099-01-01T00:00:00Z"]) {
      const i = zaishenIndexAt(zaishen.missions, new Date(iso));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(zaishen.missions.mod);
    }
  });

  it("repeats after a full cycle", () => {
    const at = new Date("2026-10-03T18:00:00Z");
    const later = new Date(at.getTime() + zaishen.missions.mod * 86_400_000);
    expect(zaishenAt(zaishen.missions, later).name).toBe(zaishenAt(zaishen.missions, at).name);
  });

  it("lists upcoming days in order", () => {
    const week = zaishenUpcoming(zaishen.bounties, 7, new Date("2026-10-03T18:00:00Z"));
    expect(week).toHaveLength(7);
    expect(week[0].entry.boss).not.toBe(week[1].entry.boss);
  });
});

describe("zaishen data", () => {
  it("resolves every entry to at least one outpost we know", () => {
    for (const m of zaishen.missions.items) {
      expect(m.outposts.length, m.name).toBeGreaterThan(0);
      for (const o of m.outposts) expect(index.locationByPage.has(o), `${m.name} -> ${o}`).toBe(true);
    }
    for (const b of zaishen.bounties.items) {
      expect(b.outposts.length, b.boss).toBeGreaterThan(0);
      for (const o of b.outposts) expect(index.locationByPage.has(o), `${b.boss} -> ${o}`).toBe(true);
    }
  });

  it("covers a full cycle with no gaps", () => {
    expect(zaishen.missions.items).toHaveLength(zaishen.missions.mod);
    expect(zaishen.bounties.items).toHaveLength(zaishen.bounties.mod);
  });
});

describe("whether a character can do today's activity", () => {
  const mission = zaishen.missions.items.find((m) => m.name === "The Great Northern Wall")!;
  const bounty = zaishen.bounties.items.find((b) => b.boss === "Frostmaw the Kinslayer")!;

  it("is ready when the outpost is unlocked", () => {
    const ready = character({ unlockedLocations: mission.outposts });
    expect(missionStatus(mission, ready, index).ready).toBe(true);
    expect(missionStatus(mission, character(), index).ready).toBe(false);
  });

  it("reports a completed mission separately from being able to reach it", () => {
    const done = character({ unlockedLocations: mission.outposts, completedMissions: [mission.name] });
    const status = missionStatus(mission, done, index);
    expect(status).toMatchObject({ ready: true, completed: true });
    // reachable but not yet done
    expect(missionStatus(mission, character({ unlockedLocations: mission.outposts }), index).completed).toBe(false);
  });

  it("names the campaign a character doesn't own", () => {
    // Frostmaw sits in an Eye of the North dungeon
    const tyrian = character();
    const status = bountyStatus(bounty, tyrian, index);
    expect(status.ready).toBe(false);
    expect(status.missingCampaigns).toContain("Eye of the North");
  });

  it("doesn't blame a campaign when another entrance is in one they own", () => {
    // the Fissure of Woe has an entrance in each campaign
    const fow = zaishen.bounties.items.find((b) => b.boss === "Priest of Menzies")!;
    const canthan = character({ campaign: "Factions", ownedCampaigns: ["Factions"] });
    const status = bountyStatus(fow, canthan, index);
    expect(status.missingCampaigns).toEqual([]);
    expect(status.ready).toBe(false); // owns the campaign, just hasn't been there
  });

  it("needs only one of several outposts", () => {
    const pair = zaishen.missions.items.find((m) => m.outposts.length > 1)!;
    const half = character({ unlockedLocations: [pair.outposts[0]], ownedCampaigns: ["Factions"] });
    expect(missionStatus(pair, half, index).ready).toBe(true);
  });
});
