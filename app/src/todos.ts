/**
 * Adding to-do entries from anywhere in the app.
 *
 * The to-do list is the one place several views write to, so the dedupe and
 * id rules live here rather than in each view.
 */
import type { TodoItem, TodoKind } from "@gw1/engine";

export const newTodoId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Is this already on the list and still open? */
export const hasOpenTodo = (todos: TodoItem[], kind: TodoKind, ref: string): boolean =>
  todos.some((t) => t.kind === kind && t.ref === ref && !t.done);

/**
 * Add entries, skipping any that are already on the list and not done.
 * Returns the new list plus how many were actually added, so callers can
 * say "added 3 of 5" instead of silently doing nothing.
 */
export function addTodos(
  todos: TodoItem[],
  entries: Array<{ kind: TodoKind; ref: string }>,
): { todos: TodoItem[]; added: number; skipped: number } {
  const out = [...todos];
  let added = 0;
  let skipped = 0;
  for (const { kind, ref } of entries) {
    if (hasOpenTodo(out, kind, ref)) {
      skipped++;
      continue;
    }
    out.push({ id: newTodoId(), kind, ref, done: false, added: new Date().toISOString().slice(0, 10) });
    added++;
  }
  return { todos: out, added, skipped };
}
