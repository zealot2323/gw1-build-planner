/**
 * Campaign scope: which content is this character allowed to see?
 *
 * Guild Wars campaigns are separate continents. A Tyrian character cannot
 * walk to Cantha, and skills sold only in Kaineng are not "6 zones away" —
 * they are unreachable until the account owns Factions. Everything that
 * answers "can I get this" has to respect that, or the proximity dots and
 * travel routes quietly lie.
 */
import type { Campaign, Character, DataIndex, Dataset } from "./index.js";

/** Content with no campaign, or Core content, belongs to everyone. */
const UNIVERSAL: Array<Campaign | null | undefined> = ["Core", null, undefined];

/** Campaigns whose content this character can reach. */
export function ownedCampaigns(character: Character): Campaign[] {
  if (character.ownedCampaigns && character.ownedCampaigns.length > 0) {
    return character.ownedCampaigns;
  }
  return character.campaign ? [character.campaign] : [];
}

/**
 * Is this entity in scope? An entity with no campaign is treated as in
 * scope: the data is imperfect and hiding things the player owns is worse
 * than showing one they don't.
 */
export function inScope(
  entity: { campaign?: Campaign | null },
  owned: Campaign[],
): boolean {
  if (owned.length === 0) return true; // no campaign set — show everything
  if (UNIVERSAL.includes(entity.campaign)) return true;
  return owned.includes(entity.campaign as Campaign);
}

/**
 * A dataset narrowed to what this character can actually reach. Index the
 * result and every downstream query — availability, travel, zone browsing —
 * is campaign-correct for free.
 */
export function scopedDataset(dataset: Dataset, character: Character | null): Dataset {
  if (character === null) return dataset;
  const owned = ownedCampaigns(character);
  if (owned.length === 0) return dataset;

  const locations = dataset.locations.filter((l) => inScope(l, owned));
  const locationNames = new Set(locations.map((l) => l.wikiPage));
  // Missions carry their own campaign tag: a couple of them start from
  // Kurzick/Luxon outposts that don't resolve, so the outpost alone can't
  // decide scope.
  const missions = (dataset.missions ?? []).filter(
    (m) => inScope(m, owned) && (m.outpost === null || locationNames.has(m.outpost)),
  );
  const trainers = dataset.trainers.filter((t) => locationNames.has(t.location));

  return {
    skills: dataset.skills.filter((s) => inScope(s, owned)),
    locations,
    trainers,
    monsters: dataset.monsters.filter((m) => m.locations.some((l) => locationNames.has(l))),
    missions,
    // A quest whose every pickup location is out of scope can't be taken.
    quests: (dataset.quests ?? []).filter(
      (q) => inScope(q, owned) && (q.givenAt.length === 0 || q.givenAt.some((l) => locationNames.has(l))),
    ),
  };
}

/** Campaigns actually present in a dataset, in canonical order. */
export function campaignsIn(index: DataIndex): Campaign[] {
  const order: Campaign[] = ["Prophecies", "Factions", "Nightfall", "Eye of the North"];
  const present = new Set(index.dataset.locations.map((l) => l.campaign).filter(Boolean));
  return order.filter((c) => present.has(c));
}
