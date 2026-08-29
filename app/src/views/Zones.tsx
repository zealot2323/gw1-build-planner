import { useMemo, useState } from "react";
import {
  armorProfile,
  explorablesFrom,
  monstersInLocation,
  zoneSummary,
  type MonsterDisplay,
} from "@gw1/engine";
import { dataset, index } from "../data";
import { SkillIcon } from "../components/SkillIcon";
import { SkillDetails } from "../components/SkillDetails";
import { ProfessionIcon } from "../components/ProfessionIcon";
import { wikiHref } from "../wiki";
import type { CharacterSave } from "../save";

function WikiLink({ page }: { page: string }) {
  return (
    <a className="wiki-link" href={wikiHref(page)} target="_blank" rel="noreferrer" title="open on wiki.guildwars.com">
      ↗
    </a>
  );
}

/** Compact armor line: baseline plus only the deviations worth knowing. */
function ArmorLine({ table }: { table: MonsterDisplay["armor"]["table"] }) {
  const p = armorProfile(table);
  if (p.base === null) return null;
  return (
    <>
      {" · armor "}
      <b>{p.base}</b>
      {p.weakVs.length > 0 && <span className="weak-vs"> weak vs {p.weakVs.join("/")}</span>}
      {p.strongVs.length > 0 && <span className="strong-vs"> tough vs {p.strongVs.join("/")}</span>}
    </>
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
        <ProfessionIcon profession={monster.profession} />
        <span className="muted small statline">
          {monster.species ?? "?"} · lvl {level ?? "?"}
          <ArmorLine table={armor.table} />
        </span>
      </div>

      {variants.length > 1 && (
        <div className="muted small">
          wiki lists {variants.length} loadouts here:{" "}
          {variants.map((v) => v.label ?? "default").join(" / ")}
        </div>
      )}

      <div className="skillbar">
        {skills.length === 0 && <span className="muted small">no known skills</span>}
        {skills.map(({ ref, skill, hardModeOnly }) => (
          <button
            key={ref}
            className={key(ref) === expandedSkill ? "skill-card open" : "skill-card"}
            title={skill === null ? "not in the Prophecies skill set" : "show details"}
            onClick={() => onToggleSkill(key(ref) === expandedSkill ? null : key(ref))}
          >
            <SkillIcon page={ref} size={34} />
            <span className="skill-card-name">
              {ref}
              {skill?.isElite && <span className="elite"> ★</span>}
              {hardModeOnly && <span className="hm-tag" title="hard mode only">HM</span>}
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
              — not in the Prophecies skill set: a monster-only skill, or one from
              another campaign that this creature only uses in hard mode.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "What am I walking into?" — enemy groups and the tactics they bring. */
function ZoneBriefing({ location, hardMode }: { location: string; hardMode: boolean }) {
  const s = useMemo(() => zoneSummary(location, index, hardMode), [location, hardMode]);
  if (s.monsterCount === 0) return null;
  return (
    <div className="briefing">
      {s.levelRange && (
        <div className="briefing-row">
          <span className="briefing-label">Levels</span>
          <span>
            {s.levelRange.min === s.levelRange.max
              ? s.levelRange.min
              : `${s.levelRange.min}–${s.levelRange.max}`}
          </span>
        </div>
      )}
      {s.groups.length > 0 && (
        <div className="briefing-row">
          <span className="briefing-label">Groups</span>
          <span>
            {s.groups.slice(0, 6).map((g, i) => (
              <span key={g.species}>
                {i > 0 && ", "}
                {g.species} <span className="muted">×{g.count}</span>
                {g.professions.map((p) => (
                  <ProfessionIcon key={p} profession={p} size={13} />
                ))}
              </span>
            ))}
          </span>
        </div>
      )}
      {s.threats.length > 0 && (
        <div className="briefing-row">
          <span className="briefing-label">Expect</span>
          <span className="threats">
            {s.threats.map((t) => (
              <span key={t.tag} className="threat" title={t.examples.join(", ")}>
                {t.tag} <span className="muted">×{t.skills}</span>
              </span>
            ))}
          </span>
        </div>
      )}
      {(s.exploitDamage.length > 0 || s.resistedDamage.length > 0) && (
        <div className="briefing-row">
          <span className="briefing-label">Damage</span>
          <span>
            {s.exploitDamage.length > 0 && (
              <span className="weak-vs">exploit {s.exploitDamage.join("/")}</span>
            )}
            {s.exploitDamage.length > 0 && s.resistedDamage.length > 0 && " · "}
            {s.resistedDamage.length > 0 && (
              <span className="strong-vs">avoid {s.resistedDamage.join("/")}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Zone tree: region -> outposts/towns -> the explorables you can walk to from
 * each. Unlocked outposts are highlighted; a zone reachable from several
 * outposts appears under each of them, as it does in game.
 */
export function ZonesView({
  onSkillClick,
  character,
}: {
  onSkillClick: (skill: string) => void;
  character: CharacterSave | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [openRegions, setOpenRegions] = useState<Set<string> | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [hardMode, setHardMode] = useState(false);
  // Ascalon exists twice over; pre-Searing comes first in the story so it
  // leads here too.
  const [searing, setSearing] = useState<"pre" | "post">("pre");

  const unlocked = useMemo(
    () => new Set(character?.unlockedLocations ?? []),
    [character],
  );

  /** region -> outposts (with their explorables) + missions + orphan zones */
  const regions = useMemo(() => {
    const byRegion = new Map<
      string,
      { outposts: Array<{ name: string; kind: string; zones: string[] }>; other: Array<{ name: string; kind: string }> }
    >();
    const bucket = (region: string) => {
      const key = region || "(unknown region)";
      if (!byRegion.has(key)) byRegion.set(key, { outposts: [], other: [] });
      return byRegion.get(key)!;
    };

    const inScope = (l: { preSearing?: boolean }) =>
      searing === "pre" ? l.preSearing === true : l.preSearing !== true;

    const nested = new Set<string>();
    for (const l of dataset.locations) {
      if (l.kind === "explorable" || !inScope(l)) continue;
      const zones = explorablesFrom(l.wikiPage, index)
        .filter((z) => inScope(index.locationByPage.get(z) ?? {}))
        .sort();
      for (const z of zones) nested.add(z);
      bucket(l.region ?? "").outposts.push({ name: l.wikiPage, kind: l.kind, zones });
    }
    // explorables that hang off no outpost still need a home
    for (const l of dataset.locations) {
      if (l.kind !== "explorable" || nested.has(l.wikiPage) || !inScope(l)) continue;
      bucket(l.region ?? "").other.push({ name: l.wikiPage, kind: "explorable" });
    }
    // missions are all post-Searing
    if (searing === "post") {
      for (const m of dataset.missions ?? []) {
        bucket(m.region ?? "").other.push({ name: m.wikiPage, kind: "mission" });
      }
    }
    for (const v of byRegion.values()) {
      v.outposts.sort((a, b) => a.name.localeCompare(b.name));
      v.other.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...byRegion.entries()]
      .filter(([, v]) => v.outposts.length + v.other.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [searing]);

  // null means "not touched yet" — open the first region so the tree is
  // never a wall of collapsed headers after switching Searing state
  const openSet = openRegions ?? new Set(regions.length > 0 ? [regions[0][0]] : []);
  const toggleRegion = (region: string) =>
    setOpenRegions(() => {
      const next = new Set(openSet);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });

  const monsters = selected ? monstersInLocation(selected, index, hardMode) : [];
  const hasBestiary = (kind: string) => kind === "explorable" || kind === "mission";

  const zoneButton = (name: string, kind: string) => (
    <li key={name} className="zone-row">
      <button
        className={
          (selected === name ? "linkish active" : "linkish") +
          (hasBestiary(kind) ? "" : " dim") +
          (unlocked.has(name) ? " unlocked" : "")
        }
        disabled={!hasBestiary(kind)}
        onClick={() => {
          setSelected(name);
          setExpandedSkill(null);
        }}
        title={unlocked.has(name) ? "unlocked by this character" : undefined}
      >
        {unlocked.has(name) && <span className="unlocked-dot">●</span>}
        {name} <span className="muted tag">{kind}</span>
      </button>
      <WikiLink page={name} />
    </li>
  );

  return (
    <div className="view row align-top">
      <div className="card zone-tree">
        <h3>
          Prophecies{" "}
          {character && <span className="muted small">— {unlocked.size} unlocked</span>}
        </h3>
        <div className="searing-toggle">
          {(["pre", "post"] as const).map((v) => (
            <button
              key={v}
              className={searing === v ? "seg active" : "seg"}
              onClick={() => {
                setSearing(v);
                setOpenRegions(null); // fall back to "first region open"
              }}
            >
              {v}-Searing
            </button>
          ))}
        </div>
        {regions.map(([region, { outposts, other }]) => (
          <div key={region}>
            <button
              className="linkish region"
              onClick={() => toggleRegion(region)}
            >
              {openSet.has(region) ? "▾" : "▸"} {region}
            </button>
            {openSet.has(region) && (
              <ul className="plain-list indent">
                {outposts.map((o) => (
                  <li key={o.name}>
                    <div className="zone-row">
                      <span className={unlocked.has(o.name) ? "outpost unlocked" : "outpost"}>
                        {unlocked.has(o.name) && <span className="unlocked-dot">●</span>}
                        {o.name} <span className="muted tag">{o.kind}</span>
                      </span>
                      <WikiLink page={o.name} />
                    </div>
                    {o.zones.length > 0 && (
                      <ul className="plain-list indent">
                        {o.zones.map((z) => zoneButton(z, "explorable"))}
                      </ul>
                    )}
                  </li>
                ))}
                {other.map((l) => zoneButton(l.name, l.kind))}
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
            <div className="row space-between">
              <h3>
                {selected} <WikiLink page={selected} />{" "}
                <span className="muted">({monsters.length} monsters)</span>
              </h3>
              <label className="inline-check mode-toggle">
                <input
                  type="checkbox"
                  checked={hardMode}
                  onChange={(e) => {
                    setHardMode(e.target.checked);
                    setExpandedSkill(null);
                  }}
                />
                hard mode
              </label>
            </div>
            <ZoneBriefing location={selected} hardMode={hardMode} />
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
