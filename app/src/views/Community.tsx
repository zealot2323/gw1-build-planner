import { useEffect, useMemo, useState } from "react";
import {
  buildReadiness,
  travelDistances,
  type Build,
  type CommunityBuild,
  type Profession,
} from "@gw1/engine";
import { useData } from "../DataContext";
import { loadCommunityBuilds } from "../data";
import { SkillIcon } from "../components/SkillIcon";
import { SkillDetails } from "../components/SkillDetails";
import { ProfessionIcon } from "../components/ProfessionIcon";
import type { CharacterSave } from "../save";

/**
 * Cards rendered before "Show more". With every PvX build in the file this
 * page would otherwise mount over a thousand cards at once, which a phone
 * feels immediately.
 */
const PAGE = 30;

export interface CommunityViewState {
  search: string;
  profession: string;
  /** Channel, subreddit or list the build came from; "all" for everything. */
  source: string;
  sort: "new" | "popular" | "name";
  /** "<build id>|<skill page>" of the open skill. */
  openSkill: string | null;
  /** How many cards to render; grows with "Show more". */
  limit: number;
}

export const initialCommunityViewState: CommunityViewState = {
  search: "",
  profession: "all",
  source: "all",
  sort: "new",
  openSkill: null,
  limit: PAGE,
};

const SOURCE_LABEL: Record<string, string> = {
  file: "Curated",
  pvx: "PvX wiki",
  reddit: "Reddit",
  youtube: "YouTube",
  other: "Other",
};

/** Builds first seen within this many days count as new. */
const NEW_DAYS = 30;

const isNew = (build: CommunityBuild, now = Date.now()): boolean =>
  now - new Date(`${build.firstSeen}T00:00:00Z`).getTime() < NEW_DAYS * 86_400_000;

function BuildCard({
  build,
  character,
  openSkill,
  setOpenSkill,
  onSave,
  saved,
  onFilterSource,
}: {
  build: CommunityBuild;
  character: CharacterSave | null;
  openSkill: string | null;
  setOpenSkill: (v: string | null) => void;
  onSave: (build: CommunityBuild) => void;
  saved: boolean;
  onFilterSource: (name: string) => void;
}) {
  const index = useData();
  const [copied, setCopied] = useState(false);

  // How this build sits with the selected character, if there is one.
  const readiness = useMemo(() => {
    if (!character) return null;
    const asBuild: Build = {
      name: build.name,
      character: character.name,
      primary: character.primaryProfession,
      secondary: (build.secondary as Profession | null) ?? null,
      attributes: build.attributes,
      skills: build.skills as Build["skills"],
    };
    return buildReadiness(asBuild, character, index, travelDistances(character, index));
  }, [build, character, index]);

  const copy = async () => {
    await navigator.clipboard.writeText(build.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const wrongPrimary =
    character && build.primary && build.primary !== character.primaryProfession ? build.primary : null;

  return (
    <div className="card community-build">
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
          {readiness && !wrongPrimary && (
            <span className={readiness.ready ? "ok small" : "muted small"}>
              {readiness.ready ? "✓ You know every skill" : `${readiness.known} of ${readiness.filled} skills known`}
            </span>
          )}
          {wrongPrimary && (
            <span className="muted small">
              For {/^[AEIOU]/i.test(wrongPrimary) ? "an" : "a"} {wrongPrimary} primary
            </span>
          )}
          <button className="small" onClick={copy}>
            {copied ? "Copied" : "Copy code"}
          </button>
          {character && (
            <button className="small" disabled={saved} onClick={() => onSave(build)}>
              {saved ? "Saved" : "Save to character"}
            </button>
          )}
        </div>
      </div>

      <div className="build-slots">
        {build.skills.map((ref, i) =>
          ref === null ? (
            <span className="build-slot empty" key={i}>
              empty
            </span>
          ) : (
            <button
              key={`${ref}-${i}`}
              className={`build-slot${openSkill === `${build.id}|${ref}` ? " open" : ""}${
                character?.knownSkills.includes(ref) ? " known" : ""
              }`}
              onClick={() => setOpenSkill(openSkill === `${build.id}|${ref}` ? null : `${build.id}|${ref}`)}
            >
              <SkillIcon page={ref} size={28} />
              <span className="build-slot-name">{index.skillByPage.get(ref)?.name ?? ref}</span>
            </button>
          ),
        )}
      </div>

      {build.skills.map((ref) =>
        ref && openSkill === `${build.id}|${ref}` && index.skillByPage.has(ref) ? (
          <div className="slide-down" key={ref}>
            <SkillDetails skill={index.skillByPage.get(ref)!} />
          </div>
        ) : null,
      )}

      <div className="small community-meta">
        <button
          className="quest-tag linkish source-chip"
          onClick={() => onFilterSource(build.source.author ?? SOURCE_LABEL[build.source.kind] ?? build.source.kind)}
          title="Show only builds from this source"
        >
          {SOURCE_LABEL[build.source.kind] ?? build.source.kind}
          {build.source.author ? ` · ${build.source.author}` : ""}
        </button>{" "}
        {build.source.url ? (
          <a href={build.source.url} target="_blank" rel="noreferrer noopener">
            {build.source.title ?? build.source.url}
          </a>
        ) : (
          <span className="muted">{build.source.title ?? "no link"}</span>
        )}
        {build.source.postedAt && <span className="muted"> · {build.source.postedAt}</span>}
        {build.source.score !== undefined && (
          <span className="muted">
            {" · "}
            {build.source.score.toLocaleString()}{" "}
            {build.source.kind === "youtube" ? "views" : "points"}
          </span>
        )}
        {build.campaigns.length > 0 && <span className="muted"> · needs {build.campaigns.join(", ")}</span>}
        {build.tags?.map((t) => (
          <span className="quest-tag" key={t}>
            {t}
          </span>
        ))}
      </div>
      {build.source.context && (
        // someone else's words: quoted, never presented as ours
        <blockquote className="community-context small muted">{build.source.context}</blockquote>
      )}
    </div>
  );
}

export function CommunityView({
  character,
  updateBuilds,
  view,
  setView,
}: {
  character: CharacterSave | null;
  updateBuilds: (builds: Build[]) => void;
  view: CommunityViewState;
  setView: (patch: Partial<CommunityViewState>) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [communityBuilds, setCommunityBuilds] = useState<CommunityBuild[] | null>(null);

  useEffect(() => {
    let live = true;
    loadCommunityBuilds().then((builds) => live && setCommunityBuilds(builds));
    return () => {
      live = false;
    };
  }, []);

  const professions = useMemo(
    () => [...new Set((communityBuilds ?? []).map((b) => b.primary).filter(Boolean))].sort() as string[],
    [communityBuilds],
  );

  /** Channels, subreddits and lists, busiest first — that's the useful order. */
  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of communityBuilds ?? []) {
      const name = b.source.author ?? SOURCE_LABEL[b.source.kind] ?? b.source.kind;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [communityBuilds]);

  const sourceOf = (b: CommunityBuild) => b.source.author ?? SOURCE_LABEL[b.source.kind] ?? b.source.kind;

  const term = view.search.trim().toLowerCase();
  const visible = (communityBuilds ?? [])
    .filter(
      (b) =>
        (view.profession === "all" || b.primary === view.profession) &&
        (view.source === "all" || sourceOf(b) === view.source) &&
        (term === "" ||
          b.name.toLowerCase().includes(term) ||
          (b.tags ?? []).some((t) => t.toLowerCase().includes(term)) ||
          (b.source.context ?? "").toLowerCase().includes(term) ||
          sourceOf(b).toLowerCase().includes(term) ||
          (b.source.title ?? "").toLowerCase().includes(term) ||
          b.skills.some((s) => s?.toLowerCase().includes(term))),
    )
    .sort((a, b) => {
      if (view.sort === "name") return a.name.localeCompare(b.name);
      if (view.sort === "popular") return (b.source.score ?? 0) - (a.source.score ?? 0);
      return b.firstSeen.localeCompare(a.firstSeen) || a.name.localeCompare(b.name);
    });

  const shown = visible.slice(0, view.limit);
  const fresh = shown.filter((b) => isNew(b));
  const rest = shown.filter((b) => !isNew(b));

  const save = (build: CommunityBuild) => {
    if (!character) return;
    let name = build.name;
    for (let n = 2; character.builds.some((b) => b.name === name); n++) name = `${build.name} (${n})`;
    updateBuilds([
      ...character.builds,
      {
        name,
        character: character.name,
        primary: character.primaryProfession,
        secondary: (build.secondary as Profession | null) ?? null,
        attributes: build.attributes,
        skills: build.skills as Build["skills"],
      },
    ]);
    setNote(`Saved "${name}" to ${character.name}. It's on the Builds tab.`);
  };

  const savedAlready = (build: CommunityBuild) =>
    character?.builds.some((b) => b.skills.join("|") === build.skills.join("|")) ?? false;

  const section = (title: string, list: CommunityBuild[], note?: string) =>
    list.length > 0 && (
      <>
        <h3 className="community-heading">
          {title} <span className="muted">({list.length})</span>
          {note && <span className="muted small"> — {note}</span>}
        </h3>
        {list.map((b) => (
          <BuildCard
            key={b.id}
            build={b}
            character={character}
            openSkill={view.openSkill}
            setOpenSkill={(v) => setView({ openSkill: v })}
            onSave={save}
            saved={savedAlready(b)}
            onFilterSource={(name) => setView({ source: name, limit: PAGE })}
          />
        ))}
      </>
    );

  return (
    <div className="view">
      <div className="card">
        <h3>Community builds</h3>
        <p className="muted small no-margin">
          Builds collected from elsewhere — curated lists, and a weekly sweep of Reddit and YouTube for template
          codes. Each one links back to where it came from. Nothing here is checked or endorsed; the quoted text
          is the poster's own.
        </p>
        <div className="row wrap toolbar" style={{ marginTop: "0.6rem" }}>
          <input
            type="search"
            className="quest-search"
            placeholder="Search builds, skills or tags…"
            value={view.search}
            onChange={(e) => setView({ search: e.target.value, limit: PAGE })}
          />
          <label>
            Profession{" "}
            <select
              value={view.profession}
              onChange={(e) => setView({ profession: e.target.value, limit: PAGE })}
            >
              <option value="all">All</option>
              {professions.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Source{" "}
            <select value={view.source} onChange={(e) => setView({ source: e.target.value, limit: PAGE })}>
              <option value="all">All sources</option>
              {sources.map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort by{" "}
            <select
              value={view.sort}
              onChange={(e) => setView({ sort: e.target.value as CommunityViewState["sort"], limit: PAGE })}
            >
              <option value="new">Newest</option>
              <option value="popular">Most popular</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        {note && <div className="ok small">{note}</div>}
      </div>

      {communityBuilds === null ? (
        <div className="card muted">Loading community builds…</div>
      ) : communityBuilds.length === 0 ? (
        <div className="card muted">
          No community builds yet. They arrive two ways: an imported list of template codes
          (<code>npm run community -- your-file.csv</code>), and the weekly crawl of Reddit and YouTube.
        </div>
      ) : visible.length === 0 ? (
        <div className="card muted">No builds match these filters.</div>
      ) : (
        <>
          {section("New and hot", fresh, `first seen in the last ${NEW_DAYS} days`)}
          {section(fresh.length > 0 ? "Everything else" : "All builds", rest)}
          {visible.length > shown.length && (
            <div className="card row space-between wrap">
              <span className="muted small">
                Showing {shown.length} of {visible.length}
              </span>
              <button onClick={() => setView({ limit: view.limit + PAGE })}>Show {PAGE} more</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
