/**
 * Zaishen daily activities: today's mission and bounty, and whether a
 * character can actually go and do them.
 *
 * The rotations are arithmetic, not a feed: `(t - epoch) / 86400 mod N`
 * over a list scraped once. Both epochs sit at 16:00 UTC, which is when the
 * dailies roll over, so flooring the division lands on the right day with
 * no special-casing — and any date, past or future, can be answered offline.
 */
import type { Campaign, Character, LocationRef } from "./types.js";
import type { DataIndex } from "./data.js";

export interface ZaishenCycle<T> {
  /** Unix seconds of cycle position 0. */
  epoch: number;
  /** Cycle length in days. */
  mod: number;
  items: T[];
}

export interface ZaishenMissionEntry {
  name: string;
  /** Eye of the North has no missions; its rotation entries are quests. */
  kind: "mission" | "quest";
  area: string | null;
  /** Any one of these unlocks it — Kurzick/Luxon pairs have two. */
  outposts: LocationRef[];
}

export interface ZaishenBountyEntry {
  boss: string;
  area: string | null;
  outposts: LocationRef[];
  /** Hops from the area to that outpost; 0 when it is the area's own outpost. */
  hops: number | null;
  /** How the outpost was derived, for auditing the scrape. */
  via: string;
}

export interface ZaishenData {
  generatedAt: string;
  missions: ZaishenCycle<ZaishenMissionEntry>;
  bounties: ZaishenCycle<ZaishenBountyEntry>;
}

/** Position in the cycle for a moment in time. */
export function zaishenIndexAt<T>(cycle: ZaishenCycle<T>, at: Date = new Date()): number {
  const days = Math.floor((Math.floor(at.getTime() / 1000) - cycle.epoch) / 86_400);
  return ((days % cycle.mod) + cycle.mod) % cycle.mod;
}

export function zaishenAt<T>(cycle: ZaishenCycle<T>, at: Date = new Date()): T {
  return cycle.items[zaishenIndexAt(cycle, at)];
}

/** The daily reset: 16:00 UTC, which is where the cycle epochs sit. */
export function nextReset(at: Date = new Date()): Date {
  const reset = new Date(at);
  reset.setUTCHours(16, 0, 0, 0);
  if (reset <= at) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

/** `count` days of the rotation from `at`, for planning ahead. */
export function zaishenUpcoming<T>(
  cycle: ZaishenCycle<T>,
  count: number,
  at: Date = new Date(),
): Array<{ on: Date; entry: T }> {
  const out: Array<{ on: Date; entry: T }> = [];
  for (let day = 0; day < count; day++) {
    const on = new Date(at.getTime() + day * 86_400_000);
    out.push({ on, entry: zaishenAt(cycle, on) });
  }
  return out;
}

export interface DailyStatus {
  /** Outposts that would let this character in; any one is enough. */
  outposts: LocationRef[];
  unlocked: LocationRef[];
  /** They can travel there now. */
  ready: boolean;
  /** Campaigns among the outposts that this character doesn't own. */
  missingCampaigns: Campaign[];
  /** Missions only: already completed. */
  completed?: boolean;
}

const ownedCampaignsOf = (character: Character): Campaign[] =>
  character.ownedCampaigns && character.ownedCampaigns.length > 0
    ? character.ownedCampaigns
    : character.campaign
      ? [character.campaign]
      : [];

/**
 * Whether a character can reach today's activity. "Ready" means they have
 * unlocked one of its outposts — map travel is the only requirement the
 * planner can check. A character who doesn't own the campaign is reported
 * separately, since that is a different problem from not having been there.
 */
function statusFor(outposts: LocationRef[], character: Character, index: DataIndex): DailyStatus {
  const unlocked = outposts.filter((o) => character.unlockedLocations.includes(o));
  const owned = ownedCampaignsOf(character);
  const campaigns = outposts.map((o) => index.locationByPage.get(o)?.campaign);
  // Several entrances can lead to the same place — the Fissure of Woe has
  // one per campaign. Owning any of them is enough, so a campaign is only
  // reported as missing when none of the entrances is one they can reach.
  const reachable = campaigns.some(
    (c) => !c || c === "Core" || owned.length === 0 || owned.includes(c),
  );
  const missingCampaigns = reachable
    ? []
    : [...new Set(campaigns.filter((c): c is Campaign => !!c))];
  return { outposts, unlocked, ready: unlocked.length > 0, missingCampaigns };
}

export function missionStatus(
  entry: ZaishenMissionEntry,
  character: Character,
  index: DataIndex,
): DailyStatus {
  return {
    ...statusFor(entry.outposts, character, index),
    completed: character.completedMissions.includes(entry.name),
  };
}

export function bountyStatus(
  entry: ZaishenBountyEntry,
  character: Character,
  index: DataIndex,
): DailyStatus {
  return statusFor(entry.outposts, character, index);
}
