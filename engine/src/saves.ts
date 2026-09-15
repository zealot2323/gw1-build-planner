/**
 * Merging a guest's characters into an account's save.
 *
 * Someone can build characters without signing in; they live only in that
 * browser. When they later sign in, those characters must join the
 * account — including an account that already has characters from another
 * device. Nothing is ever dropped: losing work is worse than a duplicate
 * you can delete.
 */
import type { Build, Character } from "./types.js";

export interface SavedCharacter extends Character {
  builds: Build[];
}

export interface GuestMergeResult<T extends SavedCharacter> {
  characters: T[];
  /** Guest characters added under their own name. */
  added: string[];
  /** Guest characters whose name was taken by a DIFFERENT account character. */
  renamed: Array<{ from: string; to: string }>;
  /** Guest characters already in the account exactly as-is. */
  alreadyThere: string[];
}

/** JSON with object keys sorted, so key order can't make equal saves differ. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/**
 * Add a guest's characters to an account's, account characters first.
 *
 * - A name the account doesn't have: added as-is.
 * - A name the account has, identical contents: already there, skipped.
 * - A name the account has, different contents: added as "Name (guest)"
 *   ("(guest 2)", ...). Character names are the save's key, so both can't
 *   keep the name — and neither version is safe to discard.
 */
export function mergeGuestCharacters<T extends SavedCharacter>(account: T[], guest: T[]): GuestMergeResult<T> {
  const characters = [...account];
  const taken = new Set(account.map((c) => c.name));
  const byName = new Map(account.map((c) => [c.name, c]));
  const result: GuestMergeResult<T> = { characters, added: [], renamed: [], alreadyThere: [] };

  for (const c of guest) {
    const existing = byName.get(c.name);
    if (existing === undefined) {
      characters.push(c);
      taken.add(c.name);
      result.added.push(c.name);
      continue;
    }
    if (canonical(existing) === canonical(c)) {
      result.alreadyThere.push(c.name);
      continue;
    }
    let to = `${c.name} (guest)`;
    for (let n = 2; taken.has(to); n++) to = `${c.name} (guest ${n})`;
    taken.add(to);
    // builds record their owner's name; keep them pointing at the renamed copy
    characters.push({ ...c, name: to, builds: c.builds.map((b) => ({ ...b, character: to })) });
    result.renamed.push({ from: c.name, to });
  }
  return result;
}
