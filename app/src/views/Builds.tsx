import { useMemo, useState } from "react";
import {
  buildReadiness,
  decodeTemplate,
  encodeTemplate,
  travelDistances,
  TemplateError,
  type Build,
  type BuildSlot,
  type Profession,
} from "@gw1/engine";
import { useData } from "../DataContext";
import { SkillIcon } from "../components/SkillIcon";
import { SkillDetails } from "../components/SkillDetails";
import { ProfessionIcon } from "../components/ProfessionIcon";
import { ProximityDot } from "../components/ProximityDot";
import type { CharacterSave } from "../save";

export interface BuildsViewState {
  /** "<build name>|<skill page>" of the slot whose details are open. */
  openSlot: string | null;
  code: string;
  newName: string;
}

export const initialBuildsViewState: BuildsViewState = { openSlot: null, code: "", newName: "" };

const STATUS_WORD: Record<string, string> = {
  KNOWN: "known",
  PURCHASABLE_NOW: "buy now",
  QUESTABLE_NOW: "quest now",
  CAPTURABLE_NOW: "capture now",
  FUTURE: "later",
};

/** One of the 8 slots: icon, known/missing state, click for details. */
function Slot({
  slot,
  open,
  onToggle,
}: {
  slot: BuildSlot;
  open: boolean;
  onToggle: () => void;
}) {
  if (slot.ref === null) return <span className="build-slot empty">empty</span>;
  const cls = ["build-slot", slot.known ? "known" : "missing", open ? "open" : ""].join(" ");
  return (
    <button className={cls} onClick={onToggle} title={slot.known ? "you know this" : "you don't have this yet"}>
      <SkillIcon page={slot.ref} size={32} />
      <span className="build-slot-name">
        {slot.skill?.name ?? slot.ref}
        {slot.skill?.isElite && <span className="elite"> ★</span>}
      </span>
      {slot.known ? <span className="ok">✓</span> : <ProximityDot proximity={slot.plan?.proximity ?? "unknown"} distance={slot.plan?.distance ?? null} />}
    </button>
  );
}

export function BuildsView({
  character,
  updateBuilds,
  onLoadBuild,
  view,
  setView,
}: {
  character: CharacterSave | null;
  updateBuilds: (builds: Build[]) => void;
  /** Open a build in the skill browser's editor. */
  onLoadBuild: (name: string) => void;
  view: BuildsViewState;
  setView: (patch: Partial<BuildsViewState>) => void;
}) {
  const index = useData();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const graph = useMemo(() => (character ? travelDistances(character, index) : null), [character, index]);

  if (!character) return <div className="view muted pad">Select a character first.</div>;
  const builds = character.builds;

  /** Paste a template code from the game (or gw1builds) to add a build. */
  const addFromCode = () => {
    setError(null);
    try {
      const decoded = decodeTemplate(view.code, index);
      if (decoded.primary && decoded.primary !== character.primaryProfession) {
        setError(
          `That build is for a ${decoded.primary} primary, but ${character.name} is a ${character.primaryProfession}. Saved anyway — the skills that don't fit are flagged below.`,
        );
      }
      const name = view.newName.trim() || `Imported build ${builds.length + 1}`;
      if (builds.some((b) => b.name === name)) {
        setError(`You already have a build called "${name}".`);
        return;
      }
      const build: Build = {
        name,
        character: character.name,
        primary: character.primaryProfession,
        secondary: (decoded.secondary as Profession | null) ?? null,
        skills: decoded.skills.map((s) => s?.wikiPage ?? null) as Build["skills"],
      };
      updateBuilds([...builds, build]);
      setView({ code: "", newName: "" });
      if (decoded.unknownSkillIds.length > 0) {
        setError(
          `Imported, but ${decoded.unknownSkillIds.length} skill(s) in that code aren't in our data (PvP-only versions, or newer than our last scrape) and came in as empty slots.`,
        );
      }
    } catch (err) {
      setError(err instanceof TemplateError ? err.message : String(err));
    }
  };

  const copyCode = async (build: Build) => {
    try {
      const code = encodeTemplate(build, index);
      await navigator.clipboard.writeText(code);
      setCopied(build.name);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      setError(`Couldn't copy the code: ${String(err)}`);
    }
  };

  return (
    <div className="view">
      <div className="card">
        <h3>Add a build</h3>
        <p className="muted small no-margin">
          Paste a template code from the game (Ctrl+Shift+C on a skill bar) or from a build site — the same
          format gw1builds uses.
        </p>
        <div className="row wrap" style={{ marginTop: "0.5rem" }}>
          <input
            className="code-input"
            placeholder="OQATEXKz8QfA…"
            value={view.code}
            onChange={(e) => setView({ code: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && addFromCode()}
          />
          <input
            placeholder="name it (optional)"
            value={view.newName}
            onChange={(e) => setView({ newName: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && addFromCode()}
          />
          <button onClick={addFromCode}>Add build</button>
        </div>
        {error && <div className="error small">{error}</div>}
      </div>

      {builds.length === 0 && (
        <div className="card muted">
          No builds yet. Paste a code above, or build one on the Skills tab and save it there.
        </div>
      )}

      {builds.map((build) => {
        const readiness = buildReadiness(build, character, index, graph ?? undefined);
        return (
          <div className="card" key={build.name}>
            <div className="row space-between wrap">
              <h3 className="no-margin">
                {build.name}{" "}
                <span className="muted small">
                  <ProfessionIcon profession={build.primary} />
                  {build.secondary && (
                    <>
                      /<ProfessionIcon profession={build.secondary} />
                    </>
                  )}
                </span>
              </h3>
              <div className="row">
                <span className={readiness.ready ? "ok small" : "muted small"}>
                  {readiness.ready
                    ? "✓ you have every skill"
                    : `${readiness.known}/${readiness.filled} skills known`}
                </span>
                <button className="small" onClick={() => onLoadBuild(build.name)}>
                  Open in editor
                </button>
                <button className="small" onClick={() => copyCode(build)}>
                  {copied === build.name ? "Copied!" : "Copy code"}
                </button>
                <button
                  className="small danger"
                  onClick={() => updateBuilds(builds.filter((b) => b.name !== build.name))}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="build-slots">
              {readiness.slots.map((slot, i) => (
                <Slot
                  key={i}
                  slot={slot}
                  open={view.openSlot === `${build.name}|${slot.ref}`}
                  onToggle={() =>
                    setView({
                      openSlot: view.openSlot === `${build.name}|${slot.ref}` ? null : `${build.name}|${slot.ref}`,
                    })
                  }
                />
              ))}
            </div>

            {readiness.slots.map(
              (slot) =>
                slot.skill &&
                view.openSlot === `${build.name}|${slot.ref}` && (
                  <div className="slide-down" key={slot.ref}>
                    <SkillDetails skill={slot.skill} plan={slot.known ? undefined : slot.plan} />
                  </div>
                ),
            )}

            {readiness.errors.length > 0 && (
              <ul className="build-errors small">
                {readiness.errors.map((e, i) => (
                  <li key={i} className="error">
                    {e.message} <span className="muted">{e.fix}</span>
                  </li>
                ))}
              </ul>
            )}

            {readiness.missing.length > 0 && (
              <p className="small no-margin">
                <span className="muted">Still need:</span>{" "}
                {readiness.missing.map((slot, i) => (
                  <span key={slot.ref}>
                    {i > 0 && ", "}
                    {slot.skill?.name ?? slot.ref}{" "}
                    <span className="muted">
                      ({STATUS_WORD[slot.entry?.status ?? ""] ?? "unknown"}
                      {slot.plan && slot.plan.distance !== null && slot.plan.distance > 0
                        ? `, ${slot.plan.distance} zones`
                        : ""}
                      )
                    </span>
                  </span>
                ))}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
