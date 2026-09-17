import { Fragment, useMemo } from "react";
import { questBoard, travelDistances, type QuestBoardEntry } from "@gw1/engine";
import { useData } from "../DataContext";
import { changes } from "../data";
import { SkillIcon } from "../components/SkillIcon";
import { SkillDetails } from "../components/SkillDetails";
import { SkillChanges } from "../components/SkillChanges";
import { ChangeBadge } from "../components/ChangeBadge";
import { ProfessionIcon } from "../components/ProfessionIcon";
import { ProximityDot } from "../components/ProximityDot";
import { wikiHref } from "../wiki";
import type { CharacterSave } from "../save";

/** Filters and the open quest/skill, held by App so tab switches keep them. */
export interface QuestViewState {
  search: string;
  hideKnown: boolean;
  /** "quest|skill" of the reward whose details are expanded. */
  openReward: string | null;
}

export const initialQuestViewState: QuestViewState = {
  search: "",
  hideKnown: true,
  openReward: null,
};

const stop = (e: React.MouseEvent) => e.stopPropagation();

function WikiLink({ page }: { page: string }) {
  return (
    <a href={wikiHref(page)} target="_blank" rel="noreferrer" onClick={stop}>
      {page}
    </a>
  );
}

function joinLinks(pages: string[], sep = ", ") {
  return pages.map((p, i) => (
    <Fragment key={p}>
      {i > 0 && sep}
      <WikiLink page={p} />
    </Fragment>
  ));
}

/** Who may take it, in words — only for profession-restricted quests. */
function restriction(e: QuestBoardEntry): string | null {
  const { profession, primaryOnly } = e.quest;
  if (!profession) return null;
  return primaryOnly ? `${profession} primary only` : `${profession} primary or secondary`;
}

function QuestCard({
  entry,
  openReward,
  setOpenReward,
  knownSkills,
}: {
  entry: QuestBoardEntry;
  openReward: string | null;
  setOpenReward: (v: string | null) => void;
  knownSkills: Set<string>;
}) {
  const { quest } = entry;
  const key = (skill: string) => `${quest.wikiPage}|${skill}`;
  const open = entry.rewards.find((s) => openReward === key(s.wikiPage));
  const gate = restriction(entry);

  return (
    <div className="quest-card">
      <div className="quest-head">
        <ProximityDot proximity={entry.proximity} distance={entry.distance} />
        <a className="quest-name" href={wikiHref(quest.wikiPage)} target="_blank" rel="noreferrer">
          {quest.name}
        </a>
        <span className="quest-tag">{quest.type}</span>
        {entry.preSearing && (
          <span className="quest-tag warn" title="Given in pre-Searing Ascalon. It can no longer be taken once the character leaves.">
            pre-Searing
          </span>
        )}
        {gate && (
          <span className="quest-tag" title="Profession requirement, from the quest's wiki page">
            <ProfessionIcon profession={quest.profession} /> {gate}
          </span>
        )}
      </div>

      <div className="small quest-where">
        {entry.location ? (
          <>
            <WikiLink page={entry.location} />
            {quest.givenAt.length > 1 && (
              <span className="muted"> (or {joinLinks(quest.givenAt.filter((l) => l !== entry.location), " or ")})</span>
            )}
          </>
        ) : (
          <span className="muted">location unknown</span>
        )}
        {quest.givenBy.length > 0 && (
          <span className="muted"> · from {joinLinks(quest.givenBy, " / ")}</span>
        )}
        <span className="muted">
          {" · "}
          {entry.availableNow
            ? "available now"
            : entry.distance === null
              ? "no known route there"
              : `${entry.distance} zone${entry.distance === 1 ? "" : "s"} away`}
        </span>
        {entry.route.length > 0 && <span className="muted"> · via {entry.route.join(" → ")}</span>}
        {quest.precededBy.length > 0 && (
          <div className="muted">after: {joinLinks(quest.precededBy)}</div>
        )}
      </div>

      <div className="skillbar">
        {entry.rewards.map((s) => {
          const isKnown = knownSkills.has(s.wikiPage);
          const isOpen = openReward === key(s.wikiPage);
          const changed = changes.recentlyChanged.get(s.wikiPage);
          return (
            <button
              key={s.wikiPage}
              className={`skill-card${isOpen ? " open" : ""}${isKnown ? " known" : ""}`}
              onClick={() => setOpenReward(isOpen ? null : key(s.wikiPage))}
              title={isKnown ? "already known" : "show skill details"}
            >
              <SkillIcon page={s.wikiPage} size={28} />
              <span className="skill-card-name">
                {s.name}
                {s.isElite && <span className="elite"> ★</span>}
                {changed && <ChangeBadge record={changed} />}
                {isKnown && <span className="ok"> ✓</span>}
              </span>
            </button>
          );
        })}
      </div>

      {open && (
        <div className="slide-down">
          <SkillDetails skill={open} />
          {changes.recentlyChanged.has(open.wikiPage) && (
            <SkillChanges record={changes.recentlyChanged.get(open.wikiPage)!} skill={open} />
          )}
        </div>
      )}
    </div>
  );
}

export function QuestsView({
  character,
  view,
  setView,
}: {
  character: CharacterSave | null;
  view: QuestViewState;
  setView: (patch: Partial<QuestViewState>) => void;
}) {
  const index = useData();
  const board = useMemo(
    () => (character ? questBoard(character, index, travelDistances(character, index)) : []),
    [character, index],
  );

  if (!character) return <div className="view muted pad">Select a character on the Characters tab.</div>;

  const term = view.search.trim().toLowerCase();
  const knownSkills = new Set(character.knownSkills);
  const visible = board.filter(
    (e) =>
      (!view.hideKnown || e.known < e.rewards.length) &&
      (term === "" ||
        e.quest.name.toLowerCase().includes(term) ||
        e.rewards.some((s) => s.name.toLowerCase().includes(term)) ||
        (e.location ?? "").toLowerCase().includes(term)),
  );
  const now = visible.filter((e) => e.availableNow);
  const later = visible.filter((e) => !e.availableNow);
  const hiddenKnown = board.filter((e) => e.known === e.rewards.length).length;

  const section = (title: string, list: QuestBoardEntry[], note?: string) =>
    list.length > 0 && (
      <div className="card">
        <h3>
          {title} <span className="muted">({list.length})</span>
        </h3>
        {note && <p className="muted small no-margin">{note}</p>}
        {list.map((e) => (
          <QuestCard
            key={e.quest.wikiPage}
            entry={e}
            openReward={view.openReward}
            setOpenReward={(v) => setView({ openReward: v })}
            knownSkills={knownSkills}
          />
        ))}
      </div>
    );

  return (
    <div className="view">
      <div className="row wrap toolbar">
        <input
          type="search"
          className="quest-search"
          placeholder="Search quests, skills or places…"
          value={view.search}
          onChange={(e) => setView({ search: e.target.value })}
        />
        <label className="inline-check">
          <input
            type="checkbox"
            checked={view.hideKnown}
            onChange={(e) => setView({ hideKnown: e.target.checked })}
          />
          Hide quests whose skills I already know{hiddenKnown > 0 && view.hideKnown ? ` (${hiddenKnown} hidden)` : ""}
        </label>
      </div>
      <p className="muted small">
        Quests that reward a skill {character.name} can learn — {character.primaryProfession}
        {character.unlockedSecondaries.length > 0 ? `, ${character.unlockedSecondaries.join(", ")}` : ""}, or skills
        with no profession. Profession requirements come from each quest's wiki page. Prerequisite quests are
        listed for reference but are not checked, because completed quests are not tracked.
      </p>
      {visible.length === 0 && <div className="card muted">No quests match these filters.</div>}
      {section("Available now", now, "Given at an outpost you have unlocked, or an explorable area next to one.")}
      {section("Not yet reachable", later, "Nearest first.")}
    </div>
  );
}
