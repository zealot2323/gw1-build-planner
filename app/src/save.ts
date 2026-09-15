/**
 * Save format + persistence. The exported JSON file is the REAL save format;
 * localStorage and the cloud row both hold that same object.
 *
 * Signed out (or accounts not configured): saves live in this browser's
 * localStorage, exactly as before.
 *
 * Signed in: the account's row in Supabase is the source of truth.
 * - On sign-in the cloud save is loaded. If the account has none yet, the
 *   characters already in this browser are uploaded — first sign-in adopts
 *   what you had.
 * - Nothing is written to the cloud until that load has finished, or a
 *   fresh browser would overwrite a real save with an empty one.
 * - Edits are written back shortly after they stop (debounced).
 * - Last write wins: two open devices editing at once will overwrite each
 *   other. Fine for one person; merging is deliberately out of scope.
 */
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Build, Character } from "@gw1/engine";
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
      if (data && isSaveFile(data.data)) {
        lastSynced.current = JSON.stringify(data.data);
        setSave(data.data);
        hydratedFor.current = userId;
        setStatus("saved");
      } else {
        // First sign-in on this account: adopt this browser's characters.
        const local = loadLocal();
        const { error: writeError } = await supabase!
          .from("saves")
          .upsert({ user_id: userId, data: local, updated_at: new Date().toISOString() });
        if (cancelled) return;
        if (writeError) {
          setStatus("error");
          setError(`Couldn't create your cloud save: ${writeError.message}`);
          return;
        }
        lastSynced.current = JSON.stringify(local);
        setSave(local);
        hydratedFor.current = userId;
        setStatus("saved");
      }
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
      signIn,
      signOut,
    },
  };
}
