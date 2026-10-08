import { useMemo } from "react";
import { SKILL_TAG_FACETS, tagKeys, type Skill, type SkillTags } from "@gw1/engine";

/** "facet:value" -> the words shown on a chip, e.g. "inflicts:Bleeding" -> "Inflicts Bleeding". */
export function tagLabel(key: string): string {
  const [facet, value] = key.split(/:(.*)/s);
  if (facet === "inflicts") return `Inflicts ${value}`;
  if (facet === "worksWith") return `Works with: ${value}`;
  if (facet === "damage") return value === "Untyped" ? "Untyped damage" : `${value} damage`;
  if (facet === "weapon") return `${value} attack`;
  if (facet === "target") return value === "No target" ? value : `Targets: ${value}`;
  return value;
}

/** Does a skill carry the picked tags? "all" narrows, "any" widens. */
export function matchesTags(skill: Skill, picked: string[], mode: "all" | "any"): boolean {
  if (picked.length === 0) return true;
  const keys = tagKeys(skill.tags);
  return mode === "all" ? picked.every((k) => keys.has(k)) : picked.some((k) => keys.has(k));
}

/**
 * Tag chips, one row per facet. Each chip shows how many of the skills
 * currently listed carry it, and a facet only offers values that occur, so
 * a Warrior is not offered "Creates a spirit".
 */
export function SkillTagFilter({
  skills,
  picked,
  mode,
  onToggle,
  onMode,
  onClear,
}: {
  /** The skills the other filters leave, before tags are applied. */
  skills: Skill[];
  picked: string[];
  mode: "all" | "any";
  onToggle: (key: string) => void;
  onMode: (mode: "all" | "any") => void;
  onClear: () => void;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of skills) for (const k of tagKeys(s.tags)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [skills]);

  return (
    <div className="card tag-filter">
      <div className="row wrap tag-filter-head">
        <span className="muted small">Show skills that match</span>
        <label className="inline-check">
          <input type="radio" name="tag-mode" checked={mode === "all"} onChange={() => onMode("all")} />
          every tag picked
        </label>
        <label className="inline-check">
          <input type="radio" name="tag-mode" checked={mode === "any"} onChange={() => onMode("any")} />
          any tag picked
        </label>
        {picked.length > 0 && (
          <button className="small" onClick={onClear}>
            Clear tags
          </button>
        )}
      </div>
      {SKILL_TAG_FACETS.map(({ key, label, values }) => {
        const offered = values.filter((v) => counts.has(`${key}:${v}`) || picked.includes(`${key}:${v}`));
        if (offered.length === 0) return null;
        return (
          <div className="tag-facet" key={key}>
            <span className="tag-facet-label muted small">{label}</span>
            <span className="tag-chips">
              {offered.map((v) => {
                const k = `${key}:${v}`;
                const on = picked.includes(k);
                return (
                  <button
                    key={k}
                    className={on ? "tag-chip on" : "tag-chip"}
                    aria-pressed={on}
                    onClick={() => onToggle(k)}
                  >
                    {v} <span className="muted">{counts.get(k) ?? 0}</span>
                  </button>
                );
              })}
            </span>
          </div>
        );
      })}
      <p className="muted small no-margin">
        Tags are read from each skill's description, so an unusual wording can be missed.
      </p>
    </div>
  );
}

/** A skill's own tags, as small chips. Clicking one filters by it. */
export function SkillTagList({ tags, onPick }: { tags: SkillTags | undefined; onPick?: (key: string) => void }) {
  const keys = [...tagKeys(tags)];
  if (keys.length === 0) return null;
  return (
    <p className="tag-list no-margin">
      {keys.map((k) =>
        onPick ? (
          <button key={k} className="tag-chip small-chip" onClick={() => onPick(k)} title="Filter by this tag">
            {tagLabel(k)}
          </button>
        ) : (
          <span key={k} className="quest-tag">
            {tagLabel(k)}
          </span>
        ),
      )}
    </p>
  );
}
