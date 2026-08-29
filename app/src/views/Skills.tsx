import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  skillAvailability,
  type AcquisitionSource,
  type Profession,
  type SkillAvailabilityEntry,
  type SkillStatus,
} from "@gw1/engine";
import { index } from "../data";
import { SkillIcon } from "../components/SkillIcon";
import { wikiHref } from "../wiki";
import type { CharacterSave } from "../save";

const STATUS_ORDER: SkillStatus[] = [
  "KNOWN", "PURCHASABLE_NOW", "QUESTABLE_NOW", "CAPTURABLE_NOW", "FUTURE",
];
const STATUS_LABEL: Record<SkillStatus, string> = {
  KNOWN: "Known",
  PURCHASABLE_NOW: "Purchasable now",
  QUESTABLE_NOW: "Questable now",
  CAPTURABLE_NOW: "Capturable now",
  FUTURE: "Future",
};

/**
 * Location first — "where do I go" is the question being answered. Both the
 * place and the trainer/quest/boss link out to the wiki.
 */
function SourceLine({ src }: { src: AcquisitionSource }) {
  const action = { trainer: "buy from", quest: "quest:", capture: "capture" }[src.kind];
  return (
    <>
      {src.location && (
        <>
          <a href={wikiHref(src.location)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {src.location}
          </a>
          {" · "}
        </>
      )}
      {action}{" "}
      <a href={wikiHref(src.via)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {src.via}
      </a>
    </>
  );
}

export function SkillsView({
  character,
  secondary,
  setSecondary,
  focusSkill,
  onAddToBuild,
}: {
  character: CharacterSave | null;
  secondary: Profession | null;
  setSecondary: (p: Profession | null) => void;
  /** Skill to scroll to (set by the zone browser's skill links). */
  focusSkill: string | null;
  onAddToBuild: ((skill: string) => void) | null;
}) {
  const [profFilter, setProfFilter] = useState<string>("all");
  const [attrFilter, setAttrFilter] = useState<string>("all");
  const [elitesOnly, setElitesOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  const entries = useMemo(
    () => (character ? skillAvailability(character, secondary, index) : []),
    [character, secondary],
  );

  const attributes = useMemo(
    () => [...new Set(entries.map((e) => e.skill.attribute).filter((a): a is string => a !== null))].sort(),
    [entries],
  );

  const filtered = entries.filter(
    (e) =>
      (profFilter === "all" || (e.skill.profession ?? "Common") === profFilter) &&
      (attrFilter === "all" || e.skill.attribute === attrFilter) &&
      (!elitesOnly || e.skill.isElite) &&
      e.skill.name.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" });
  }, [focusSkill]);

  const toggleExpanded = (page: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });

  if (!character) return <div className="view muted pad">Select a character first.</div>;

  return (
    <div className="view">
      <div className="row wrap toolbar">
        <label>
          Secondary:{" "}
          <select
            value={secondary ?? ""}
            onChange={(e) => setSecondary((e.target.value || null) as Profession | null)}
          >
            <option value="">none</option>
            {character.unlockedSecondaries.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Profession:{" "}
          <select value={profFilter} onChange={(e) => setProfFilter(e.target.value)}>
            <option value="all">all</option>
            <option>{character.primaryProfession}</option>
            {secondary && <option>{secondary}</option>}
            <option value="Common">Common</option>
          </select>
        </label>
        <label>
          Attribute:{" "}
          <select value={attrFilter} onChange={(e) => setAttrFilter(e.target.value)}>
            <option value="all">all</option>
            {attributes.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={elitesOnly} onChange={(e) => setElitesOnly(e.target.checked)} />
          elites only
        </label>
        <input type="search" placeholder="search skills…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {STATUS_ORDER.map((status) => {
        const group = filtered.filter((e) => e.status === status);
        if (group.length === 0) return null;
        return (
          <div className="card" key={status}>
            <h3>
              {STATUS_LABEL[status]} <span className="muted">({group.length})</span>
            </h3>
            <table>
              <tbody>
                {group.map((e) => (
                  <Fragment key={e.skill.wikiPage}>
                    <tr
                      ref={e.skill.wikiPage === focusSkill ? focusRef : undefined}
                      className={e.skill.wikiPage === focusSkill ? "focused" : undefined}
                    >
                      <td className="skill-name">
                        <SkillIcon page={e.skill.wikiPage} />
                        <a href={wikiHref(e.skill.wikiPage)} target="_blank" rel="noreferrer">
                          {e.skill.name}
                        </a>
                        {e.skill.isElite && <span className="elite"> ★</span>}
                      </td>
                      <td className="muted">
                        {e.skill.profession ?? "Common"}
                        {e.skill.attribute ? ` · ${e.skill.attribute}` : ""}
                      </td>
                      <td className="muted small">
                        {e.sources.length === 0 ? (
                          "no known Prophecies source"
                        ) : (
                          <>
                            <SourceLine src={e.sources[0]} />
                            {e.sources.length > 1 && (
                              <>
                                {" "}
                                <button
                                  className="linkish inline more"
                                  onClick={() => toggleExpanded(e.skill.wikiPage)}
                                >
                                  {expanded.has(e.skill.wikiPage) ? "— hide" : `— +${e.sources.length - 1} more`}
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </td>
                      {onAddToBuild && (
                        <td>
                          <button className="small" onClick={() => onAddToBuild(e.skill.wikiPage)}>
                            + build
                          </button>
                        </td>
                      )}
                    </tr>
                    {expanded.has(e.skill.wikiPage) && e.sources.length > 1 && (
                      <tr className="sources-row">
                        <td colSpan={onAddToBuild ? 4 : 3}>
                          <ul className="sources">
                            {e.sources.map((s, i) => (
                              <li key={i} className={s.availableNow ? "ok" : "muted"}>
                                {s.availableNow ? "● " : "○ "}
                                <SourceLine src={s} />
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
