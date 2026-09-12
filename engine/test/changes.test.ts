/**
 * Recent-change logic, plus schema validation of the real change log.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import {
  balanceChanges,
  cutoffDate,
  diffVersion,
  indexChanges,
  lastChangedOn,
  schemas,
  type Skill,
  type SkillChangeLog,
  type SkillVersion,
} from "../src/index.js";

const log: SkillChangeLog = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../data/skill-changes.json", import.meta.url)), "utf8"),
);

const ASOF = new Date("2026-09-12T00:00:00Z");

function makeLog(skills: SkillChangeLog["skills"]): SkillChangeLog {
  return { generatedAt: "2026-09-12", since: "2025-09-12", windowMonths: 12, skills };
}

describe("indexChanges", () => {
  it("keeps only skills with a balance change inside the window", () => {
    const idx = indexChanges(
      makeLog([
        { skill: "Recent", changes: [{ date: "2026-08-01", note: "buffed", kind: "balance", section: null }], previous: null, previousIsStale: false },
        { skill: "Old", changes: [{ date: "2025-10-01", note: "buffed", kind: "balance", section: null }], previous: null, previousIsStale: false },
        { skill: "AiOnly", changes: [{ date: "2026-08-01", note: "hero targeting", kind: "ai", section: null }], previous: null, previousIsStale: false },
      ]),
      6,
      ASOF,
    );
    expect([...idx.recentlyChanged.keys()]).toEqual(["Recent"]);
    expect(idx.since).toBe(cutoffDate(ASOF, 6));
  });

  it("drops out-of-window changes from a record it keeps", () => {
    const idx = indexChanges(
      makeLog([
        {
          skill: "Twice",
          changes: [
            { date: "2026-08-01", note: "new", kind: "balance", section: null },
            { date: "2025-10-01", note: "ancient", kind: "balance", section: null },
          ],
          previous: null,
          previousIsStale: false,
        },
      ]),
      6,
      ASOF,
    );
    expect(idx.recentlyChanged.get("Twice")!.changes).toHaveLength(1);
  });

  it("survives a missing log", () => {
    expect(indexChanges(null).recentlyChanged.size).toBe(0);
  });
});

describe("diffVersion", () => {
  const previous: SkillVersion = {
    date: "2008-12-11", label: "December 11, 2008",
    energyCost: 5, adrenalineCost: null, sacrificePercent: null, upkeep: null,
    activation: 1, recharge: 15, attribute: "Fast Casting", isElite: true,
    description: "For 1...31 seconds.",
  };
  const current = {
    energyCost: 5, adrenalineCost: null, sacrificePercent: null, upkeep: null,
    activation: 1, recharge: 10, attribute: "Fast Casting", isElite: true,
    description: "For 6...40 seconds.",
  } as Skill;

  it("reports only the fields that differ", () => {
    expect(diffVersion(previous, current)).toEqual([
      { field: "Recharge", before: "15s", after: "10s" },
      { field: "Description", before: "For 1...31 seconds.", after: "For 6...40 seconds." },
    ]);
  });

  it("ignores fields absent on either side rather than calling it a change", () => {
    // An adrenaline skill has no energy cost; a null is 'not applicable',
    // not 'changed to nothing'.
    const adrenaline = { ...previous, energyCost: null, adrenalineCost: 8 };
    const diffs = diffVersion(adrenaline, current);
    expect(diffs.map((d) => d.field)).not.toContain("Energy");
    expect(diffs.map((d) => d.field)).not.toContain("Adrenaline");
  });
});

describe("the real change log", () => {
  it("validates against the schema", () => {
    const ajv = new Ajv({ allErrors: true });
    for (const schema of Object.values(schemas)) ajv.addSchema(schema);
    const validate = ajv.getSchema("gw1-skill-change-log")!;
    expect(validate(log), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("names only skills that exist in the dataset", () => {
    const skills = new Set(
      (JSON.parse(
        readFileSync(fileURLToPath(new URL("../../data/skills.json", import.meta.url)), "utf8"),
      ) as Skill[]).map((s) => s.wikiPage),
    );
    for (const record of log.skills) expect(skills.has(record.skill), record.skill).toBe(true);
  });

  it("has a balance change in the last 6 months for a decent share of them", () => {
    const idx = indexChanges(log, 6, ASOF);
    expect(idx.recentlyChanged.size).toBeGreaterThan(50);
  });

  it("orders every record's changes newest first", () => {
    for (const record of log.skills) {
      const dates = record.changes.map((c) => c.date);
      expect(dates).toEqual([...dates].sort().reverse());
    }
  });

  it("never dates a previous-version snapshot at or after the change it precedes", () => {
    for (const record of log.skills) {
      const latest = lastChangedOn(record) ?? record.changes[0].date;
      if (record.previous?.date) expect(record.previous.date < latest, record.skill).toBe(true);
    }
  });

  it("only records balance changes with real note text", () => {
    for (const record of log.skills) {
      for (const c of balanceChanges(record)) expect(c.note.length).toBeGreaterThan(3);
    }
  });
});
