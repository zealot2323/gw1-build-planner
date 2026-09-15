/**
 * Save format + persistence. The exported JSON file is the REAL save format;
 * localStorage and the cloud row both hold that same object.
 *
 * Signed out (or accounts not configured): saves live in this browser's
 * localStorage, exactly as before.
 *
 * Signed out = guest: characters live only in this browser's localStorage.
 *
 * Signed in: the account's row in Supabase is the source of truth.
 * - On sign-in the cloud save is loaded and any guest characters in this
 *   browser are merged in (mergeGuestCharacters — never drops one; a name
 *   clash with a different character keeps both as "Name (guest)"). Once
 *   the account has them, the browser's guest copy is cleared, so they
 *   aren't merged again and don't linger on a shared computer.
 * - Nothing is written to the cloud until that load has finished, or a
 *   fresh browser would overwrite a real save with an empty one.
 * - Edits are written back shortly after they stop (debounced).
 * - Last write wins: two open devices editing at once will overwrite each
 *   other. Fine for one person; merging is deliberately out of scope.
 */
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { mergeGuestCharacters, type Build, type Character } from "@gw1/engine";
import { supabase } from "./supabase";

export interface CharacterSave extends Character {
  builds: Build[];
}

export interface SaveFile {
  version: 1;
  characters: CharacterSave[];
}

/** Where saves are going right now, for the account bar. */
export type SyncStatus = "local" | "loading" | "saving" | "saved" | "error";

const STORAGE_KEY = "gw1-build-planner-save";
const EMPTY: SaveFile = { version: 1, characters: [] };
const CLOUD_DEBOUNCE_MS = 800;

function isSaveFile(value: unknown): value is SaveFile {
  const v = value as SaveFile | null;
  return v?.version === 1 && Array.isArray(v.characters);
}

function loadLocal(): SaveFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return isSaveFile(parsed) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function useSave() {
  const [save, setSave] = useState<SaveFile>(loadLocal);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SyncStatus>("local");
  const [error, setError] = useState<string | null>(null);
  /** One-off message after guest characters join the account. */
  const [notice, setNotice] = useState<string | null>(null);

  const userId = session?.user.id ?? null;
  /** The user whose cloud save has been loaded; writes wait for this. */
  const hydratedFor = useRef<string | null>(null);
  /** Last JSON written to / read from the cloud, to skip no-op writes. */
  const lastSynced = useRef<string>("");

  // --- auth session ---------------------------------------------------------
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // --- sign-in: load the cloud save (or adopt this browser's) ----------------
  useEffect(() => {
    if (!supabase) return;
    if (userId === null) {
      // signed out: back to this browser's own save
      hydratedFor.current = null;
      lastSynced.current = "";
      setSave(loadLocal());
      setStatus("local");
      return;
    }
    if (hydratedFor.current === userId) return;

    let cancelled = false;
    setStatus("loading");
    setError(null);
    (async () => {
      const { data, error: readError } = await supabase!
        .from("saves")
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (readError) {
        // Do NOT mark hydrated: writing now could clobber a save we failed to read.
        setStatus("error");
        setError(`Couldn't load your cloud save: ${readError.message}`);
        return;
      }
      // Merge this browser's guest characters into whatever the account has.
      const cloud: SaveFile = data && isSaveFile(data.data) ? data.data : EMPTY;
      const guest = loadLocal();
      const merge = mergeGuestCharacters(cloud.characters, guest.characters);
      const merged: SaveFile = { version: 1, characters: merge.characters };
      const joined = merge.added.length + merge.renamed.length;

      if (!data || joined > 0) {
        const { error: writeError } = await supabase!
          .from("saves")
          .upsert({ user_id: userId, data: merged, updated_at: new Date().toISOString() });
        if (cancelled) return;
        if (writeError) {
          // Keep the guest copy — the account doesn't have these characters yet.
          setStatus("error");
          setError(`Couldn't add this browser's characters to your account: ${writeError.message}`);
          return;
        }
      }
      // The account now holds every guest character; drop the browser copy.
      if (guest.characters.length > 0) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // storage unavailable — nothing to clear
        }
      }
      if (joined > 0) {
        const parts = [`Added ${joined} character${joined === 1 ? "" : "s"} from this browser to your account`];
        if (merge.renamed.length > 0) {
          parts.push(
            `renamed to avoid clashing with ones you already had: ${merge.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}`,
          );
        }
        setNotice(parts.join("; ") + ".");
      }
      lastSynced.current = JSON.stringify(merged);
      setSave(merged);
      hydratedFor.current = userId;
      setStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // --- persist ---------------------------------------------------------------
  useEffect(() => {
    if (userId === null) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
      } catch {
        // storage unavailable — export/import still works
      }
      return;
    }
    if (!supabase || hydratedFor.current !== userId) return; // not loaded yet
    const json = JSON.stringify(save);
    if (json === lastSynced.current) return;

    setStatus("saving");
    const timer = setTimeout(async () => {
      const { error: writeError } = await supabase!
        .from("saves")
        .upsert({ user_id: userId, data: save, updated_at: new Date().toISOString() });
      if (writeError) {
        setStatus("error");
        setError(`Couldn't save to your account: ${writeError.message}`);
      } else {
        lastSynced.current = json;
        setStatus("saved");
        setError(null);
      }
    }, CLOUD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [save, userId]);

  // --- account actions ---------------------------------------------------------
  const signIn = async (email: string): Promise<string | null> => {
    if (!supabase) return "Accounts aren't configured for this site.";
    const { error: e } = await supabase.auth.signInWithOtp({
      email,
      // come back to this same page (GitHub Pages serves it under a subpath)
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    return e ? e.message : null;
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
  };

  // --- character edits (unchanged API) ----------------------------------------
  const updateCharacter = (name: string, patch: Partial<CharacterSave>) =>
    setSave((s) => ({
      ...s,
      characters: s.characters.map((c) => (c.name === name ? { ...c, ...patch } : c)),
    }));

  const addCharacter = (c: CharacterSave) =>
    setSave((s) => ({ ...s, characters: [...s.characters, c] }));

  const removeCharacter = (name: string) =>
    setSave((s) => ({ ...s, characters: s.characters.filter((c) => c.name !== name) }));

  const importFile = async (file: File) => {
    const parsed = JSON.parse(await file.text());
    if (!isSaveFile(parsed)) {
      throw new Error("not a gw1-build-planner save file (expected {version: 1, characters: []})");
    }
    setSave(parsed);
  };

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gw1-characters.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return {
    save,
    addCharacter,
    updateCharacter,
    removeCharacter,
    importFile,
    exportFile,
    account: {
      enabled: supabase !== null,
      email: session?.user.email ?? null,
      status,
      error,
      notice,
      dismissNotice: () => setNotice(null),
      /** Characters that exist only in this browser (guest mode). */
      guestCharacters: userId === null ? save.characters.length : 0,
      signIn,
      signOut,
    },
  };
}
