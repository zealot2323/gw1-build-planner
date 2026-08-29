/**
 * Shared wikitext parsing helpers. Wiki data is hand-edited and
 * inconsistent — nothing in here may throw on weird input; parsers return
 * null / empty results instead and let callers record issues.
 */

/** First [[link]] target in a string, or null. */
export function firstLinkTarget(text: string): string | null {
  const m = text.match(/\[\[([^\]|#]+)/);
  return m ? m[1].trim() : null;
}

/** All [[link]] targets in a chunk of wikitext. */
export function linkTargets(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
}

/**
 * Find the first {{TemplateName ...}} template and return its parameters.
 * Handles nested templates and links when splitting on top-level pipes.
 * Positional params get keys "1", "2", ... Returns null if not present.
 */
export function parseTemplate(wikitext: string, name: string): Record<string, string> | null {
  const re = new RegExp(`\\{\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[|}]`, "i");
  const m = wikitext.match(re);
  if (!m || m.index === undefined) return null;

  // scan from the opening braces, tracking {{ }} and [[ ]] depth
  const start = m.index;
  let depth = 0;
  let i = start;
  const parts: string[] = [];
  let cur = "";
  while (i < wikitext.length) {
    const two = wikitext.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      cur += two;
      i += 2;
    } else if (two === "}}" || two === "]]") {
      depth--;
      if (depth === 0) break; // closed the template itself
      cur += two;
      i += 2;
    } else if (wikitext[i] === "|" && depth === 1) {
      parts.push(cur);
      cur = "";
      i++;
    } else {
      cur += wikitext[i];
      i++;
    }
  }
  parts.push(cur);

  const params: Record<string, string> = {};
  let positional = 0;
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    // "=" inside a value (e.g. a link with "=") only counts when the left
    // side looks like a parameter name
    const key = eq >= 0 ? part.slice(0, eq).trim() : null;
    if (key !== null && /^[\w' -]+$/.test(key)) {
      params[key.toLowerCase()] = part.slice(eq + 1).trim();
    } else {
      params[String(++positional)] = part.trim();
    }
  }
  return params;
}

export interface Section {
  level: number;
  title: string;
  /** Body text: from after the heading to the next heading of any level. */
  body: string;
  /** Titles of enclosing headings (for e.g. hard-mode context checks). */
  ancestors: string[];
}

/** Split a page into heading-delimited sections (heading levels 2-5). */
export function sections(wikitext: string): Section[] {
  const matches = [...wikitext.matchAll(/^(={2,5})\s*(.+?)\s*\1\s*$/gm)];
  const out: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const level = matches[i][1].length;
    const title = matches[i][2].replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[|\]\]/g, "").trim();
    const from = matches[i].index! + matches[i][0].length;
    const to = i + 1 < matches.length ? matches[i + 1].index! : wikitext.length;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    out.push({ level, title, body: wikitext.slice(from, to), ancestors: stack.map((s) => s.title) });
    stack.push({ level, title });
  }
  return out;
}

/** Strip wiki markup from a description-like value into readable plain text. */
export function stripMarkup(text: string): string {
  return text
    .replace(/\{\{gr\|([^|}]*)\|([^|}]*)[^}]*\}\}/gi, "$1...$2") // {{gr|1|20|+}} → 1...20
    .replace(/\{\{gray\|([^}]*)\}\}/gi, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "") // any other leaf template
    .replace(/\{\{[^{}]*\}\}/g, "") // once more for one nesting level
    .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Like stripMarkup but preserves <br> as a literal separator — infobox
 * level strings use it to delimit entries or campaign groups.
 */
export function stripMarkupKeepBreaks(text: string): string {
  return stripMarkup(text.replace(/<br\s*\/?>/gi, " <br> "));
}

/** Parse a wiki numeric value ("5", "¼", "3/4", "0.25", "10%"→null). */
export function parseWikiNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const v = stripMarkup(value).trim();
  const unicode: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  if (v in unicode) return unicode[v];
  const frac = v.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const num = v.match(/^-?\d+(\.\d+)?/);
  return num ? Number(num[0]) : null;
}

/** Map wiki profession names/abbreviations to canonical profession names. */
export function normalizeProfession(value: string | undefined): string | null {
  if (!value) return null;
  const v = stripMarkup(value).trim().toLowerCase();
  const map: Record<string, string> = {
    w: "Warrior", warrior: "Warrior",
    r: "Ranger", ranger: "Ranger",
    mo: "Monk", monk: "Monk",
    n: "Necromancer", necromancer: "Necromancer",
    me: "Mesmer", mesmer: "Mesmer",
    e: "Elementalist", elementalist: "Elementalist",
    a: "Assassin", assassin: "Assassin",
    rt: "Ritualist", ritualist: "Ritualist",
    p: "Paragon", paragon: "Paragon",
    d: "Dervish", dervish: "Dervish",
  };
  return map[v] ?? null;
}
