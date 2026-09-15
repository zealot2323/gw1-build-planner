/**
 * The quest board: which quests would teach this character a skill, and
 * how far away each one is. Pure functions over the dataset.
 */
import { canTakeQuest, reachableExplorables } from "./availability.js";
import type { DataIndex } from "./data.js";
import { proximityOf, routeTo, type Proximity, type TravelGraph } from "./travel.js";
import type { Character, LocationRef, Profession, Quest, Skill } from "./types.js";

export interface QuestBoardEntry {
  quest: Quest;
  /**
   * Rewards the character could learn: their primary, any unlocked
   * secondary, or no-profession skills. Most quests offer one skill per
   * profession and let you pick one, so the rest are irrelevant here.
   */
  rewards: Skill[];
  /** How many of `rewards` the character already knows. */
  known: number;
  /** The nearest place to pick it up. */
  location: LocationRef | null;
  /** Given at an unlocked location, or an explorable next to one. */
  availableNow: boolean;
  distance: number | null;
  proximity: Proximity;
  route: LocationRef[];
  /** Picked up in pre-Searing Ascalon — gone once the character leaves. */
  preSearing: boolean;
}

/**
 * Every quest this character is allowed to take that rewards at least one
 * skill they could use, nearest first.
 *
 * ⚠ Same one-hop SIMPLIFICATION as the rest of availability: "available now"
 * means given at an unlocked location or an explorable adjacent to one.
 * Prerequisite quests are not checked — completion isn't tracked.
 */
export function questBoard(character: Character, index: DataIndex, graph: TravelGraph): QuestBoardEntry[] {
  const usable = new Set<Profession>([character.primaryProfession, ...character.unlockedSecondaries]);
  const known = new Set(character.knownSkills);
  const unlocked = new Set(character.unlockedLocations);
  const reachable = reachableExplorables(character, index);

  // Pre-Searing Ascalon is one-way: once a character has left, its quests
  // are gone for good. Only offer them to a character still there — one
  // with a pre-Searing location unlocked.
  const inPreSearing = character.unlockedLocations.some((l) => index.locationByPage.get(l)?.preSearing);

  const out: QuestBoardEntry[] = [];
  for (const quest of index.dataset.quests ?? []) {
    if (!canTakeQuest(quest, character)) continue;
    const preSearing =
      quest.givenAt.length > 0 && quest.givenAt.every((l) => index.locationByPage.get(l)?.preSearing === true);
    if (preSearing && !inPreSearing) continue;
    const rewards = quest.rewards
      .map((page) => index.skillByPage.get(page))
      .filter((s): s is Skill => s !== undefined && (s.profession === null || usable.has(s.profession)))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (rewards.length === 0) continue;

    // nearest pickup point among the alternatives the wiki lists
    const places = quest.givenAt
      .map((l) => ({ l, d: graph.distance.get(l) ?? null }))
      .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
    const nowAt = quest.givenAt.find((l) => unlocked.has(l) || reachable.has(l));
    const location = nowAt ?? places[0]?.l ?? null;
    const distance = nowAt !== undefined ? 0 : (places[0]?.d ?? null);

    out.push({
      quest,
      rewards,
      known: rewards.filter((s) => known.has(s.wikiPage)).length,
      location,
      availableNow: nowAt !== undefined,
      distance,
      proximity: proximityOf(distance),
      route: location && nowAt === undefined ? routeTo(graph, location) : [],
      preSearing,
    });
  }

  return out.sort(
    (a, b) =>
      Number(b.availableNow) - Number(a.availableNow) ||
      (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
      a.quest.name.localeCompare(b.quest.name),
  );
}
