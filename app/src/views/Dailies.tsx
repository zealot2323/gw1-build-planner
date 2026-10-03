import { useMemo, useState } from "react";
import {
  bountyStatus,
  missionStatus,
  nextChange,
  nicholasStatus,
  travelDistances,
  zaishenAt,
  zaishenUpcoming,
  type DailyStatus,
  type LocationRef,
  type TodoKind,
  type NicholasEntry,
  type TravelGraph,
  type ZaishenBountyEntry,
  type ZaishenMissionEntry,
} from "@gw1/engine";
import { index, indexForCharacter, zaishen } from "../data";
import { hasOpenTodo } from "../todos";
import { wikiHref } from "../wiki";
import { ProfessionIcon } from "../components/ProfessionIcon";
import { ProximityDot } from "../components/ProximityDot";
import type { CharacterSave, SaveFile } from "../save";

/** Which rotations are expanded, held by App so tab switches keep them. */
export interface DailiesViewState {
  showUpcomingMissions: boolean;
  showUpcomingBounties: boolean;
  showUpcomingNicholas: boolean;
}

export const initialDailiesViewState: DailiesViewState = {
  showUpcomingMissions: false,
  showUpcomingBounties: false,
  showUpcomingNicholas: false,
};

/** A character and the travel graph for their own campaigns. */
interface Traveller {
  character: CharacterSave;
  graph: TravelGraph;
}

const UPCOMING_DAYS = 7;
const UPCOMING_WEEKS = 6;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "6d 7h" or "7h 12m" until this rotation turns over. */
function until(next: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

const date = (on: Date) => on.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

const dayLabel = (on: Date, i: number) => (i === 0 ? "Today" : i === 1 ? "Tomorrow" : date(on));

const weekLabel = (on: Date, i: number) =>
  i === 0 ? "This week" : i === 1 ? "Next week" : `From ${date(on)}`;

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
  showCompleted,
  todoRefs,
  addTodoFor,
}: {
  character: CharacterSave;
  status: DailyStatus;
  /** A mission can be both reachable and already done; nothing else can. */
  showCompleted: boolean;
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
      <span className="daily-state">
        <ProximityDot proximity={status.proximity} distance={status.distance} />{" "}
        {status.ready ? (
          <span className="ok">Can travel there</span>
        ) : status.missingCampaigns.length > 0 ? (
          <span className="muted">Does not own {status.missingCampaigns.join(" or ")}</span>
        ) : status.distance === null ? (
          <span className="warn">No route there yet</span>
        ) : (
          <span className="warn">{plural(status.distance, "zone")} away</span>
        )}
      </span>
      {showCompleted && status.completed && (
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
  travellers,
  statusFor,
  showCompleted = false,
  todoRefs,
  addTodoFor,
  upcoming,
  labelOf,
  slotLabel,
  open,
  toggle,
}: {
  title: string;
  note: string;
  entry: T;
  heading: React.ReactNode;
  where: React.ReactNode;
  travellers: Traveller[];
  statusFor: (entry: T, character: CharacterSave, graph: TravelGraph) => DailyStatus;
  showCompleted?: boolean;
  todoRefs: (entry: T, character: CharacterSave) => Array<{ kind: TodoKind; ref: string }>;
  addTodoFor: (name: string, entries: Array<{ kind: TodoKind; ref: string }>) => { added: number; skipped: number };
  upcoming: Array<{ on: Date; entry: T }>;
  labelOf: (entry: T) => string;
  /** How a row in "Coming up" names its slot: a day, or a week. */
  slotLabel: (on: Date, i: number) => string;
  open: boolean;
  toggle: () => void;
}) {
  const ready = travellers.filter((t) => statusFor(entry, t.character, t.graph).ready);
  // "Someone could go" is the useful signal when looking ahead: it says the
  // week or the day is worth planning around without reading every row.
  const reachable = (candidate: T) =>
    travellers.some((t) => statusFor(candidate, t.character, t.graph).ready);

  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted small no-margin">{note}</p>
      <div className="daily-headline">{heading}</div>
      <div className="small">{where}</div>

      <h4 className="daily-subhead">
        Your characters{" "}
        <span className="muted">
          ({ready.length} of {travellers.length} can get there)
        </span>
      </h4>
      {travellers.length === 0 ? (
        <p className="muted small">No characters saved yet.</p>
      ) : (
        travellers.map(({ character, graph }) => (
          <CharacterRow
            key={character.name}
            character={character}
            status={statusFor(entry, character, graph)}
            showCompleted={showCompleted}
            todoRefs={todoRefs(entry, character)}
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
            {upcoming.map(({ on, entry: e }, i) => {
              const anyone = reachable(e);
              return (
                <li key={i} className={anyone ? "ok" : undefined}>
                  <span className="muted daily-day">{slotLabel(on, i)}</span> {labelOf(e)}
                  {anyone && (
                    <span className="visually-hidden"> — someone can already get there</span>
                  )}
                </li>
              );
            })}
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
  // One travel graph per character, over their own campaigns: a Tyrian must
  // not be told a Canthan outpost is two zones away.
  const travellers: Traveller[] = useMemo(
    () =>
      save.characters.map((character) => ({
        character,
        graph: travelDistances(character, indexForCharacter(character)),
      })),
    [save.characters],
  );
  const mission = zaishenAt(zaishen.missions, now);
  const bounty = zaishenAt(zaishen.bounties, now);
  const nicholas = zaishenAt(zaishen.nicholas, now);
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
        The Zaishen mission and bounty rotate daily at 16:00 UTC (next change in{" "}
        {until(nextChange(zaishen.missions, now), now)}); Nicholas the Traveler moves every Monday at 15:00 UTC
        (next change in {until(nextChange(zaishen.nicholas, now), now)}). All three are fixed sequences, so these
        are calculated, not fetched. "Can travel there" means the character has unlocked an outpost the activity
        can be started from; for a bounty in a dungeon, that is the nearest outpost to the dungeon entrance.
        Campaign ownership is taken from each character's own settings.
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
        travellers={travellers}
        statusFor={(e, c, g) => missionStatus(e, c, index, g)}
        showCompleted
        todoRefs={(e, c) => outpostTodos(e.outposts, c)}
        addTodoFor={addTodoFor}
        upcoming={zaishenUpcoming(zaishen.missions, UPCOMING_DAYS, now)}
        labelOf={(e) => e.name}
        slotLabel={dayLabel}
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
        travellers={travellers}
        statusFor={(e, c, g) => bountyStatus(e, c, index, g)}
        todoRefs={(e, c) => outpostTodos(e.outposts, c)}
        addTodoFor={addTodoFor}
        upcoming={zaishenUpcoming(zaishen.bounties, UPCOMING_DAYS, now)}
        labelOf={(e) => e.boss}
        slotLabel={dayLabel}
        open={view.showUpcomingBounties}
        toggle={() => setView({ showUpcomingBounties: !view.showUpcomingBounties })}
      />

      <Rotation<NicholasEntry>
        title="Nicholas the Traveler"
        note="He takes one item per week, anywhere from 1 to 5 of it, in exchange for a gift bag. The item drops in the area he is standing in."
        entry={nicholas}
        heading={
          <>
            {nicholas.quantity} × <WikiLink page={nicholas.item} />
          </>
        }
        where={
          <>
            <span className="muted">Collect in: </span>
            <WikiLink page={nicholas.location} />
            <span className="muted">
              {" "}
              ({nicholas.region}, {nicholas.campaign})
            </span>
            <span className="muted"> · Nearest outpost: </span>
            <span title={`How this was determined: ${nicholas.via}`}>
              <Entrances outposts={nicholas.outposts} />
            </span>
          </>
        }
        travellers={travellers}
        statusFor={(e, c, g) => nicholasStatus(e, c, index, g)}
        todoRefs={(e, c) => outpostTodos(e.outposts, c)}
        addTodoFor={addTodoFor}
        upcoming={zaishenUpcoming(zaishen.nicholas, UPCOMING_WEEKS, now)}
        labelOf={(e) => `${e.quantity} × ${e.item} — ${e.location}`}
        slotLabel={weekLabel}
        open={view.showUpcomingNicholas}
        toggle={() => setView({ showUpcomingNicholas: !view.showUpcomingNicholas })}
      />
    </div>
  );
}
