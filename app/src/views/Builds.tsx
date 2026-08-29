import { useState } from "react";
import { validateBuild, type Build, type Profession } from "@gw1/engine";
import { index } from "../data";
import { SkillIcon } from "../components/SkillIcon";
import type { CharacterSave } from "../save";

export function BuildsView({
  character,
  secondary,
  activeBuild,
  setActiveBuild,
  updateBuilds,
  goToSkills,
}: {
  character: CharacterSave | null;
  secondary: Profession | null;
  activeBuild: string | null;
  setActiveBuild: (name: string | null) => void;
  updateBuilds: (builds: Build[]) => void;
  goToSkills: () => void;
}) {
  const [newName, setNewName] = useState("");

  if (!character) return <div className="view muted pad">Select a character first.</div>;

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

  const patch = (p: Partial<Build>) =>
    build && updateBuilds(builds.map((b) => (b.name === build.name ? { ...b, ...p } : b)));

  const clearSlot = (i: number) => {
    if (!build) return;
    const skills = [...build.skills] as Build["skills"];
    skills[i] = null;
    patch({ skills });
  };

  return (
    <div className="view">
      <div className="row wrap align-top">
        <div className="card">
          <h3>Builds for {character.name}</h3>
          <ul className="plain-list">
            {builds.map((b) => (
              <li key={b.name}>
                <button
                  className={b.name === activeBuild ? "linkish active" : "linkish"}
                  onClick={() => setActiveBuild(b.name)}
                >
                  {b.name} <span className="muted">({b.primary}/{b.secondary ?? "x"})</span>
                </button>
              </li>
            ))}
            {builds.length === 0 && <li className="muted">none yet</li>}
          </ul>
          <div className="row">
            <input
              placeholder="new build name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <button onClick={create}>Create</button>
          </div>
          <p className="muted small">New builds use the secondary chosen in the skill browser.</p>
        </div>

        {build && (
          <div className="card grow">
            <div className="row space-between">
              <h3>
                {build.name} <span className="muted">— {build.primary}/{build.secondary ?? "x"}</span>
              </h3>
              <button
                className="danger"
                onClick={() => {
                  updateBuilds(builds.filter((b) => b.name !== build.name));
                  setActiveBuild(null);
                }}
              >
                Delete build
              </button>
            </div>
            <div className="slots">
              {build.skills.map((skill, i) => (
                <button
                  key={i}
                  className={skill ? "slot filled" : "slot"}
                  title={skill ? "click to clear" : "add skills from the skill browser"}
                  onClick={() => (skill ? clearSlot(i) : goToSkills())}
                >
                  {skill ? (
                    <>
                      <SkillIcon page={skill} size={32} />
                      <span>
                        {skill}
                        {index.skillByPage.get(skill)?.isElite && <span className="elite"> ★</span>}
                      </span>
                    </>
                  ) : (
                    <span className="muted">empty</span>
                  )}
                </button>
              ))}
            </div>
            {errors.length > 0 ? (
              <ul className="errors">
                {errors.map((e, i) => (
                  <li key={i}>
                    <strong>{e.code}</strong>: {e.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ok">✓ build is valid</p>
            )}
            <p className="muted small">
              Click an empty slot to jump to the skill browser; "+ build" there fills the first
              empty slot. Click a filled slot to clear it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
