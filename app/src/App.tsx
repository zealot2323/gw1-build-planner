import { useState } from "react";
import type { Build, Profession } from "@gw1/engine";
import { useSave } from "./save";
import { CharactersView } from "./views/Characters";
import { SkillsView } from "./views/Skills";
import { BuildsView } from "./views/Builds";
import { ZonesView } from "./views/Zones";

type Tab = "characters" | "skills" | "builds" | "zones";

export function App() {
  const { save, addCharacter, updateCharacter, removeCharacter, importFile, exportFile } = useSave();
  const [tab, setTab] = useState<Tab>("characters");
  const [characterName, setCharacterName] = useState<string | null>(null);
  const [secondary, setSecondary] = useState<Profession | null>(null);
  const [activeBuild, setActiveBuild] = useState<string | null>(null);
  const [focusSkill, setFocusSkill] = useState<string | null>(null);

  const character = save.characters.find((c) => c.name === characterName) ?? null;

  const selectCharacter = (name: string | null) => {
    setCharacterName(name);
    setSecondary(null);
    setActiveBuild(null);
  };

  const updateBuilds = (builds: Build[]) =>
    character && updateCharacter(character.name, { builds });

  /** "+ build" in the skill browser: fill the active build's first empty slot. */
  const addToBuild =
    character && activeBuild
      ? (skill: string) => {
          const build = character.builds.find((b) => b.name === activeBuild);
          if (!build || build.skills.includes(skill)) return;
          const i = build.skills.indexOf(null);
          if (i === -1) return;
          const skills = [...build.skills] as Build["skills"];
          skills[i] = skill;
          updateBuilds(character.builds.map((b) => (b.name === build.name ? { ...b, skills } : b)));
        }
      : null;

  const goToSkill = (skill: string) => {
    setFocusSkill(skill);
    setTab("skills");
  };

  return (
    <>
      <header>
        <h1>GW1 Build Planner</h1>
        <nav>
          {(["characters", "skills", "builds", "zones"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <span className="muted">
          {character ? `${character.name} (${character.primaryProfession}/${secondary ?? "x"})` : "no character selected"}
        </span>
      </header>
      {tab === "characters" && (
        <CharactersView
          save={save}
          selected={character}
          onSelect={selectCharacter}
          addCharacter={addCharacter}
          updateCharacter={updateCharacter}
          removeCharacter={removeCharacter}
          importFile={importFile}
          exportFile={exportFile}
        />
      )}
      {tab === "skills" && (
        <SkillsView
          character={character}
          secondary={secondary}
          setSecondary={setSecondary}
          focusSkill={focusSkill}
          onAddToBuild={addToBuild}
        />
      )}
      {tab === "builds" && (
        <BuildsView
          character={character}
          secondary={secondary}
          activeBuild={activeBuild}
          setActiveBuild={setActiveBuild}
          updateBuilds={updateBuilds}
          goToSkills={() => setTab("skills")}
        />
      )}
      {tab === "zones" && <ZonesView onSkillClick={goToSkill} character={character} />}
    </>
  );
}
