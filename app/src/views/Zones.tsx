import { useMemo, useState } from "react";
import { monstersInLocation } from "@gw1/engine";
import { dataset, index } from "../data";

/** Region -> locations tree; clicking an explorable/mission shows monsters. */
export function ZonesView({ onSkillClick }: { onSkillClick: (skill: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set(["Ascalon"]));

  const regions = useMemo(() => {
    const byRegion = new Map<string, { name: string; kind: string }[]>();
    for (const l of dataset.locations) {
      const region = l.region ?? "(unknown region)";
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region)!.push({ name: l.wikiPage, kind: l.kind });
    }
    for (const m of dataset.missions ?? []) {
      const region = m.region ?? "(unknown region)";
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region)!.push({ name: m.wikiPage, kind: "mission" });
    }
    return [...byRegion.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, []);

  const monsters = selected ? monstersInLocation(selected, index) : [];
  const hasBestiary = (kind: string) => kind === "explorable" || kind === "mission";

  return (
    <div className="view row align-top">
      <div className="card zone-tree">
        <h3>Prophecies</h3>
        {regions.map(([region, locs]) => (
          <div key={region}>
            <button
              className="linkish region"
              onClick={() =>
                setOpenRegions((s) => {
                  const next = new Set(s);
                  if (next.has(region)) next.delete(region);
                  else next.add(region);
                  return next;
                })
              }
            >
              {openRegions.has(region) ? "▾" : "▸"} {region}
            </button>
            {openRegions.has(region) && (
              <ul className="plain-list indent">
                {locs
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((l) => (
                    <li key={l.name}>
                      <button
                        className={
                          (selected === l.name ? "linkish active" : "linkish") +
                          (hasBestiary(l.kind) ? "" : " dim")
                        }
                        disabled={!hasBestiary(l.kind)}
                        onClick={() => setSelected(l.name)}
                      >
                        {l.name} <span className="muted tag">{l.kind}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="card grow">
        {selected === null ? (
          <p className="muted pad">Click an explorable area or mission to see its monsters.</p>
        ) : (
          <>
            <h3>
              {selected} <span className="muted">({monsters.length} monsters)</span>
            </h3>
            {monsters.map(({ monster, isBossHere, skills, armor }) => (
              <div key={monster.wikiPage} className="monster">
                <div className="row space-between">
                  <strong>
                    {monster.name}
                    {isBossHere && <span className="elite"> [boss]</span>}
                  </strong>
                  <span className="muted">
                    {monster.species ?? "?"} · level {monster.levelRaw ?? monster.level ?? "?"}
                  </span>
                </div>
                {armor.table.length > 0 && (
                  <table className="armor">
                    <tbody>
                      <tr>
                        {armor.table.map((a) => (
                          <td key={a.damageType}>
                            <span className="muted small">{a.damageType}</span> {a.rating}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                )}
                <div className="skillbar">
                  {skills.length === 0 && <span className="muted small">no known skills</span>}
                  {skills.map(({ ref, skill }) => (
                    <button
                      key={ref}
                      className="chip"
                      disabled={skill === null}
                      title={skill === null ? "not a learnable player skill" : "open in skill browser"}
                      onClick={() => onSkillClick(ref)}
                    >
                      {ref}
                      {skill?.isElite && <span className="elite"> ★</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
