import { useMemo, useState } from "react";
import {
  skillAvailability,
  travelDistances,
  type TodoItem,
  type TodoKind,
} from "@gw1/engine";
import { useData } from "../DataContext";
import { SkillIcon } from "../components/SkillIcon";
import { ProximityDot } from "../components/ProximityDot";
import { wikiHref } from "../wiki";
import type { CharacterSave } from "../save";

export interface TodoViewState {
  kind: TodoKind;
  draft: string;
  showDone: boolean;
}

export const initialTodoViewState: TodoViewState = { kind: "skill", draft: "", showDone: false };

const KIND_LABEL: Record<TodoKind, string> = {
  skill: "Skill",
  build: "Build",
  outpost: "Outpost",
  mission: "Mission",
  note: "Note",
};
const KIND_ORDER: TodoKind[] = ["skill", "build", "outpost", "mission", "note"];

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function TodoView({
  character,
  updateCharacter,
  view,
  setView,
}: {
  character: CharacterSave | null;
  updateCharacter: (name: string, patch: Partial<CharacterSave>) => void;
  view: TodoViewState;
  setView: (patch: Partial<TodoViewState>) => void;
}) {
  const index = useData();
  const [error, setError] = useState<string | null>(null);

  const availability = useMemo(
    () => (character ? new Map(skillAvailability(character, null, index).map((e) => [e.skill.wikiPage, e])) : new Map()),
    [character, index],
  );
  const graph = useMemo(() => (character ? travelDistances(character, index) : null), [character, index]);

  if (!character) return <div className="view muted pad">Select a character first.</div>;
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
      setError(`"${ref}" isn't a ${KIND_LABEL[view.kind].toLowerCase()} we know. Pick one from the list, or add it as a note.`);
      return;
    }
    if (todos.some((t) => t.kind === view.kind && t.ref === ref && !t.done)) {
      setError("That's already on the list.");
      return;
    }
    setError(null);
    setTodos([...todos, { id: newId(), kind: view.kind, ref, done: false, added: new Date().toISOString().slice(0, 10) }]);
    setView({ draft: "" });
  };

  const toggle = (id: string) =>
    setTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTodos(todos.filter((t) => t.id !== id));

  /** Live context for an entry: do you have it yet, and how far is it? */
  const context = (item: TodoItem) => {
    if (item.kind === "skill") {
      const entry = availability.get(item.ref);
      if (character.knownSkills.includes(item.ref)) return <span className="ok">already known</span>;
      if (!entry) return <span className="muted">not available to this character</span>;
      return (
        <span className="muted">
          {entry.status === "FUTURE" ? "not yet reachable" : entry.status.replace(/_/g, " ").toLowerCase()}
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
        <span className="muted">not done</span>
      );
    }
    if (item.kind === "build") {
      const build = character.builds.find((b) => b.name === item.ref);
      if (!build) return <span className="muted">build deleted</span>;
      const have = build.skills.filter((s) => s && character.knownSkills.includes(s)).length;
      const filled = build.skills.filter(Boolean).length;
      return (
        <span className={have === filled && filled > 0 ? "ok" : "muted"}>
          {have}/{filled} skills known
        </span>
      );
    }
    return null;
  };

  const visible = todos.filter((t) => view.showDone || !t.done);
  const open = todos.filter((t) => !t.done).length;

  return (
    <div className="view">
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
              view.kind === "note" ? "anything you want to remember…" : `search ${KIND_LABEL[view.kind].toLowerCase()}s…`
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
            show done
          </label>
        </div>
        {error && <div className="error small">{error}</div>}
      </div>

      {visible.length === 0 && (
        <div className="card muted">
          Nothing on the list. Add skills you're hunting, builds you want to finish, outposts or missions to
          reach — or just a note.
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
                  <button className="linkish todo-remove" onClick={() => remove(item.id)} title="remove">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
