/**
 * Recent game updates: which skills the game has changed lately, and what
 * they looked like before. Pure functions over the scraped change log.
 */
import type {
  Skill,
  SkillChange,
  SkillChangeLog,
  SkillChangeRecord,
  SkillRef,
  SkillVersion,
} from "./types.js";

/**
 * How far back a change still counts as "recent". The scraper caches a
 * wider window than this, so changing it needs no refetch.
 */
export const RECENT_MONTHS = 6;

export interface ChangeIndex {
  /** Every skill with at least one balance change inside the window. */
  recentlyChanged: Map<SkillRef, SkillChangeRecord>;
  /** Oldest date inside the window (ISO). */
  since: string;
  /** The log's own coverage start — earlier changes simply aren't known. */
  coveredSince: string;
}

/** ISO date `months` before `asOf`. */
export function cutoffDate(asOf: Date, months: number): string {
  const d = new Date(asOf);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Narrow a change log to the highlight window.
 *
 * Only `balance` changes make a skill "recently changed" — an AI retune or
 * a wiki editor's clarification doesn't alter how the skill plays. Other
 * kinds are still carried on the record, so the detail view can show them.
 */
export function indexChanges(
  log: SkillChangeLog | null | undefined,
  months: number = RECENT_MONTHS,
  asOf: Date = new Date(),
): ChangeIndex {
  const since = cutoffDate(asOf, months);
  const recentlyChanged = new Map<SkillRef, SkillChangeRecord>();
  for (const record of log?.skills ?? []) {
    const changes = record.changes.filter((c) => c.date >= since);
    if (!changes.some((c) => c.kind === "balance")) continue;
    recentlyChanged.set(record.skill, { ...record, changes });
  }
  return { recentlyChanged, since, coveredSince: log?.since ?? since };
}

/** The balance changes on a record, newest first. */
export function balanceChanges(record: SkillChangeRecord): SkillChange[] {
  return record.changes.filter((c) => c.kind === "balance");
}

/** Date of the most recent balance change, or null. */
export function lastChangedOn(record: SkillChangeRecord): string | null {
  return balanceChanges(record)[0]?.date ?? null;
}

/** One field that differs between the old version and the live skill. */
export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

function show(value: number | null | undefined, suffix = ""): string | null {
  return value === null || value === undefined ? null : `${value}${suffix}`;
}

/**
 * Compare a past version against the skill as it stands now.
 *
 * Only fields the wiki records in both places are compared, and a field
 * missing on one side is skipped rather than reported as a change to or
 * from nothing — skill infoboxes omit fields that don't apply (an
 * adrenaline skill has no energy cost), and absence is not a value.
 */
export function diffVersion(previous: SkillVersion, current: Skill): FieldDiff[] {
  const pairs: Array<[string, string | null, string | null]> = [
    ["Energy", show(previous.energyCost), show(current.energyCost)],
    ["Adrenaline", show(previous.adrenalineCost), show(current.adrenalineCost)],
    ["Sacrifice", show(previous.sacrificePercent, "%"), show(current.sacrificePercent, "%")],
    ["Upkeep", show(previous.upkeep), show(current.upkeep)],
    ["Activation", show(previous.activation, "s"), show(current.activation, "s")],
    ["Recharge", show(previous.recharge, "s"), show(current.recharge, "s")],
    ["Attribute", previous.attribute, current.attribute],
    ["Elite", String(previous.isElite), String(current.isElite)],
    ["Description", previous.description || null, current.description || null],
  ];
  const out: FieldDiff[] = [];
  for (const [field, before, after] of pairs) {
    if (before === null || after === null) continue;
    if (before !== after) out.push({ field, before, after });
  }
  return out;
}
