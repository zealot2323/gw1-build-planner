import { useMemo, useState } from "react";

/** Searchable multi-select checklist. Thin: takes options, reports changes. */
export function Checklist({
  label,
  options,
  selected,
  onChange,
  detail,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Optional per-option annotation, e.g. a location's kind. */
  detail?: (option: string) => string | null;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const q = query.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (option: string) =>
    onChange(selectedSet.has(option) ? selected.filter((s) => s !== option) : [...selected, option]);

  return (
    <div className="checklist">
      <div className="checklist-head">
        <span>
          {label} <span className="muted">({selected.length}/{options.length})</span>
        </span>
        <input
          type="search"
          placeholder="filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="checklist-body">
        {visible.map((o) => (
          <label key={o} className="checklist-row">
            <input type="checkbox" checked={selectedSet.has(o)} onChange={() => toggle(o)} />
            <span>{o}</span>
            {detail?.(o) && <span className="muted tag">{detail(o)}</span>}
          </label>
        ))}
        {visible.length === 0 && <div className="muted pad">no matches</div>}
      </div>
    </div>
  );
}
