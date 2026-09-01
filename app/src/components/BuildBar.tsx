import { useMemo, useState } from "react";
import {
  buildTodo,
  travelDistances,
  validateBuild,
  PROFESSIONS,
  type Build,
  type Profession,
  type SkillAvailabilityEntry,
} from "@gw1/engine";
import { index } from "../data";
import { SkillIcon } from "./SkillIcon";
import { SkillDetails } from "./SkillDetails";
import { ProfessionIcon } from "./ProfessionIcon";
import { ProximityDot } from "./ProximityDot";
import type { CharacterSave } from "../save";

export const DRAFT = "__draft__";

/**
 * The 8-slot build bar, pinned above the skill browser. Starts as an unsaved
 * draft so you can throw skills at it immediately and name it later.
 * Clicking a slot opens that skill's details; the × removes it.
 */
export function BuildBar({
  character,
  draft,
  setDraft,
  activeBuild,
  setActiveBuild,
  updateBuilds,
  availability,
}: {
  character: CharacterSave;
  draft: Build;
  setDraft: (b: Build) => void;
  activeBuild: string | null;
  setActiveBuild: (name: string | null) => void;
  updateBuilds: (builds: Build[]) => void;
  availability: SkillAvailabilityEntry[];
}) {
  const [saveName, setSaveName] = useState("");
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [showTodo, setShowTodo] = useState(true);
  const [openRoute, setOpenRoute] = useState<string | null>(null);

  const builds = character.builds;
  const isDraft = activeBuild === null;
  const build = isDraft ? draft : (builds.find((b) => b.name === activeBuild) ?? draft);
  const errors = validateBuild(build, index);

  const todo = useMemo(() => {
    const graph = travelDistances(character, index);
    return buildTodo(build.skills, availability, graph);
  }, [character, build.skills, availability]);

  const patch = (p: Partial<Build>) => {
    const next = { ...build, ...p };
    if (isDraft) setDraft(next);
    else updateBuilds(builds.map((b) => (b.name === build.name ? next : b)));
  };

  const save = () => {
    const name = saveName.trim();
    if (!name || builds.some((b) => b.name === name)) return;
    updateBuilds([...builds, { ...build, name }]);
    setActiveBuild(name);
    setSaveName("");
  };

  const clearSlot = (i: number) => {
    const skills = [...build.skills] as Build["skills"];
    skills[i] = null;
    patch({ skills });
    if (openSlot === i) setOpenSlot(null);
  };

  // slots called out by validation get a red border
  const badSlots = new Set(errors.map((e) => e.slot).filter((i): i is number => i !== undefined));

  const openSkill =
    openSlot !== null && build.skills[openSlot]
      ? index.skillByPage.get(build.skills[openSlot]!)
      : null;

  return (
    <div className="card build-bar">
      <div className="row wrap space-between">
        <div className="row wrap">
          <span className="field-label no-margin">Build</span>
          <select
            value={activeBuild ?? DRAFT}
            onChange={(e) => {
              setActiveBuild(e.target.value === DRAFT ? null : e.target.value);
              setOpenSlot(null);
            }}
          >
            <option value={DRAFT}>Unsaved draft</option>
            {builds.map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
          </select>

          <span className="field-label no-margin">Secondary</span>
          <select
            value={build.secondary ?? ""}
            onChange={(e) => patch({ secondary: (e.target.value || null) as Profession | null })}
            title="skills from this profession become legal in the build"
          >
            <option value="">none</option>
            {PROFESSIONS.filter((p) => p !== build.primary).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <ProfessionIcon profession={build.primary} />
          <span className="muted">/</span>
          {build.secondary ? <ProfessionIcon profession={build.secondary} /> : <span className="muted">—</span>}
        </div>

        <div className="row">
          {errors.length > 0 && (
            <span className="error small">
              {errors.length} thing{errors.length > 1 ? "s" : ""} to fix
            </span>
          )}
          {isDraft ? (
            <>
              <input
                className="narrow"
                placeholder="name to save…"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <button onClick={save} disabled={saveName.trim() === ""}>
                Save
              </button>
            </>
          ) : (
            <button
              className="danger small"
              onClick={() => {
                updateBuilds(builds.filter((b) => b.name !== build.name));
                setActiveBuild(null);
              }}
            >
              delete
            </button>
          )}
        </div>
      </div>

      <div className="slots">
        {build.skills.map((skill, i) => (
          <div
            key={i}
            className={`slot${skill ? " filled" : ""}${badSlots.has(i) ? " invalid" : ""}`}
            title={badSlots.has(i) ? errors.find((e) => e.slot === i)?.message : undefined}
          >
            {skill ? (
              <>
                <button
                  className="slot-open"
                  title="show skill details"
                  onClick={() => setOpenSlot(openSlot === i ? null : i)}
                >
                  <SkillIcon page={skill} size={32} />
                  <span className="slot-name">
                    {skill}
                    {index.skillByPage.get(skill)?.isElite && <span className="elite"> ★</span>}
                  </span>
                </button>
                <button className="slot-remove" title="remove from build" onClick={() => clearSlot(i)}>
                  ×
                </button>
              </>
            ) : (
              <span className="muted slot-empty">empty</span>
            )}
          </div>
        ))}
      </div>

      {openSkill && (
        <div className="slide-down">
          <SkillDetails skill={openSkill} />
        </div>
      )}

      {errors.length > 0 && (
        <ul className="problems">
          {errors.map((e, i) => (
            <li key={i}>
              <span className="problem-mark">!</span>
              <span>
                {e.message}
                {e.fix && <span className="muted"> {e.fix}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {todo.length > 0 && (
        <div className="todo">
          <button className="linkish todo-head" onClick={() => setShowTodo(!showTodo)}>
            {showTodo ? "▾" : "▸"} To field this build you still need {todo.length} skill
            {todo.length > 1 ? "s" : ""}
          </button>
          {showTodo && (
            <ol className="todo-list">
              {todo.map(({ skill, plan }) => (
                <li key={skill}>
                  <ProximityDot proximity={plan.proximity} distance={plan.distance} />
                  <SkillIcon page={skill} size={20} />
                  <strong>{skill}</strong>
                  {plan.best ? (
                    <span className="muted">
                      {" — "}
                      {plan.best.kind === "trainer" && `buy from ${plan.best.via}`}
                      {plan.best.kind === "quest" && `quest ${plan.best.via}`}
                      {plan.best.kind === "capture" && `capture from ${plan.best.via}`}
                      {plan.best.location && ` in ${plan.best.location}`}
                      {plan.route.length > 0 && (
                        <>
                          {" · "}
                          <button
                            className="linkish inline"
                            onClick={() => setOpenRoute(openRoute === skill ? null : skill)}
                          >
                            {plan.distance} zone{plan.distance === 1 ? "" : "s"} away
                            {openRoute === skill ? " ▾" : " ▸"}
                          </button>
                        </>
                      )}
                      {plan.distance === 0 && " · you can go now"}
                    </span>
                  ) : (
                    <span className="muted"> — no reachable source</span>
                  )}
                  {openRoute === skill && plan.route.length > 0 && (
                    <ol className="route">
                      {plan.route.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
