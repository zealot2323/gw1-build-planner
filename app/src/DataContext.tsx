import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Character, DataIndex } from "@gw1/engine";
import { index as fullIndex, indexForCharacter } from "./data";

/**
 * The dataset every view queries, narrowed to the selected character's
 * owned campaigns. Kept in context so views don't each have to thread it
 * through — and so nothing can accidentally reach past the scope.
 */
const DataCtx = createContext<DataIndex>(fullIndex);

export function DataProvider({
  character,
  children,
}: {
  character: Character | null;
  children: ReactNode;
}) {
  // re-index only when the character's campaign scope actually changes
  const key = character ? (character.ownedCampaigns ?? [character.campaign]).join("|") : "";
  const scoped = useMemo(() => indexForCharacter(character), [key]);
  return <DataCtx.Provider value={scoped}>{children}</DataCtx.Provider>;
}

/** The campaign-scoped data index for the current character. */
export const useData = (): DataIndex => useContext(DataCtx);
