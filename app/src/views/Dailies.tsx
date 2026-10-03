import { useMemo, useState } from "react";
import {
  bountyStatus,
  missionStatus,
  nextReset,
  zaishenAt,
  zaishenUpcoming,
  type DailyStatus,
  type LocationRef,
  type TodoKind,
  type ZaishenBountyEntry,
  type ZaishenMissionEntry,
} from "@gw1/engine";
import { index, zaishen } from "../data";
import { hasOpenTodo } from "../todos";
import { wikiHref } from "../wiki";
import { ProfessionIcon } from "../components/ProfessionIcon";
import type { CharacterSave, SaveFile } from "../save";

/** Which rotations are expanded, held by App so tab switches keep them. */
export interface DailiesViewState {
  showUpcomingMissions: boolean;
  showUpcomingBounties: boolean;
}

export const initialDailiesViewState: DailiesViewState = {
  showUpcomingMissions: false,
  showUpcomingBounties: false,
};

const UPCOMING_DAYS = 7;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "in 7h 12m" — the dailies change at 16:00 UTC. */
function untilReset(now: Date): string {
  const minutes = Math.max(0, Math.round((nextReset(now).getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

const dayLabel = (on: Date, i: number) =>
  i === 0
    ? "Today"
    : i === 1
      ? "Tomorrow"
      : on.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

function WikiLink({ page, children }: { page: string; children?: React.ReactNode }) {
  return (
    <a href={wikiHref(page)} target="_blank" rel="noreferrer">
      {children ?? page}
    </a>
  );
}

/** The outposts the activity can be reached from; any one is enough. */
function Entrances({ outposts }: { outposts: LocationRef[] }) {
  return (
    <>
      {outposts.map((o, i) => (
        <span key={o}>
          {i > 0 && " or "}
          <WikiLink page={o} />
        </span>
      ))}
    </>
  );
}

function CharacterRow({
  character,
  status,
  kind,
  todoRefs,
  addTodoFor,
}: {
  character: CharacterSave;
  status: DailyStatus;
  /** A mission can be both reachable and already done; a bounty can only be reached. */
  kind: "mission" | "bounty";
  todoRefs: Array<{ kind: TodoKind; ref: string }>;
  addTodoFor: (name: string, entries: Array<{ kind: TodoKind; ref: string }>) => { added: number; skipped: number };
}) {
  const [result, setResult] = useState<string | null>(null);
  const outstanding = todoRefs.filter((t) => !hasOpenTodo(character.todos ?? [], t.kind, t.ref));

  const add = () => {
    const { added, skipped } = addTodoFor(character.name, todoRefs);
    setResult(
      added === 0
        ? "already on the to-do list"
        : `added ${plural(added, "place")}${skipped > 0 ? ` (${skipped} already there)` : ""}`,
    );
  };

  return (
    <div className="daily-row">
      <span className="daily-who">
        <ProfessionIcon profession={character.primaryProfession} /> {character.name}
      </span>
      {status.ready ? (
        <span className="ok daily-state">Can travel there</span>
      ) : status.missingCampaigns.length > 0 ? (
        <span className="muted daily-state">
          Does not own {status.missingCampaigns.join(" or ")}
        </span>
      ) : (
        <span className="warn daily-state">Outpost not unlocked</span>
      )}
      {kind === "mission" && status.completed && (
        <span className="tag ok" title="This mission is already completed on this character.">
          completed
        </span>
      )}
      {!status.ready && status.missingCampaigns.length === 0 && (
        <>
          <button className="small" onClick={add} disabled={outstanding.length === 0}>
            + to-do
          </button>
          {result && <span className="muted small">{result}</span>}
        </>
      )}
    </div>
  );
}

function Rotation<T>({
  title,
  note,
  entry,
  heading,
  where,
  characters,
  statusFor,
  kind,
  todoRefs,
  addTodoFor,
  upcoming,
  labelOf,
  open,
  toggle,
}: {
  title: string;
  note: string;
  entry: T;
  heading: React.ReactNode;
  where: React.ReactNode;
  characters: CharacterSave[];
  statusFor: (entry: T, character: CharacterSave) => DailyStatus;
  kind: "mission" | "bounty";
  todoRefs: (entry: T, character: CharacterSave) => Array<{ kind: TodoKind; ref: string }>;
  addTodoFor: (name: string, entries: Array<{ kind: TodoKind; ref: string }>) => { added: number; skipped: number };
  upcoming: Array<{ on: Date; entry: T }>;
  labelOf: (entry: T) => string;
  open: boolean;
  toggle: () => void;
}) {
  const ready = characters.filter((c) => statusFor(entry, c).ready);

  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted small no-margin">{note}</p>
      <div className="daily-headline">{heading}</div>
      <div className="small">{where}</div>

      <h4 className="daily-subhead">
        Your characters{" "}
        <span className="muted">
          ({ready.length} of {characters.length} can get there)
        </span>
      </h4>
      {characters.length === 0 ? (
        <p className="muted small">No characters saved yet.</p>
      ) : (
        characters.map((c) => (
          <CharacterRow
            key={c.name}
            character={c}
            status={statusFor(entry, c)}
            kind={kind}
            todoRefs={todoRefs(entry, c)}
            addTodoFor={addTodoFor}
          />
        ))
      )}

      <button className="section-toggle" onClick={toggle} aria-expanded={open}>
        <span className="caret">{open ? "▾" : "▸"}</span> Coming up
      </button>
      {open && (
        <div className="slide-down">
          <ul className="daily-upcoming small">
            {upcoming.map(({ on, entry: e }, i) => (
              <li key={i}>
                <span className="muted daily-day">{dayLabel(on, i)}</span> {labelOf(e)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function DailiesView({
  save,
  addTodoFor,
  view,
  setView,
}: {
  save: SaveFile;
  addTodoFor: (name: string, entries: Array<{ kind: TodoKind; ref: string }>) => { added: number; skipped: number };
  view: DailiesViewState;
  setView: (patch: Partial<DailiesViewState>) => void;
}) {
  // One timestamp per render, so the mission, the bounty and the countdown
  // can't disagree about which day it is.
  const now = useMemo(() => new Date(), []);
  const mission = zaishenAt(zaishen.missions, now);
  const bounty = zaishenAt(zaishen.bounties, now);
  /**
   * What to put on a character's to-do list: the entrances they could still
   * unlock. An entrance in a campaign they don't own isn't a to-do, and the
   * Fissure of Woe has one per campaign.
   */
  const outpostTodos = (outposts: LocationRef[], character: CharacterSave) => {
    const owned = character.ownedCampaigns ?? [character.campaign];
    return outposts
      .filter((ref) => {
        if (character.unlockedLocations.includes(ref)) return false;
        const campaign = index.locationByPage.get(ref)?.campaign;
        return !campaign || campaign === "Core" || owned.includes(campaign);
      })
      .map((ref) => ({ kind: "outpost" as TodoKind, ref }));
  };

  return (
    <div className="view">
      <p className="muted small">
        The Zaishen mission and bounty rotate daily at 16:00 UTC — next change in {untilReset(now)}. Both
        rotations are fixed sequences, so these are calculated, not fetched. "Can travel there" means the
        character has unlocked an outpost the activity can be started from; for a bounty in a dungeon, that is the
        nearest outpost to the dungeon entrance. Campaign ownership is taken from each character's own settings.
      </p>

      <Rotation<ZaishenMissionEntry>
        title="Zaishen Mission"
        note="Completing it awards Zaishen coins. The bonus objective is not tracked here."
        entry={mission}
        heading={
          <>
            <WikiLink page={mission.name} />
            {mission.kind === "quest" && (
              <span className="tag muted" title="Eye of the North has no missions, so its rotation days are quests.">
                quest
              </span>
            )}
          </>
        }
        where={
          <>
            <span className="muted">Start from: </span>
            <Entrances outposts={mission.outposts} />
          </>
        }
        characters={save.characters}
        statusFor={(e, c) => missionStatus(e, c, index)}
        kind="mission"
        todoRefs={(e, c) => outpostTodos(e.outposts, c)}
        addTodoFor={addTodoFor}
        upcoming={zaishenUpcoming(zaishen.missions, UPCOMING_DAYS, now)}
        labelOf={(e) => e.name}
        open={view.showUpcomingMissions}
        toggle={() => setView({ showUpcomingMissions: !view.showUpcomingMissions })}
      />

      <Rotation<ZaishenBountyEntry>
        title="Zaishen Bounty"
        note="Killing the named boss awards Zaishen coins. The boss spawns in a fixed area."
        entry={bounty}
        heading={<WikiLink page={bounty.boss} />}
        where={
          <>
            {bounty.area && (
              <>
                <span className="muted">Found in: </span>
                <WikiLink page={bounty.area} />
                <span className="muted"> · </span>
              </>
            )}
            <span className="muted">Nearest outpost: </span>
            <span title={`How this was determined: ${bounty.via}`}>
              <Entrances outposts={bounty.outposts} />
            </span>
            {bounty.hops !== null && bounty.hops > 0 && (
              <span className="muted"> ({plural(bounty.hops, "zone")} away)</span>
            )}
          </>
        }
        characters={save.characters}
        statusFor={(e, c) => bountyStatus(e, c, index)}
        kind="bounty"
        todoRefs={(e, c) => outpostTodos(e.outposts, c)}
        addTodoFor={addTodoFor}
        upcoming={zaishenUpcoming(zaishen.bounties, UPCOMING_DAYS, now)}
        labelOf={(e) => e.boss}
        open={view.showUpcomingBounties}
        toggle={() => setView({ showUpcomingBounties: !view.showUpcomingBounties })}
      />
    </div>
  );
}
