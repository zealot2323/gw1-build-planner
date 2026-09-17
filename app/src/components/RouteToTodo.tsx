import { useState } from "react";
import { routeStops, type LocationRef, type TodoItem, type TodoKind } from "@gw1/engine";
import { useData } from "../DataContext";
import { hasOpenTodo } from "../todos";
import type { CharacterSave } from "../save";

/**
 * "Add the places you have to unlock on the way" — the outposts and
 * missions along a skill's (or build's) route, minus the explorable areas
 * you merely walk through and anything already unlocked.
 */
export function RouteToTodo({
  label,
  route,
  character,
  todos,
  addToTodo,
  verb = "Add the outposts on the way to the to-do list",
}: {
  label: string;
  route: LocationRef[];
  character: CharacterSave;
  todos: TodoItem[];
  addToTodo: (entries: Array<{ kind: TodoKind; ref: string }>) => { added: number; skipped: number };
  verb?: string;
}) {
  const index = useData();
  const [result, setResult] = useState<string | null>(null);

  const stops = routeStops(route, index, character.unlockedLocations);
  const outstanding = stops.filter((s) => !hasOpenTodo(todos, s.kind, s.ref));
  if (stops.length === 0) return null;

  const add = () => {
    const { added, skipped } = addToTodo(stops);
    setResult(
      added === 0
        ? "Already on the to-do list."
        : `Added ${added} place${added === 1 ? "" : "s"} to the to-do list${skipped > 0 ? ` (${skipped} already there)` : ""}.`,
    );
  };

  return (
    <p className="small no-margin route-todo">
      <button className="small" onClick={add} disabled={outstanding.length === 0} title={verb}>
        + {stops.length} place{stops.length === 1 ? "" : "s"} on the way to to-do
      </button>{" "}
      <span className="muted">
        {stops.map((s) => s.ref).join(" → ")}
        {result && <span className="ok"> · {result}</span>}
      </span>
      <span className="visually-hidden">for {label}</span>
    </p>
  );
}
