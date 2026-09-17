import { useState } from "react";
import { Profession, type Build } from "@gw1/engine";
import { useSave } from "./save";
import { DataProvider } from "./DataContext";
import { AccountBar } from "./components/AccountBar";
import { CharactersView } from "./views/Characters";
import { SkillsView, initialSkillViewState, type SkillViewState } from "./views/Skills";
import { ZonesView, initialZoneState, type ZoneViewState } from "./views/Zones";
import { QuestsView, initialQuestViewState, type QuestViewState } from "./views/Quests";
import { BuildsView, initialBuildsViewState, type BuildsViewState } from "./views/Builds";
import { TodoView, initialTodoViewState, type TodoViewState } from "./views/Todo";

type Tab = "characters" | "skills" | "builds" | "quests" | "zones" | "to-do";

export function App() {
  const { save, addCharacter, updateCharacter, removeCharacter, importFile, exportFile, account } = useSave();
  const [tab, setTab] = useState<Tab>("characters");
  const [characterName, setCharacterName] = useState<string | null>(null);
  // The working build is a draft until it's given a name and saved.
  const emptyDraft = (primary: Profession): Build => ({
    name: "Unsaved draft",
    character: characterName ?? "",
    primary,
    secondary: null,
    skills: [null, null, null, null, null, null, null, null],
  });
  const [draft, setDraft] = useState<Build>(() => emptyDraft(Profession.Warrior));
  const [activeBuild, setActiveBuild] = useState<string | null>(null);
  const [focusSkill, setFocusSkill] = useState<string | null>(null);
  // View state lives here so switching tabs doesn't throw away what you had
  // open — the zone you were reading, the skill you had expanded.
  const [zoneState, setZoneState] = useState<ZoneViewState>(initialZoneState);
  const patchZoneState = (patch: Partial<ZoneViewState>) =>
    setZoneState((s) => ({ ...s, ...patch }));
  const [skillView, setSkillView] = useState<SkillViewState>(initialSkillViewState);
  const [questView, setQuestView] = useState<QuestViewState>(initialQuestViewState);
  const [buildsView, setBuildsView] = useState<BuildsViewState>(initialBuildsViewState);
  const patchBuildsView = (patch: Partial<BuildsViewState>) => setBuildsView((s) => ({ ...s, ...patch }));
  const [todoView, setTodoView] = useState<TodoViewState>(initialTodoViewState);
  const patchTodoView = (patch: Partial<TodoViewState>) => setTodoView((s) => ({ ...s, ...patch }));
  const patchQuestView = (patch: Partial<QuestViewState>) =>
    setQuestView((s) => ({ ...s, ...patch }));
  const patchSkillView = (patch: Partial<SkillViewState>) =>
    setSkillView((s) => ({ ...s, ...patch }));

  const character = save.characters.find((c) => c.name === characterName) ?? null;

  const selectCharacter = (name: string | null) => {
    setCharacterName(name);
    setActiveBuild(null);
    const c = save.characters.find((x) => x.name === name);
    if (c) setDraft(emptyDraft(c.primaryProfession));
  };

  const updateBuilds = (builds: Build[]) =>
    character && updateCharacter(character.name, { builds });

  /** "+ build" in the skill browser: fill the active build's first empty slot. */
  const addToBuild = character
    ? (skill: string) => {
        const target = activeBuild
          ? (character.builds.find((b) => b.name === activeBuild) ?? draft)
          : draft;
        if (target.skills.includes(skill)) return;
        const i = target.skills.indexOf(null);
        if (i === -1) return;
        const skills = [...target.skills] as Build["skills"];
        skills[i] = skill;
        if (activeBuild) {
          updateBuilds(character.builds.map((b) => (b.name === target.name ? { ...b, skills } : b)));
        } else {
          setDraft({ ...draft, skills });
        }
      }
    : null;

  const goToSkill = (skill: string) => {
    setFocusSkill(skill);
    patchSkillView({ openSkill: skill });
    setTab("skills");
  };

  return (
    <DataProvider character={character}>
      <header>
        <h1>GW1 Build Planner</h1>
        <nav>
          {(["characters", "skills", "builds", "quests", "zones", "to-do"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <span className="muted">
          {character
            ? `${character.name} (${character.primaryProfession}${
                (activeBuild ? character.builds.find((b) => b.name === activeBuild)?.secondary : draft.secondary)
                  ? "/" +
                    (activeBuild
                      ? character.builds.find((b) => b.name === activeBuild)!.secondary
                      : draft.secondary)
                  : ""
              })`
            : "No character selected"}
        </span>
        <AccountBar account={account} />
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
          focusSkill={focusSkill}
          onAddToBuild={addToBuild}
          activeBuild={activeBuild}
          setActiveBuild={setActiveBuild}
          updateBuilds={updateBuilds}
          draft={draft}
          setDraft={setDraft}
          view={skillView}
          setView={patchSkillView}
        />
      )}
      {tab === "builds" && (
        <BuildsView
          character={character}
          updateBuilds={updateBuilds}
          onLoadBuild={(name) => {
            setActiveBuild(name);
            setTab("skills");
          }}
          view={buildsView}
          setView={patchBuildsView}
        />
      )}
      {tab === "to-do" && (
        <TodoView
          character={character}
          updateCharacter={updateCharacter}
          view={todoView}
          setView={patchTodoView}
        />
      )}
      {tab === "quests" && (
        <QuestsView character={character} view={questView} setView={patchQuestView} />
      )}
      {tab === "zones" && (
        <ZonesView
          onSkillClick={goToSkill}
          character={character}
          state={zoneState}
          setState={patchZoneState}
        />
      )}
      <footer className="credits muted small">
        Fan-made tool, not affiliated with ArenaNet. Skill, location and quest data from the{" "}
        <a href="https://wiki.guildwars.com/" target="_blank" rel="noreferrer">
          Guild Wars Wiki
        </a>{" "}
        (GNU FDL). Guild Wars artwork and skill icons © ArenaNet, LLC. Template codes via{" "}
        <a href="https://github.com/build-wars/gw-templates" target="_blank" rel="noreferrer">
          @buildwars/gw-templates
        </a>
        ; skill card and code handling after{" "}
        <a href="https://github.com/gw1tools/gw1builds" target="_blank" rel="noreferrer">
          gw1builds
        </a>{" "}
        (both MIT).
      </footer>
    </DataProvider>
  );
}
