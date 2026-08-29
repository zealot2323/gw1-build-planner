/**
 * Save format + persistence. The exported JSON file is the REAL save format;
 * localStorage is only a convenience mirror of the same object.
 */
import { useEffect, useState } from "react";
import type { Build, Character } from "@gw1/engine";

export interface CharacterSave extends Character {
  builds: Build[];
}

export interface SaveFile {
  version: 1;
  characters: CharacterSave[];
}

const STORAGE_KEY = "gw1-build-planner-save";
const EMPTY: SaveFile = { version: 1, characters: [] };

function load(): SaveFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 && Array.isArray(parsed.characters) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function useSave() {
  const [save, setSave] = useState<SaveFile>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    } catch {
      // storage unavailable — export/import still works
    }
  }, [save]);

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
    if (parsed?.version !== 1 || !Array.isArray(parsed.characters)) {
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

  return { save, addCharacter, updateCharacter, removeCharacter, importFile, exportFile };
}
