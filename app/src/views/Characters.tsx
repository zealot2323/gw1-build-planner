import { useState } from "react";
import { PROFESSIONS, Profession, type Campaign } from "@gw1/engine";
import { dataset } from "../data";
import { Checklist } from "../components/Checklist";
import { iconForSkillPage } from "../wiki";
import { ProfessionIcon } from "../components/ProfessionIcon";
import type { CharacterSave, SaveFile } from "../save";

const CORE_PROFESSIONS = [
  Profession.Warrior, Profession.Ranger, Profession.Monk,
  Profession.Necromancer, Profession.Mesmer, Profession.Elementalist,
];

/** Campaigns a character can be created in, and the professions each allows. */
const CAMPAIGN_PROFESSIONS: Record<string, Profession[]> = {
  Prophecies: CORE_PROFESSIONS,
  Factions: [...CORE_PROFESSIONS, Profession.Assassin, Profession.Ritualist],
  Nightfall: [...CORE_PROFESSIONS, Profession.Paragon, Profession.Dervish],
};
const CAMPAIGNS = Object.keys(CAMPAIGN_PROFESSIONS) as Campaign[];
/** Expansions can be owned but are nobody's home campaign. */
const EXPANSIONS: Campaign[] = ["Eye of the North"];
const OWNABLE: Campaign[] = [...CAMPAIGNS, ...EXPANSIONS];

// towns/outposts grouped by region, mirroring the zone browser's tree
const locationGroups = (() => {
  const byRegion = new Map<string, string[]>();
  for (const l of dataset.locations) {
    if (l.kind === "explorable") continue;
    const region = l.region ?? "(unknown region)";
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push(l.wikiPage);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, options]) => ({ label, options: options.sort() }));
})();
const missionNames = (dataset.missions ?? []).map((m) => m.wikiPage);

export function CharactersView({
  save,
  selected,
  onSelect,
  addCharacter,
  updateCharacter,
  removeCharacter,
  importFile,
  exportFile,
}: {
  save: SaveFile;
  selected: CharacterSave | null;
  onSelect: (name: string | null) => void;
  addCharacter: (c: CharacterSave) => void;
  updateCharacter: (name: string, patch: Partial<CharacterSave>) => void;
  removeCharacter: (name: string) => void;
  importFile: (f: File) => Promise<void>;
  exportFile: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newPrimary, setNewPrimary] = useState<Profession>(Profession.Warrior);
  const [newCampaign, setNewCampaign] = useState<Campaign>("Prophecies");
  const [importError, setImportError] = useState<string | null>(null);

  const create = () => {
    const name = newName.trim();
    if (!name || save.characters.some((c) => c.name === name)) return;
    addCharacter({
      name,
      campaign: newCampaign,
      ownedCampaigns: [newCampaign],
      primaryProfession: newPrimary,
      unlockedSecondaries: [],
      knownSkills: [],
      unlockedLocations: [],
      completedMissions: [],
      builds: [],
    });
    setNewName("");
    onSelect(name);
  };

  const c = selected;
  const professions = c ? [c.primaryProfession, ...c.unlockedSecondaries] : [];
  const knowableSkills = c
    ? dataset.skills
        .filter((s) => s.profession == null || professions.includes(s.profession))
        .map((s) => s.wikiPage)
        .sort()
    : [];

  return (
    <div className="view">
      <div className="row wrap">
        <div className="card">
          <h3>Characters</h3>
          <ul className="plain-list">
            {save.characters.map((ch) => (
              <li key={ch.name}>
                <button
                  className={c?.name === ch.name ? "linkish active" : "linkish"}
                  onClick={() => onSelect(ch.name)}
                >
                  <ProfessionIcon profession={ch.primaryProfession} /> {ch.name}
                </button>
              </li>
            ))}
            {save.characters.length === 0 && <li className="muted">none yet</li>}
          </ul>
          <div className="row">
            <input
              placeholder="new character name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <select
              value={newCampaign}
              onChange={(e) => {
                const c = e.target.value as Campaign;
                setNewCampaign(c);
                if (!CAMPAIGN_PROFESSIONS[c].includes(newPrimary)) {
                  setNewPrimary(CAMPAIGN_PROFESSIONS[c][0]);
                }
              }}
            >
              {CAMPAIGNS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select value={newPrimary} onChange={(e) => setNewPrimary(e.target.value as Profession)}>
              {(CAMPAIGN_PROFESSIONS[newCampaign] ?? CORE_PROFESSIONS).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button onClick={create}>Create</button>
          </div>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button onClick={exportFile}>Export JSON</button>
            <label className="button-like">
              Import JSON
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFile(f).then(() => setImportError(null), (err) => setImportError(String(err)));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {importError && <div className="error">{importError}</div>}
          <p className="muted small">
            The exported JSON file is the real save format; localStorage is convenience.
          </p>
        </div>

        {c && (
          <div className="card grow">
            <div className="row space-between">
              <h3>
                {c.name}{" "}
                <span className="muted">
                  — <ProfessionIcon profession={c.primaryProfession} withLabel /> (primary, fixed)
                </span>
              </h3>
              <button className="danger" onClick={() => { removeCharacter(c.name); onSelect(null); }}>
                Delete
              </button>
            </div>
            <div className="field">
              <span className="field-label">
                Campaigns owned <span className="muted">(from {c.campaign ?? "Prophecies"})</span>
              </span>
              {OWNABLE.map((camp) => (
                <label key={camp} className="inline-check">
                  <input
                    type="checkbox"
                    checked={(c.ownedCampaigns ?? [c.campaign ?? "Prophecies"]).includes(camp)}
                    disabled={camp === (c.campaign ?? "Prophecies")}
                    onChange={(e) => {
                      const owned = new Set(c.ownedCampaigns ?? [c.campaign ?? "Prophecies"]);
                      if (e.target.checked) owned.add(camp);
                      else owned.delete(camp);
                      updateCharacter(c.name, { ownedCampaigns: [...owned] as Campaign[] });
                    }}
                  />
                  {camp}
                </label>
              ))}
            </div>
            <div className="field">
              <span className="field-label">Unlocked secondaries</span>
              {PROFESSIONS.filter((p) => p !== c.primaryProfession).map((p) => (
                <label key={p} className="inline-check">
                  <input
                    type="checkbox"
                    checked={c.unlockedSecondaries.includes(p)}
                    onChange={(e) =>
                      updateCharacter(c.name, {
                        unlockedSecondaries: e.target.checked
                          ? [...c.unlockedSecondaries, p]
                          : c.unlockedSecondaries.filter((x) => x !== p),
                      })
                    }
                  />
                  <ProfessionIcon profession={p} withLabel />
                </label>
              ))}
            </div>
            <div className="row wrap align-top">
              <Checklist
                label="Unlocked towns/outposts"
                groups={locationGroups}
                selected={c.unlockedLocations}
                onChange={(v) => updateCharacter(c.name, { unlockedLocations: v })}
                detail={(o) => dataset.locations.find((l) => l.wikiPage === o)?.kind ?? null}
              />
              <Checklist
                label="Completed missions"
                options={missionNames}
                selected={c.completedMissions}
                onChange={(v) => updateCharacter(c.name, { completedMissions: v })}
              />
              <Checklist
                label={`Known skills (${c.primaryProfession}${c.unlockedSecondaries.length ? "/" + c.unlockedSecondaries.join("/") : ""} + common)`}
                options={knowableSkills}
                selected={c.knownSkills}
                onChange={(v) => updateCharacter(c.name, { knownSkills: v })}
                icon={iconForSkillPage}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
