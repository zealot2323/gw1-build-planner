import { useMemo, useState } from "react";
import {
  armorProfile,
  explorablesFrom,
  monstersInLocation,
  skillsAtLocation,
  zoneSummary,
  type MonsterDisplay,
} from "@gw1/engine";
import type { Skill } from "@gw1/engine";
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

/**
 * A row of skill icons with names. `onSelect` shows the skill inline here;
 * without it the chips jump to the skill browser instead.
 */
function SkillChips({
  refs,
  selected,
  onSelect,
  onSkillClick,
}: {
  refs: string[];
  selected?: string | null;
  onSelect?: (s: string | null) => void;
  onSkillClick?: (s: string) => void;
}) {
  return (
    <div className="skillbar">
      {refs.map((ref) => {
        const skill = index.skillByPage.get(ref);
        return (
          <button
            key={ref}
            className={selected === ref ? "skill-card open" : "skill-card"}
            onClick={() => (onSelect ? onSelect(selected === ref ? null : ref) : onSkillClick?.(ref))}
          >
            <SkillIcon page={ref} size={28} />
            <span className="skill-card-name">
              {ref}
              {skill?.isElite && <span className="elite"> ★</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Group a sorted skill list into profession blocks, keeping order. */
function byProfession(skills: Skill[]): Array<[string, Skill[]]> {
  const groups: Array<[string, Skill[]]> = [];
  for (const s of skills) {
    const key = s.profession ?? "Common";
    const last = groups[groups.length - 1];
    if (last && last[0] === key) last[1].push(s);
    else groups.push([key, [s]]);
  }
  return groups;
}

/** What you can pick up at an outpost: trainer stock and quest rewards. */
function OutpostSkills({
  location,
  unlocked,
  selectedSkill,
  setSelectedSkill,
}: {
  location: string;
  unlocked: boolean;
  selectedSkill: string | null;
  setSelectedSkill: (s: string | null) => void;
}) {
  const at = useMemo(() => skillsAtLocation(location, index), [location]);
  if (!at.trainer && at.quests.length === 0) {
    return <p className="muted pad">No skills are offered here.</p>;
  }

  const open = selectedSkill ? index.skillByPage.get(selectedSkill) : null;
  const details = open && (
    <div className="slide-down">
      <SkillDetails skill={open} />
    </div>
  );

  const section = (skills: Skill[]) =>
    byProfession(skills).map(([prof, list]) => (
      <div key={prof}>
        <div className="prof-group">
          <ProfessionIcon profession={prof === "Common" ? null : (prof as never)} />
          {prof} <span className="muted">({list.length})</span>
        </div>
        <SkillChips
          refs={list.map((s) => s.wikiPage)}
          selected={selectedSkill}
          onSelect={setSelectedSkill}
        />
        {open && list.some((s) => s.wikiPage === open.wikiPage) && details}
      </div>
    ));

  return (
    <>
      {at.trainer && (
        <div className="outpost-section">
          <h4>
            <a href={wikiHref(at.trainer.name)} target="_blank" rel="noreferrer">
              {at.trainer.name}
            </a>{" "}
            <span className="muted">— {at.trainer.skills.length} skills</span>{" "}
            <span className={unlocked ? "ok small" : "muted small"}>
              {unlocked ? "Available to buy now" : "Unlock this outpost to buy here"}
            </span>
          </h4>
          {section(at.trainer.skills)}
        </div>
      )}
      {at.quests.map(({ quest, skills }) => (
        <div key={quest} className="outpost-section">
          <h4>
            Quest:{" "}
            <a href={wikiHref(quest)} target="_blank" rel="noreferrer">
              {quest}
            </a>{" "}
            <span className={unlocked ? "ok small" : "muted small"}>
              {unlocked ? "Available to unlock now" : "Unlock this outpost to start it"}
            </span>
          </h4>
          {section(skills)}
        </div>
      ))}
    </>
  );
}

/** "What am I walking into?" — enemy groups and the tactics they bring. */
function ZoneBriefing({
  location,
  hardMode,
  onSkillClick,
}: {
  location: string;
  hardMode: boolean;
  onSkillClick: (skill: string) => void;
}) {
  const s = useMemo(() => zoneSummary(location, index, hardMode), [location, hardMode]);
  const [openTag, setOpenTag] = useState<string | null>(null);
  if (s.monsterCount === 0) return null;
  const open = [...s.threats, ...s.minorThreats].find((t) => t.tag === openTag);

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
                  <ProfessionIcon key={p} profession={p} size={15} />
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
              <button
                key={t.tag}
                className={openTag === t.tag ? "threat open" : "threat"}
                onClick={() => setOpenTag(openTag === t.tag ? null : t.tag)}
              >
                {t.tag} <span className="muted">×{t.skills}</span>
              </button>
            ))}
            {s.minorThreats.length > 0 && (
              <button
                className="threat minor"
                title={s.minorThreats.map((t) => `${t.tag} (${t.examples.join(", ")})`).join(" · ")}
                onClick={() => setOpenTag(openTag === "__minor" ? null : "__minor")}
              >
                +{s.minorThreats.length} one-off
              </button>
            )}
          </span>
        </div>
      )}
      {s.notes.length > 0 && (
        <div className="briefing-row">
          <span className="briefing-label">Tactics</span>
          <span className="threats">
            {s.notes.map((n) => (
              <span key={n.text} className={n.kind === "weakness" ? "note weak-vs" : "note strong-vs"}>
                {n.kind === "weakness" ? "▼" : "▲"} {n.text} <span className="muted">({n.detail})</span>
              </span>
            ))}
          </span>
        </div>
      )}
      {(open || openTag === "__minor") && (
        <div className="slide-down threat-detail">
          {openTag === "__minor" ? (
            <>
              <div className="muted small">
                Single-skill traits — probably not worth building around:
              </div>
              {s.minorThreats.map((t) => (
                <div key={t.tag}>
                  <div className="muted small">{t.tag}</div>
                  <SkillChips refs={t.examples} onSkillClick={onSkillClick} />
                </div>
              ))}
            </>
          ) : (
            <div>
              <div className="muted small">
                {open!.tag} — {open!.skills} skills
              </div>
              <SkillChips refs={open!.examples} onSkillClick={onSkillClick} />
            </div>
          )}
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
/** Everything the zone browser remembers, so a tab switch doesn't reset it. */
export interface ZoneViewState {
  selected: string | null;
  openRegions: Set<string> | null;
  expandedSkill: string | null;
  hardMode: boolean;
  outpostSkill: string | null;
  searing: "pre" | "post";
}

export const initialZoneState: ZoneViewState = {
  selected: null,
  openRegions: null,
  expandedSkill: null,
  hardMode: false,
  // Ascalon exists twice over; pre-Searing comes first in the story so it
  // leads here too.
  searing: "pre",
  outpostSkill: null,
};

export function ZonesView({
  onSkillClick,
  character,
  state,
  setState,
}: {
  onSkillClick: (skill: string) => void;
  character: CharacterSave | null;
  state: ZoneViewState;
  setState: (patch: Partial<ZoneViewState>) => void;
}) {
  const { selected, openRegions, expandedSkill, hardMode, outpostSkill, searing } = state;
  const setSelected = (v: string | null) => setState({ selected: v });
  const setOpenRegions = (v: Set<string> | null) => setState({ openRegions: v });
  const setExpandedSkill = (v: string | null) => setState({ expandedSkill: v });
  const setHardMode = (v: boolean) => setState({ hardMode: v });
  const setOutpostSkill = (v: string | null) => setState({ outpostSkill: v });
  const setSearing = (v: "pre" | "post") => setState({ searing: v });

  const unlocked = useMemo(
    () => new Set(character?.unlockedLocations ?? []),
    [character],
  );

  /** region -> outposts (with their explorables) + missions + orphan zones */
  const regions = useMemo(() => {
    const byRegion = new Map<
      string,
      {
        outposts: Array<{ name: string; kind: string; zones: Array<{ name: string; kind: string }> }>;
        other: Array<{ name: string; kind: string }>;
      }
    >();
    const bucket = (region: string) => {
      const key = region || "(unknown region)";
      if (!byRegion.has(key)) byRegion.set(key, { outposts: [], other: [] });
      return byRegion.get(key)!;
    };

    const inScope = (l: { preSearing?: boolean }) =>
      searing === "pre" ? l.preSearing === true : l.preSearing !== true;

    // a mission outpost's mission is one of the things you can enter from
    // it, so it belongs in the same child list — labelled as a mission
    const missionByOutpost = new Map<string, string>();
    for (const m of dataset.missions ?? []) {
      if (m.outpost) missionByOutpost.set(m.outpost, m.wikiPage);
    }

    const nested = new Set<string>();
    const nestedMissions = new Set<string>();
    for (const l of dataset.locations) {
      if (l.kind === "explorable" || !inScope(l)) continue;
      const zones: Array<{ name: string; kind: string }> = explorablesFrom(l.wikiPage, index)
        .filter((z) => inScope(index.locationByPage.get(z) ?? {}))
        .sort()
        .map((name) => ({ name, kind: "explorable" }));
      for (const z of zones) nested.add(z.name);
      const mission = missionByOutpost.get(l.wikiPage);
      if (mission && searing === "post") {
        zones.unshift({ name: mission, kind: "mission" });
        nestedMissions.add(mission);
      }
      bucket(l.region ?? "").outposts.push({ name: l.wikiPage, kind: l.kind, zones });
    }
    // explorables that hang off no outpost still need a home
    for (const l of dataset.locations) {
      if (l.kind !== "explorable" || nested.has(l.wikiPage) || !inScope(l)) continue;
      bucket(l.region ?? "").other.push({ name: l.wikiPage, kind: "explorable" });
    }
    // missions are all post-Searing; any not nested under an outpost above
    // still need a home in their region
    if (searing === "post") {
      for (const m of dataset.missions ?? []) {
        if (nestedMissions.has(m.wikiPage)) continue;
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
  const toggleRegion = (region: string) => {
    const next = new Set(openSet);
    if (next.has(region)) next.delete(region);
    else next.add(region);
    setOpenRegions(next);
  };

  const selectedKind = selected
    ? (index.locationByPage.get(selected)?.kind ?? "mission")
    : null;
  const isOutpost = selectedKind !== null && selectedKind !== "explorable" && selectedKind !== "mission";
  const monsters = selected && !isOutpost ? monstersInLocation(selected, index, hardMode) : [];
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
              onClick={() => setState({ searing: v, openRegions: null })}
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
                      <button
                        className={
                          "linkish outpost" +
                          (selected === o.name ? " active" : "") +
                          (unlocked.has(o.name) ? " unlocked" : "")
                        }
                        onClick={() => setState({ selected: o.name, expandedSkill: null, outpostSkill: null })}
                      >
                        {unlocked.has(o.name) && <span className="unlocked-dot">●</span>}
                        {o.name} <span className="muted tag">{o.kind}</span>
                      </button>
                      <WikiLink page={o.name} />
                    </div>
                    {o.zones.length > 0 && (
                      <ul className="plain-list indent">
                        {o.zones.map((z) => zoneButton(z.name, z.kind))}
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
                <span className="muted">
                  {isOutpost ? selectedKind : `${monsters.length} monsters`}
                </span>
              </h3>
              {!isOutpost && (
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
              )}
            </div>
            {isOutpost ? (
              <OutpostSkills
                location={selected}
                unlocked={unlocked.has(selected)}
                selectedSkill={outpostSkill}
                setSelectedSkill={setOutpostSkill}
              />
            ) : (
              <ZoneBriefing location={selected} hardMode={hardMode} onSkillClick={onSkillClick} />
            )}
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
