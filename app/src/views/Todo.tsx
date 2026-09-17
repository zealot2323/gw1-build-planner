import { useMemo, useState } from "react";
import {
  buildReadiness,
  planForSkill,
  routeStops,
  skillAvailability,
  travelDistances,
  type TodoItem,
  type TodoKind,
} from "@gw1/engine";
import { useData } from "../DataContext";
import { SkillIcon } from "../components/SkillIcon";
import { ProximityDot } from "../components/ProximityDot";
import { wikiHref } from "../wiki";
import { SkillDetails } from "../components/SkillDetails";
import { RouteToTodo } from "../components/RouteToTodo";
import { hasOpenTodo } from "../todos";
import { SkillTodoPrompt, type PendingSkillTodo } from "../components/SkillTodoPrompt";
import type { CharacterSave } from "../save";

export interface TodoViewState {
  kind: TodoKind;
  draft: string;
  showDone: boolean;
  /** id of the build entry whose skills are expanded. */
  openBuild: string | null;
  /** "<build>|<skill>" of the expanded skill inside a build entry. */
  openBuildSkill: string | null;
}

export const initialTodoViewState: TodoViewState = {
  kind: "skill",
  draft: "",
  showDone: false,
  openBuild: null,
  openBuildSkill: null,
};

const KIND_LABEL: Record<TodoKind, string> = {
  skill: "Skill",
  build: "Build",
  outpost: "Outpost",
  mission: "Mission",
  note: "Note",
};
const KIND_ORDER: TodoKind[] = ["skill", "build", "outpost", "mission", "note"];

/** How a build's missing skill reads in the expanded view. */
const STATUS_WORD: Record<string, string> = {
  KNOWN: "already known",
  PURCHASABLE_NOW: "can buy now",
  QUESTABLE_NOW: "quest reward, available now",
  CAPTURABLE_NOW: "can capture now",
  FUTURE: "not available yet",
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function TodoView({
  character,
  updateCharacter,
  addToTodo,
  view,
  setView,
}: {
  character: CharacterSave | null;
  updateCharacter: (name: string, patch: Partial<CharacterSave>) => void;
  addToTodo: (entries: Array<{ kind: TodoKind; ref: string }>) => { added: number; skipped: number };
  view: TodoViewState;
  setView: (patch: Partial<TodoViewState>) => void;
}) {
  const index = useData();
  const [error, setError] = useState<string | null>(null);
  const [pendingTodo, setPendingTodo] = useState<PendingSkillTodo | null>(null);

  const availability = useMemo(
    () => (character ? new Map(skillAvailability(character, null, index).map((e) => [e.skill.wikiPage, e])) : new Map()),
    [character, index],
  );
  const graph = useMemo(() => (character ? travelDistances(character, index) : null), [character, index]);

  if (!character) return <div className="view muted pad">Select a character on the Characters tab.</div>;
  const todos = character.todos ?? [];

  /** Options to autocomplete against, per kind. Notes are free text. */
  const optionsFor = (kind: TodoKind): string[] => {
    switch (kind) {
      case "skill":
        return index.dataset.skills.map((s) => s.wikiPage);
      case "build":
        return character.builds.map((b) => b.name);
      case "outpost":
        return index.dataset.locations.filter((l) => l.kind !== "explorable").map((l) => l.wikiPage);
      case "mission":
        return (index.dataset.missions ?? []).map((m) => m.wikiPage);
      case "note":
        return [];
    }
  };

  const setTodos = (next: TodoItem[]) => updateCharacter(character.name, { todos: next });

  const add = () => {
    const ref = view.draft.trim();
    if (!ref) return;
    // Anything but a note should name something real, or it can't be linked
    // or tracked — but say so rather than silently refusing.
    if (view.kind !== "note" && !optionsFor(view.kind).includes(ref)) {
      setError(
        `"${ref}" is not a ${KIND_LABEL[view.kind].toLowerCase()} in this planner's data. Choose one from the list, or add it as a note instead.`,
      );
      return;
    }
    if (todos.some((t) => t.kind === view.kind && t.ref === ref && !t.done)) {
      setError("That is already on the list.");
      return;
    }
    setError(null);
    if (view.kind === "skill") {
      // same question the skill browser asks: bring the places along?
      const entry = availability.get(ref);
      const route = entry && graph ? planForSkill(entry, graph).route : [];
      const outstanding = routeStops(route, index, character.unlockedLocations).filter(
        (s) => !hasOpenTodo(todos, s.kind, s.ref),
      );
      if (outstanding.length > 0) {
        setPendingTodo({ skill: ref, skillName: index.skillByPage.get(ref)?.name ?? ref, route });
        setView({ draft: "" });
        return;
      }
    }
    setTodos([...todos, { id: newId(), kind: view.kind, ref, done: false, added: new Date().toISOString().slice(0, 10) }]);
    setView({ draft: "" });
  };

  /** Ask about the route, then add — or just add when there's nothing to ask. */
  const askThenAddSkill = (ref: string, name: string, route: string[]) => {
    const outstanding = routeStops(route, index, character.unlockedLocations).filter(
      (s) => !hasOpenTodo(todos, s.kind, s.ref),
    );
    if (outstanding.length === 0) {
      addToTodo([{ kind: "skill", ref }]);
      return;
    }
    setPendingTodo({ skill: ref, skillName: name, route });
  };

  const toggle = (id: string) =>
    setTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTodos(todos.filter((t) => t.id !== id));

  /** Live context for an entry: do you have it yet, and how far is it? */
  const context = (item: TodoItem) => {
    if (item.kind === "skill") {
      const entry = availability.get(item.ref);
      if (character.knownSkills.includes(item.ref)) return <span className="ok">already known</span>;
      if (!entry) return <span className="muted">not usable by this character</span>;
      return (
        <span className="muted">
          {entry.status === "FUTURE" ? "not available yet" : entry.status.replace(/_NOW$/, "").replace(/_/g, " ").toLowerCase() + " now"}
          {entry.sources[0]?.location ? ` · ${entry.sources[0].location}` : ""}
        </span>
      );
    }
    if (item.kind === "outpost") {
      if (character.unlockedLocations.includes(item.ref)) return <span className="ok">unlocked</span>;
      const d = graph?.distance.get(item.ref) ?? null;
      return (
        <span className="muted">
          <ProximityDot proximity={d === null ? "unknown" : d === 0 ? "now" : d <= 2 ? "near" : d <= 5 ? "mid" : "far"} distance={d} />
          {d === null ? "no known route" : d === 0 ? "reachable now" : `${d} zones away`}
        </span>
      );
    }
    if (item.kind === "mission") {
      return character.completedMissions.includes(item.ref) ? (
        <span className="ok">completed</span>
      ) : (
        <span className="muted">not completed</span>
      );
    }
    if (item.kind === "build") {
      const build = character.builds.find((b) => b.name === item.ref);
      if (!build) return <span className="muted">this build no longer exists</span>;
      const have = build.skills.filter((s) => s && character.knownSkills.includes(s)).length;
      const filled = build.skills.filter(Boolean).length;
      return (
        <span className={have === filled && filled > 0 ? "ok" : "muted"}>
          {have} of {filled} skills known
        </span>
      );
    }
    return null;
  };

  const visible = todos.filter((t) => view.showDone || !t.done);
  const open = todos.filter((t) => !t.done).length;

  return (
    <div className="view">
      <SkillTodoPrompt
        pending={pendingTodo}
        character={character}
        todos={todos}
        addToTodo={addToTodo}
        onClose={() => setPendingTodo(null)}
      />
      <div className="card">
        <h3>
          To-do for {character.name} <span className="muted">({open} open)</span>
        </h3>
        <div className="row wrap">
          <select value={view.kind} onChange={(e) => setView({ kind: e.target.value as TodoKind, draft: "" })}>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            className="todo-input"
            list={view.kind === "note" ? undefined : `todo-options-${view.kind}`}
            placeholder={
              view.kind === "note" ? "Anything you want to remember…" : `Search ${KIND_LABEL[view.kind].toLowerCase()}s…`
            }
            value={view.draft}
            onChange={(e) => setView({ draft: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {view.kind !== "note" && (
            <datalist id={`todo-options-${view.kind}`}>
              {optionsFor(view.kind).slice(0, 2000).map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
          <button onClick={add}>Add</button>
          <label className="inline-check">
            <input type="checkbox" checked={view.showDone} onChange={(e) => setView({ showDone: e.target.checked })} />
            Show completed
          </label>
        </div>
        {error && <div className="error small">{error}</div>}
      </div>

      {visible.length === 0 && (
        <div className="card muted">
          Nothing on the list yet. Add skills to acquire, builds to complete, outposts or missions to reach, or a
          free-text note.
        </div>
      )}

      {KIND_ORDER.map((kind) => {
        const group = visible.filter((t) => t.kind === kind);
        if (group.length === 0) return null;
        return (
          <div className="card" key={kind}>
            <h3>
              {KIND_LABEL[kind]}s <span className="muted">({group.length})</span>
            </h3>
            <ul className="todo-list">
              {group.map((item) => (
                <li key={item.id} className={item.done ? "done" : ""}>
                  <label className="todo-main">
                    <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
                    {item.kind === "skill" && <SkillIcon page={item.ref} size={20} />}
                    {item.kind === "note" || item.kind === "build" ? (
                      <span className="todo-ref">{item.ref}</span>
                    ) : (
                      <a
                        className="todo-ref"
                        href={wikiHref(item.ref)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.ref}
                      </a>
                    )}
                    <span className="todo-context small">{context(item)}</span>
                  </label>
                  {item.kind === "build" && character.builds.some((b) => b.name === item.ref) && (
                    <button
                      className="small"
                      onClick={() => setView({ openBuild: view.openBuild === item.id ? null : item.id, openBuildSkill: null })}
                      title="Show this build's skills and where to get them"
                    >
                      {view.openBuild === item.id ? "Hide skills" : "Show skills"}
                    </button>
                  )}
                  <button className="linkish todo-remove" onClick={() => remove(item.id)} title="Remove from list">
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {group.map((item) =>
              item.kind === "build" && view.openBuild === item.id ? (
                <BuildTodoDetail
                  key={`detail-${item.id}`}
                  buildName={item.ref}
                  character={character}
                  todos={todos}
                  addToTodo={addToTodo}
                  onAddSkill={askThenAddSkill}
                  openSkill={view.openBuildSkill}
                  setOpenSkill={(v) => setView({ openBuildSkill: v })}
                />
              ) : null,
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A build on the to-do list, opened up: every skill with where it comes
 * from, the same way the skill browser reports it, plus a shortcut to queue
 * the outposts needed to reach the ones still missing.
 */
function BuildTodoDetail({
  buildName,
  character,
  todos,
  addToTodo,
  onAddSkill,
  openSkill,
  setOpenSkill,
}: {
  buildName: string;
  character: CharacterSave;
  todos: TodoItem[];
  addToTodo: (entries: Array<{ kind: TodoKind; ref: string }>) => { added: number; skipped: number };
  onAddSkill: (ref: string, name: string, route: string[]) => void;
  openSkill: string | null;
  setOpenSkill: (v: string | null) => void;
}) {
  const index = useData();
  const graph = useMemo(() => travelDistances(character, index), [character, index]);
  const build = character.builds.find((b) => b.name === buildName);
  if (!build) return null;
  const readiness = buildReadiness(build, character, index, graph);

  // every place still needed for the missing skills, in one go
  const wholeRoute = readiness.missing.flatMap((slot) => slot.plan?.route ?? []);

  return (
    <div className="build-todo">
      {readiness.slots.map((slot, i) =>
        slot.ref === null ? null : (
          <div key={`${slot.ref}-${i}`}>
            <button
              className={`todo-skill-row${slot.known ? " known" : ""}`}
              onClick={() => setOpenSkill(openSkill === slot.ref ? null : slot.ref)}
            >
              <SkillIcon page={slot.ref} size={22} />
              <span className="todo-skill-name">
                {slot.skill?.name ?? slot.ref}
                {slot.skill?.isElite && <span className="elite"> ★</span>}
              </span>
              {slot.known ? (
                <span className="ok small">already known</span>
              ) : (
                <span className="muted small">
                  {slot.entry ? STATUS_WORD[slot.entry.status] ?? "" : "not usable by this character"}
                  {slot.entry?.sources[0]?.location ? ` · ${slot.entry.sources[0].location}` : ""}
                </span>
              )}
              {!slot.known && (
                <ProximityDot
                  proximity={slot.plan?.proximity ?? "unknown"}
                  distance={slot.plan?.distance ?? null}
                />
              )}
            </button>
            {openSkill === slot.ref && slot.skill && (
              <div className="slide-down">
                <SkillDetails skill={slot.skill} plan={slot.known ? undefined : slot.plan} />
                {!slot.known && !hasOpenTodo(todos, "skill", slot.ref) && (
                  <button
                    className="small"
                    onClick={() => onAddSkill(slot.ref!, slot.skill?.name ?? slot.ref!, slot.plan?.route ?? [])}
                    title="Add this skill to the to-do list"
                  >
                    + add this skill to the to-do list
                  </button>
                )}
              </div>
            )}
          </div>
        ),
      )}
      {wholeRoute.length > 0 && (
        <RouteToTodo
          label={buildName}
          route={wholeRoute}
          character={character}
          todos={todos}
          addToTodo={addToTodo}
          verb="Add every outpost and mission needed for this build's missing skills"
        />
      )}
    </div>
  );
}
