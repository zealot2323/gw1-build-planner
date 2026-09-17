import { useEffect, useRef } from "react";
import { routeStops, type LocationRef, type TodoItem, type TodoKind } from "@gw1/engine";
import { useData } from "../DataContext";
import { hasOpenTodo } from "../todos";
import type { CharacterSave } from "../save";

/** The skill waiting to go on the list, and the route to its nearest source. */
export interface PendingSkillTodo {
  skill: string;
  skillName: string;
  route: LocationRef[];
}

/**
 * Asks whether the places needed to reach a skill should go on the list
 * too. Only worth showing when there are any: callers add the skill
 * straight away when the route is empty or already unlocked.
 */
export function SkillTodoPrompt({
  pending,
  character,
  todos,
  addToTodo,
  onClose,
}: {
  pending: PendingSkillTodo | null;
  character: CharacterSave;
  todos: TodoItem[];
  addToTodo: (entries: Array<{ kind: TodoKind; ref: string }>) => { added: number; skipped: number };
  onClose: () => void;
}) {
  const index = useData();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  if (!pending) return null;

  const stops = routeStops(pending.route, index, character.unlockedLocations).filter(
    (s) => !hasOpenTodo(todos, s.kind, s.ref),
  );

  const add = (withStops: boolean) => {
    addToTodo([{ kind: "skill", ref: pending.skill }, ...(withStops ? stops : [])]);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-todo-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="skill-todo-title" className="no-margin">
          Add {pending.skillName} to the to-do list
        </h3>
        <p className="small">
          Reaching it means unlocking {stops.length} more place{stops.length === 1 ? "" : "s"}. Add
          {stops.length === 1 ? " it" : " them"} as well?
        </p>
        <ul className="modal-list small">
          {stops.map((s) => (
            <li key={`${s.kind}-${s.ref}`}>
              {s.ref}
              {/* many pages are already called "... (outpost)" — don't say it twice */}
              {!s.ref.toLowerCase().includes(`(${s.kind})`) && <span className="muted"> ({s.kind})</span>}
            </li>
          ))}
        </ul>
        <div className="row modal-actions">
          <button ref={confirmRef} onClick={() => add(true)}>
            Add the skill and {stops.length} place{stops.length === 1 ? "" : "s"}
          </button>
          <button onClick={() => add(false)}>Add the skill only</button>
          <button className="linkish" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
