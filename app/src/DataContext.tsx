import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_ALLEGIANCE, type Allegiance, type Character, type DataIndex } from "@gw1/engine";
import { index as fullIndex, indexForCharacter } from "./data";

/**
 * The dataset every view queries, narrowed to the selected character's
 * owned campaigns. Kept in context so views don't each have to thread it
 * through — and so nothing can accidentally reach past the scope.
 */
const DataCtx = createContext<DataIndex>(fullIndex);
/** Which side of the Kurzick/Luxon split the current character is on. */
const AllegianceCtx = createContext<Allegiance>(DEFAULT_ALLEGIANCE);

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
  return (
    <DataCtx.Provider value={scoped}>
      <AllegianceCtx.Provider value={character?.allegiance ?? DEFAULT_ALLEGIANCE}>
        {children}
      </AllegianceCtx.Provider>
    </DataCtx.Provider>
  );
}

/** The campaign-scoped data index for the current character. */
export const useData = (): DataIndex => useContext(DataCtx);

/** The current character's allegiance (Kurzick unless they picked Luxon). */
export const useAllegiance = (): Allegiance => useContext(AllegianceCtx);
