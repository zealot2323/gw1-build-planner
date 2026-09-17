import {
  ATTRIBUTE_POINTS_AT_20,
  attributesForBuild,
  costOfNextRank,
  MAX_RANK_FROM_POINTS,
  pointsRemaining,
  pointsSpent,
  primaryAttributeOf,
  type Build,
} from "@gw1/engine";

/**
 * Attribute ranks for one build, with the point budget of a level 20
 * character. Ranks above 12 come from runes and headgear, which this
 * planner doesn't track, so 12 is the ceiling here.
 */
export function AttributeEditor({
  build,
  onChange,
}: {
  build: Build;
  onChange: (attributes: Record<string, number>) => void;
}) {
  const attributes = build.attributes ?? {};
  const available = attributesForBuild(build);
  const spent = pointsSpent(attributes);
  const remaining = pointsRemaining(attributes);
  const primary = primaryAttributeOf(build.primary);

  const set = (attribute: string, rank: number) => {
    const next = { ...attributes };
    if (rank <= 0) delete next[attribute];
    else next[attribute] = Math.min(rank, MAX_RANK_FROM_POINTS);
    onChange(next);
  };

  return (
    <div className="attributes">
      <div className="attributes-head small">
        <span className="muted">Attributes</span>
        <span className={remaining < 0 ? "error" : "muted"}>
          {spent} of {ATTRIBUTE_POINTS_AT_20} points used
          {remaining >= 0 ? ` · ${remaining} left` : ` · ${-remaining} over budget`}
        </span>
      </div>
      <div className="attribute-rows">
        {available.map((attribute) => {
          const rank = attributes[attribute] ?? 0;
          const next = costOfNextRank(rank);
          const affordable = next !== null && next <= remaining;
          return (
            <div className="attribute-row" key={attribute}>
              <span className="attribute-name">
                {attribute}
                {attribute === primary && (
                  <span className="muted" title={`${build.primary}'s primary attribute`}>
                    {" "}
                    (primary)
                  </span>
                )}
              </span>
              <button className="small" onClick={() => set(attribute, rank - 1)} disabled={rank === 0} aria-label={`Lower ${attribute}`}>
                −
              </button>
              <span className={rank > 0 ? "attribute-rank" : "attribute-rank muted"}>{rank}</span>
              <button
                className="small"
                onClick={() => set(attribute, rank + 1)}
                disabled={!affordable}
                title={
                  next === null
                    ? `${MAX_RANK_FROM_POINTS} is the highest rank attribute points can buy`
                    : affordable
                      ? `Costs ${next} point${next === 1 ? "" : "s"}`
                      : `Needs ${next} points, ${remaining} left`
                }
                aria-label={`Raise ${attribute}`}
              >
                +
              </button>
              <span className="attribute-cost muted small">
                {next === null ? "max" : `next ${next}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
