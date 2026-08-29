import { useMemo, useState } from "react";

export interface ChecklistGroup {
  label: string;
  options: string[];
}

/** Searchable multi-select checklist. Thin: takes options, reports changes. */
export function Checklist({
  label,
  options,
  groups,
  selected,
  onChange,
  detail,
  icon,
}: {
  label: string;
  /** Flat options; ignored when `groups` is given. */
  options?: string[];
  /** Grouped options rendered with sticky group headers (e.g. by region). */
  groups?: ChecklistGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Optional per-option annotation, e.g. a location's kind. */
  detail?: (option: string) => string | null;
  /** Optional per-option thumbnail image URL. */
  icon?: (option: string) => string | null;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allGroups: ChecklistGroup[] = groups ?? [{ label: "", options: options ?? [] }];
  const total = allGroups.reduce((n, g) => n + g.options.length, 0);

  const q = query.toLowerCase();
  const visibleGroups = allGroups
    .map((g) => ({ ...g, options: g.options.filter((o) => o.toLowerCase().includes(q)) }))
    .filter((g) => g.options.length > 0);

  const toggle = (option: string) =>
    onChange(selectedSet.has(option) ? selected.filter((s) => s !== option) : [...selected, option]);

  return (
    <div className="checklist">
      <div className="checklist-head">
        <span>
          {label} <span className="muted">({selected.length}/{total})</span>
        </span>
        <input
          type="search"
          placeholder="filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="checklist-body">
        {visibleGroups.map((g) => (
          <div key={g.label}>
            {g.label && <div className="checklist-group">{g.label}</div>}
            {g.options.map((o) => (
              <label key={o} className="checklist-row">
                <input type="checkbox" checked={selectedSet.has(o)} onChange={() => toggle(o)} />
                {icon?.(o) && (
                  <img
                    className="mini-icon"
                    src={icon(o)!}
                    alt=""
                    loading="lazy"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                  />
                )}
                <span>{o}</span>
                {detail?.(o) && <span className="muted tag">{detail(o)}</span>}
              </label>
            ))}
          </div>
        ))}
        {visibleGroups.length === 0 && <div className="muted pad">no matches</div>}
      </div>
    </div>
  );
}
