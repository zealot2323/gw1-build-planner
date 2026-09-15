/**
 * How far away is something? Breadth-first search over the location graph
 * from everywhere the character has already been. Pure — no I/O.
 */
import type { DataIndex } from "./data.js";
import type { AcquisitionSource, SkillAvailabilityEntry } from "./availability.js";
import type { Character, LocationRef } from "./types.js";

export interface TravelGraph {
  /** Hops from the unlocked set to each location; 0 = already there. */
  distance: Map<LocationRef, number>;
  /** Predecessor on the shortest route, for reconstructing the path. */
  previous: Map<LocationRef, LocationRef>;
}

/**
 * Distance in zone transitions from the character's unlocked locations.
 * The graph is undirected: the wiki records exits one way on some pages and
 * the other way on others, and in game you can always walk back.
 */
export function travelDistances(character: Character, index: DataIndex): TravelGraph {
  const adjacency = new Map<LocationRef, Set<LocationRef>>();
  const link = (a: LocationRef, b: LocationRef) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const loc of index.dataset.locations) {
    for (const n of loc.neighbors) {
      if (!index.locationByPage.has(n)) continue;
      link(loc.wikiPage, n);
      link(n, loc.wikiPage);
    }
  }
  // A mission is entered from its outpost, so it sits one hop away.
  // Consecutive story missions are also linked: parts of Prophecies are
  // only reachable by finishing the campaign to that point (you sail to the
  // Crystal Desert after Sanctum Cay — there is no walkable exit for the
  // infobox to record), which otherwise leaves the map disconnected.
  const missions = index.dataset.missions ?? [];
  missions.forEach((m, i) => {
    if (!m.outpost) return;
    link(m.outpost, m.wikiPage);
    link(m.wikiPage, m.outpost);
    const next = missions[i + 1];
    if (next?.outpost) {
      link(m.wikiPage, next.outpost);
      link(next.outpost, m.wikiPage);
    }
  });

  const distance = new Map<LocationRef, number>();
  const previous = new Map<LocationRef, LocationRef>();
  const queue: LocationRef[] = [];
  for (const start of character.unlockedLocations) {
    if (!index.locationByPage.has(start)) continue;
    distance.set(start, 0);
    queue.push(start);
    // Explorables an unlocked place lists as its own exits are already
    // walkable. This must follow the SAME directional rule as
    // reachableExplorables, not the undirected graph: the wiki lists many
    // one-way links (a tutorial start like Monastery Overlook exits to Shing
    // Jea Monastery, but not back), and the undirected version put such
    // places at "0 zones away" while availability said they were not
    // reachable — both on the same screen.
    const here = index.locationByPage.get(start)!;
    const exits = here.kind === "explorable" ? [] : here.neighbors;
    for (const n of exits) {
      if (distance.has(n) || index.locationByPage.get(n)?.kind !== "explorable") continue;
      distance.set(n, 0);
      previous.set(n, start);
      queue.push(n);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const here = queue[head];
    const d = distance.get(here)!;
    for (const next of adjacency.get(here) ?? []) {
      if (distance.has(next)) continue;
      distance.set(next, d + 1);
      previous.set(next, here);
      queue.push(next);
    }
  }
  return { distance, previous };
}

/** The locations to pass through to reach `destination`, nearest first. */
export function routeTo(graph: TravelGraph, destination: LocationRef): LocationRef[] {
  if (!graph.distance.has(destination)) return [];
  const path: LocationRef[] = [];
  let cursor: LocationRef | undefined = destination;
  while (cursor !== undefined && (graph.distance.get(cursor) ?? 0) > 0) {
    path.unshift(cursor);
    cursor = graph.previous.get(cursor);
  }
  return path;
}

export type Proximity = "now" | "near" | "mid" | "far" | "unknown";

/** 0-2 hops = near (green), 3-5 = mid (yellow), 6+ = far (red). */
export function proximityOf(distance: number | null): Proximity {
  if (distance === null) return "unknown";
  if (distance === 0) return "now";
  if (distance <= 2) return "near";
  if (distance <= 5) return "mid";
  return "far";
}

export interface SkillPlan {
  /** Hops to the closest source; null when no source has a known location. */
  distance: number | null;
  proximity: Proximity;
  /** The cheapest source to go after. */
  best: AcquisitionSource | null;
  /** Zones/missions to unlock on the way there, nearest first. */
  route: LocationRef[];
}

/** How far is this skill, and what stands between you and it? */
export function planForSkill(
  entry: SkillAvailabilityEntry,
  graph: TravelGraph,
): SkillPlan {
  let best: AcquisitionSource | null = null;
  let bestDistance: number | null = null;
  for (const source of entry.sources) {
    if (source.location === null) continue;
    const d = graph.distance.get(source.location);
    if (d === undefined) continue;
    if (bestDistance === null || d < bestDistance) {
      bestDistance = d;
      best = source;
    }
  }
  return {
    distance: bestDistance,
    proximity: proximityOf(bestDistance),
    best,
    route: best?.location ? routeTo(graph, best.location) : [],
  };
}

export interface BuildTodo {
  skill: string;
  plan: SkillPlan;
}

/**
 * What's left to do to actually field a build: every slotted skill the
 * character doesn't know yet, nearest first.
 */
export function buildTodo(
  skills: Array<string | null>,
  availability: SkillAvailabilityEntry[],
  graph: TravelGraph,
): BuildTodo[] {
  const byPage = new Map(availability.map((e) => [e.skill.wikiPage, e]));
  const todo: BuildTodo[] = [];
  for (const ref of skills) {
    if (ref === null) continue;
    const entry = byPage.get(ref);
    if (!entry || entry.status === "KNOWN") continue;
    todo.push({ skill: ref, plan: planForSkill(entry, graph) });
  }
  return todo.sort((a, b) => (a.plan.distance ?? 99) - (b.plan.distance ?? 99));
}
