/**
 * Availability logic: what can this character get, right now, and from where?
 * Pure functions over the dataset — no I/O.
 */
import { locationsWithSkill } from "./bestiary.js";
import type { DataIndex } from "./data.js";
import { DEFAULT_ALLEGIANCE } from "./types.js";
import type { Character, LocationRef, Profession, Skill, SkillRef } from "./types.js";

/**
 * Explorable areas the character can enter: every explorable adjacent (via
 * location neighbors) to any unlocked location, plus any explorables the
 * character has unlocked directly.
 *
 * ⚠ SIMPLIFICATION: one hop only. Real reachability can chain through
 * multiple explorables (you can walk Traveler's Vale -> Iron Horse Mine
 * without an outpost in between); we deliberately ignore that for the PoC.
 */
export function reachableExplorables(character: Character, index: DataIndex): Set<LocationRef> {
  const out = new Set<LocationRef>();
  for (const name of character.unlockedLocations) {
    const loc = index.locationByPage.get(name);
    if (!loc) continue;
    if (loc.kind === "explorable") {
      out.add(loc.wikiPage);
      continue;
    }
    for (const n of loc.neighbors) {
      if (index.locationByPage.get(n)?.kind === "explorable") out.add(n);
    }
  }
  return out;
}

export type SkillStatus =
  | "KNOWN"
  | "PURCHASABLE_NOW"
  | "QUESTABLE_NOW"
  | "CAPTURABLE_NOW"
  | "FUTURE";

export interface AcquisitionSource {
  kind: "trainer" | "quest" | "capture" | "title";
  /** Trainer name, quest name, or boss name. */
  via: string;
  /** Where to go: the trainer's outpost, the quest giver's location, or the boss's area. */
  location: LocationRef | null;
  /** True if the character can act on this source right now. */
  availableNow: boolean;
  /** For title-gated sources: the rank you need before the NPC will teach it. */
  requirement?: string;
}

export interface SkillAvailabilityEntry {
  skill: Skill;
  status: SkillStatus;
  /**
   * Every acquisition source with its location — for FUTURE skills this is
   * the "where do I go to get this" answer; sorted with available-now
   * sources first.
   */
  sources: AcquisitionSource[];
}

/**
 * Classify every skill usable by the character's primary + the selected
 * secondary (plus no-profession/common skills). Precedence:
 * KNOWN > PURCHASABLE_NOW > QUESTABLE_NOW > CAPTURABLE_NOW > FUTURE.
 */
export function skillAvailability(
  character: Character,
  secondary: Profession | null,
  index: DataIndex,
): SkillAvailabilityEntry[] {
  const unlocked = new Set(character.unlockedLocations);
  const reachable = reachableExplorables(character, index);
  const known = new Set<SkillRef>(character.knownSkills);
  const allegiance = character.allegiance ?? DEFAULT_ALLEGIANCE;
  const professions = new Set<Profession>([character.primaryProfession]);
  if (secondary !== null) professions.add(secondary);

  const out: SkillAvailabilityEntry[] = [];
  for (const skill of index.dataset.skills) {
    if (skill.profession !== null && skill.profession !== undefined && !professions.has(skill.profession)) {
      continue;
    }

    const sources: AcquisitionSource[] = [];

    // Trainer: purchasable now iff the trainer's outpost is unlocked.
    for (const name of skill.acquisition.trainers) {
      const trainer = index.trainerByName.get(name);
      const location = trainer?.location ?? null;
      sources.push({
        kind: "trainer",
        via: name,
        location,
        availableNow: location !== null && unlocked.has(location),
      });
    }

    // Quest: questable now iff given from an unlocked location, or from an
    // explorable adjacent to one. ⚠ Same one-hop SIMPLIFICATION as
    // reachableExplorables.
    for (const quest of skill.acquisition.quests) {
      const location = skill.acquisition.questLocations?.[quest] ?? null;
      sources.push({
        kind: "quest",
        via: quest,
        location,
        availableNow: location !== null && (unlocked.has(location) || reachable.has(location)),
      });
    }

    // Capture: capturable now iff a boss using the skill spawns in a
    // reachable explorable. ⚠ Same one-hop SIMPLIFICATION. Conditional
    // (quest/event-gated) capture bosses are excluded from "now" but shown
    // as future sources.
    for (const boss of skill.acquisition.captureBosses) {
      const monster = index.monsterByPage.get(boss);
      // Only the zones where the boss's stat block actually carries this
      // skill count — bosses with per-level blocks (Riine Windrot) don't
      // bring their high-level elite to their low-level spawns.
      const spawns = monster ? locationsWithSkill(monster, skill.wikiPage) : [];
      const nowIn = spawns.find((l) => reachable.has(l));
      sources.push({
        kind: "capture",
        via: boss,
        location: nowIn ?? spawns[0] ?? skill.acquisition.captureLocations?.[boss] ?? null,
        availableNow: nowIn !== undefined,
      });
    }
    // Title-gated NPCs: reaching them is not enough, you need the rank, so
    // these never count as available now — but they still say where to go.
    // The character's own side goes first: the Kurzick and Luxon versions of
    // an allegiance skill are bought from different NPCs in different towns.
    const titleNpcs = [...(skill.acquisition.titleNpcs ?? [])].sort(
      (a, b) => Number(b.includes(allegiance)) - Number(a.includes(allegiance)),
    );
    for (const npc of titleNpcs) {
      sources.push({
        kind: "title",
        via: npc,
        location: skill.acquisition.titleLocations?.[npc] ?? null,
        availableNow: false,
        requirement: skill.acquisition.titleRequirement,
      });
    }
    for (const boss of skill.acquisition.conditionalCaptureBosses ?? []) {
      sources.push({
        kind: "capture",
        via: boss,
        location: skill.acquisition.captureLocations?.[boss] ?? null,
        availableNow: false,
      });
    }

    sources.sort((a, b) => Number(b.availableNow) - Number(a.availableNow));

    const nowOf = (kind: AcquisitionSource["kind"]) =>
      sources.some((s) => s.kind === kind && s.availableNow);
    const status: SkillStatus = known.has(skill.wikiPage)
      ? "KNOWN"
      : nowOf("trainer")
        ? "PURCHASABLE_NOW"
        : nowOf("quest")
          ? "QUESTABLE_NOW"
          : nowOf("capture")
            ? "CAPTURABLE_NOW"
            : "FUTURE";

    out.push({ skill, status, sources });
  }
  return out;
}
