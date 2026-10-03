import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bountyStatus,
  nextChange,
  travelDistances,
  nicholasStatus,
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

describe("Nicholas the Traveler", () => {
  const cycle = zaishen.nicholas;

  it("runs weekly, not daily", () => {
    expect(cycle.periodSeconds).toBe(604_800);
    expect(cycle.mod).toBe(137);
    expect(cycle.items).toHaveLength(137);
  });

  it("matches the wiki's own answer for a known week", () => {
    // verified against the wiki's template expansion while building this
    const at = new Date("2026-10-03T12:00:00Z");
    expect(zaishenAt(cycle, at)).toMatchObject({
      location: "Jahai Bluffs",
      item: "Elonian Leather Squares",
      quantity: 5,
    });
    expect(zaishenIndexAt(cycle, at)).toBe(88);
  });

  it("moves on Monday at 15:00 UTC, an hour before the dailies", () => {
    const before = new Date("2026-10-05T14:59:00Z");
    const after = new Date("2026-10-05T15:01:00Z");
    expect(zaishenAt(cycle, before).location).toBe("Jahai Bluffs");
    expect(zaishenAt(cycle, after).location).toBe("Vehjin Mines");
    expect(nextChange(cycle, before).toISOString()).toBe("2026-10-05T15:00:00.000Z");
    // the Zaishen dailies turn over at a different time on the same day
    expect(nextChange(zaishen.missions, before).toISOString()).toBe("2026-10-05T16:00:00.000Z");
  });

  it("steps a week at a time, from the Monday each week begins", () => {
    // asked on a Saturday
    const weeks = zaishenUpcoming(cycle, 3, new Date("2026-10-03T12:00:00Z"));
    expect(weeks.map((w) => w.entry.location)).toEqual([
      "Jahai Bluffs",
      "Vehjin Mines",
      "Reed Bog",
    ]);
    expect(weeks.map((w) => w.on.toISOString())).toEqual([
      "2026-09-28T15:00:00.000Z",
      "2026-10-05T15:00:00.000Z",
      "2026-10-12T15:00:00.000Z",
    ]);
    for (const w of weeks) expect(w.on.getUTCDay(), w.on.toISOString()).toBe(1); // Monday
  });

  it("resolves every week to an outpost we know", () => {
    for (const week of cycle.items) {
      expect(week.outposts.length, week.location).toBeGreaterThan(0);
      for (const o of week.outposts) expect(index.locationByPage.has(o), `${week.location} -> ${o}`).toBe(true);
    }
  });

  it("tells a character whether they can reach the collection zone", () => {
    const week = cycle.items.find((w) => w.location === "North Kryta Province")!;
    const ready = character({ unlockedLocations: week.outposts });
    expect(nicholasStatus(week, ready, index).ready).toBe(true);
    expect(nicholasStatus(week, character(), index).ready).toBe(false);
  });
});

describe("how far away today's activity is", () => {
  const mission = zaishen.missions.items.find((m) => m.name === "The Great Northern Wall")!;

  const withGraph = (c: Character) => {
    const graph = travelDistances(c, index);
    return missionStatus(mission, c, index, graph);
  };

  it("is zero zones away once an entrance is unlocked", () => {
    const status = withGraph(character({ unlockedLocations: mission.outposts }));
    expect(status).toMatchObject({ ready: true, distance: 0, proximity: "now" });
  });

  it("counts the zones to the nearest entrance", () => {
    // Ascalon City is a couple of zones from the mission outpost
    const status = withGraph(character({ unlockedLocations: ["Ascalon City"] }));
    expect(status.ready).toBe(false);
    expect(status.distance).toBeGreaterThan(0);
    expect(status.distance).toBeLessThan(6);
    expect(status.proximity).not.toBe("unknown");
  });

  it("says nothing rather than zero when there is no route", () => {
    const stranded = withGraph(character({ unlockedLocations: [] }));
    expect(stranded.distance).toBeNull();
    expect(stranded.proximity).toBe("unknown");
  });

  it("leaves the distance unknown when no travel graph is given", () => {
    expect(missionStatus(mission, character({ unlockedLocations: ["Ascalon City"] }), index).distance).toBeNull();
  });
});
