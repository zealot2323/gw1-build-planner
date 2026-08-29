import { useState } from "react";
import { validateBuild, type Build, type Profession } from "@gw1/engine";
import { index } from "../data";
import { SkillIcon } from "./SkillIcon";
import { SkillDetails } from "./SkillDetails";
import { ProfessionIcon } from "./ProfessionIcon";
import type { CharacterSave } from "../save";

/**
 * The 8-slot build bar, pinned above the skill browser. Clicking a slot
 * opens that skill's details; the × removes it.
 */
export function BuildBar({
  character,
  secondary,
  activeBuild,
  setActiveBuild,
  updateBuilds,
}: {
  character: CharacterSave;
  secondary: Profession | null;
  activeBuild: string | null;
  setActiveBuild: (name: string | null) => void;
  updateBuilds: (builds: Build[]) => void;
}) {
  const [newName, setNewName] = useState("");
  const [openSlot, setOpenSlot] = useState<number | null>(null);

  const builds = character.builds;
  const build = builds.find((b) => b.name === activeBuild) ?? null;
  const errors = build ? validateBuild(build, index) : [];

  const create = () => {
    const name = newName.trim();
    if (!name || builds.some((b) => b.name === name)) return;
    updateBuilds([
      ...builds,
      {
        name,
        character: character.name,
        primary: character.primaryProfession,
        secondary,
        skills: [null, null, null, null, null, null, null, null],
      },
    ]);
    setNewName("");
    setActiveBuild(name);
  };

  const setSkills = (skills: Build["skills"]) =>
    build && updateBuilds(builds.map((b) => (b.name === build.name ? { ...b, skills } : b)));

  const clearSlot = (i: number) => {
    if (!build) return;
    const skills = [...build.skills] as Build["skills"];
    skills[i] = null;
    setSkills(skills);
    if (openSlot === i) setOpenSlot(null);
  };

  const openSkill =
    build && openSlot !== null && build.skills[openSlot]
      ? index.skillByPage.get(build.skills[openSlot]!)
      : null;

  return (
    <div className="card build-bar">
      <div className="row wrap space-between">
        <div className="row wrap">
          <span className="field-label no-margin">Build</span>
          <select
            value={activeBuild ?? ""}
            onChange={(e) => {
              setActiveBuild(e.target.value || null);
              setOpenSlot(null);
            }}
          >
            <option value="">— none —</option>
            {builds.map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
          </select>
          {build && (
            <span className="muted small">
              <ProfessionIcon profession={build.primary} />/
              {build.secondary ? <ProfessionIcon profession={build.secondary} /> : "x"}
            </span>
          )}
          <input
            className="narrow"
            placeholder="new build…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button onClick={create}>Create</button>
        </div>
        {build && (
          <div className="row">
            {errors.length === 0 ? (
              <span className="ok small">✓ valid</span>
            ) : (
              <span className="error small">{errors.length} problem{errors.length > 1 ? "s" : ""}</span>
            )}
            <button
              className="danger small"
              onClick={() => {
                updateBuilds(builds.filter((b) => b.name !== build.name));
                setActiveBuild(null);
              }}
            >
              delete
            </button>
          </div>
        )}
      </div>

      {build ? (
        <>
          <div className="slots">
            {build.skills.map((skill, i) => (
              <div key={i} className={skill ? "slot filled" : "slot"}>
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
            <ul className="errors small">
              {errors.map((e, i) => (
                <li key={i}>
                  <strong>{e.code}</strong>: {e.message}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted small no-margin">
          Pick or create a build, then use “+ build” on any skill below to fill a slot.
        </p>
      )}
    </div>
  );
}
