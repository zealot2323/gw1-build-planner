import { useMemo, useState } from "react";
import { monstersInLocation, type MonsterDisplay } from "@gw1/engine";
import { dataset, index } from "../data";
import { SkillIcon } from "../components/SkillIcon";
import { SkillDetails } from "../components/SkillDetails";
import { wikiHref } from "../wiki";

function WikiLink({ page }: { page: string }) {
  return (
    <a className="wiki-link" href={wikiHref(page)} target="_blank" rel="noreferrer" title="open on wiki.guildwars.com">
      ↗
    </a>
  );
}

/** Skill bar: the main event. Click a skill to expand its details below. */
function MonsterCard({
  entry,
  expandedSkill,
  onToggleSkill,
  onOpenInBrowser,
}: {
  entry: MonsterDisplay;
  expandedSkill: string | null;
  onToggleSkill: (key: string | null) => void;
  onOpenInBrowser: (skill: string) => void;
}) {
  const { monster, isBossHere, skills, armor, level, variants } = entry;
  const key = (ref: string) => `${monster.wikiPage}::${ref}`;
  const open = skills.find((s) => key(s.ref) === expandedSkill);

  return (
    <div className="monster">
      <div className="monster-head">
        <strong>
          <a href={wikiHref(monster.wikiPage)} target="_blank" rel="noreferrer">
            {monster.name}
          </a>
        </strong>
        {isBossHere && <span className="elite"> [boss]</span>}
        <span className="muted small statline">
          {monster.species ?? "?"} · lvl {level ?? "?"}
          {armor.table.length > 0 && (
            <>
              {" · armor "}
              {armor.table.map((a, i) => (
                <span key={a.damageType} title={a.damageType}>
                  {i > 0 && "/"}
                  {a.rating}
                </span>
              ))}
            </>
          )}
        </span>
      </div>

      {variants.length > 1 && (
        <div className="muted small">
          wiki lists {variants.length} loadouts here: {variants.map((v) => v.label).join(" / ")}
        </div>
      )}

      <div className="skillbar">
        {skills.length === 0 && <span className="muted small">no known skills</span>}
        {skills.map(({ ref, skill }) => (
          <button
            key={ref}
            className={key(ref) === expandedSkill ? "skill-card open" : "skill-card"}
            title={skill === null ? "not a learnable player skill" : "show details"}
            onClick={() => onToggleSkill(key(ref) === expandedSkill ? null : key(ref))}
          >
            <SkillIcon page={ref} size={34} />
            <span className="skill-card-name">
              {ref}
              {skill?.isElite && <span className="elite"> ★</span>}
            </span>
          </button>
        ))}
      </div>

      {open && (
        <div className="slide-down">
          {open.skill ? (
            <>
              <SkillDetails skill={open.skill} />
              <button className="small" onClick={() => onOpenInBrowser(open.ref)}>
                open in skill browser →
              </button>
            </>
          ) : (
            <div className="skill-details muted small">
              <a href={wikiHref(open.ref)} target="_blank" rel="noreferrer">
                {open.ref}
              </a>{" "}
              — a monster-only skill, not learnable by players.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Region -> locations tree; clicking an explorable/mission shows monsters. */
export function ZonesView({ onSkillClick }: { onSkillClick: (skill: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set(["Ascalon"]));
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

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
                    <li key={l.name} className="zone-row">
                      <button
                        className={
                          (selected === l.name ? "linkish active" : "linkish") +
                          (hasBestiary(l.kind) ? "" : " dim")
                        }
                        disabled={!hasBestiary(l.kind)}
                        onClick={() => {
                          setSelected(l.name);
                          setExpandedSkill(null);
                        }}
                      >
                        {l.name} <span className="muted tag">{l.kind}</span>
                      </button>
                      <WikiLink page={l.name} />
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
              {selected} <WikiLink page={selected} />{" "}
              <span className="muted">({monsters.length} monsters)</span>
            </h3>
            {monsters.map((entry) => (
              <MonsterCard
                key={entry.monster.wikiPage}
                entry={entry}
                expandedSkill={expandedSkill}
                onToggleSkill={setExpandedSkill}
                onOpenInBrowser={onSkillClick}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
