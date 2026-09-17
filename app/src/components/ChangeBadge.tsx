import { balanceChanges, lastChangedOn, type SkillChangeRecord } from "@gw1/engine";

/** "3 weeks ago", "5 months ago" — updates are dated, not timestamped. */
export function agoLabel(date: string, asOf: Date = new Date()): string {
  // floor, not round: 11½ days since the patch is "11 days ago", not 12
  const days = Math.max(0, Math.floor((asOf.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * Marks a skill the game has rebalanced recently. Deliberately quiet — it
 * sits in lists next to the availability dot, so it has to read at a glance
 * without competing with it.
 */
export function ChangeBadge({ record }: { record: SkillChangeRecord }) {
  const on = lastChangedOn(record);
  if (on === null) return null;
  const n = balanceChanges(record).length;
  return (
    <span
      className="change-badge"
      title={`${n} balance change${n === 1 ? "" : "s"}, most recently on ${on} (${agoLabel(on)})`}
    >
      ↻
    </span>
  );
}
