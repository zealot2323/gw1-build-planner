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
  /** How long one position lasts. A day unless the cycle says otherwise. */
  periodSeconds?: number;
  /** Cycle length, in positions. */
  mod: number;
  items: T[];
}

const DAY = 86_400;
const periodOf = (cycle: ZaishenCycle<unknown>): number => cycle.periodSeconds ?? DAY;

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

/**
 * Nicholas the Traveler's week: he stands in one explorable area and takes
 * a fixed item in exchange for gifts, moving every Monday at 15:00 UTC.
 */
export interface NicholasEntry {
  /** The explorable area he is standing in, and where the item drops. */
  location: string;
  region: string;
  campaign: string;
  item: string;
  quantity: number;
  outposts: LocationRef[];
  hops: number | null;
  via: string;
}

export interface ZaishenData {
  generatedAt: string;
  missions: ZaishenCycle<ZaishenMissionEntry>;
  bounties: ZaishenCycle<ZaishenBountyEntry>;
  nicholas: ZaishenCycle<NicholasEntry>;
}

/** Position in the cycle for a moment in time. */
export function zaishenIndexAt<T>(cycle: ZaishenCycle<T>, at: Date = new Date()): number {
  const steps = Math.floor((Math.floor(at.getTime() / 1000) - cycle.epoch) / periodOf(cycle));
  return ((steps % cycle.mod) + cycle.mod) % cycle.mod;
}

export function zaishenAt<T>(cycle: ZaishenCycle<T>, at: Date = new Date()): T {
  return cycle.items[zaishenIndexAt(cycle, at)];
}

/** The daily reset: 16:00 UTC, which is where the Zaishen epochs sit. */
export function nextReset(at: Date = new Date()): Date {
  const reset = new Date(at);
  reset.setUTCHours(16, 0, 0, 0);
  if (reset <= at) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

/**
 * When this cycle next moves on. Derived from the cycle's own epoch and
 * period rather than a clock rule, because they do not agree: the Zaishen
 * dailies turn over at 16:00 UTC and Nicholas moves on Mondays at 15:00.
 */
export function nextChange<T>(cycle: ZaishenCycle<T>, at: Date = new Date()): Date {
  const period = periodOf(cycle);
  const elapsed = Math.floor(at.getTime() / 1000) - cycle.epoch;
  return new Date((cycle.epoch + (Math.floor(elapsed / period) + 1) * period) * 1000);
}

/**
 * The next `count` turns of the rotation from `at`, for planning ahead.
 *
 * `on` is when each turn BEGINS, not `at` plus a multiple of the period:
 * asking on a Saturday which area Nicholas visits in three weeks should
 * answer with the Monday he arrives, not with a Saturday.
 */
export function zaishenUpcoming<T>(
  cycle: ZaishenCycle<T>,
  count: number,
  at: Date = new Date(),
): Array<{ on: Date; entry: T }> {
  const period = periodOf(cycle);
  const elapsed = Math.floor(at.getTime() / 1000) - cycle.epoch;
  const start = cycle.epoch + Math.floor(elapsed / period) * period;
  const out: Array<{ on: Date; entry: T }> = [];
  for (let i = 0; i < count; i++) {
    const on = new Date((start + i * period) * 1000);
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

export function nicholasStatus(
  entry: NicholasEntry,
  character: Character,
  index: DataIndex,
): DailyStatus {
  return statusFor(entry.outposts, character, index);
}
