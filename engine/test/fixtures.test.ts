import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { schemas } from "../src/types.js";

const ajv = new Ajv({ allErrors: true });
for (const schema of Object.values(schemas)) {
  ajv.addSchema(schema);
}

function loadFixture(file: string): unknown[] {
  const path = fileURLToPath(new URL(`../../data/fixtures/${file}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

const cases: Array<{ file: string; schemaId: string }> = [
  { file: "skills.json", schemaId: "gw1-skill" },
  { file: "locations.json", schemaId: "gw1-location" },
  { file: "trainers.json", schemaId: "gw1-trainer" },
  { file: "monsters.json", schemaId: "gw1-monster" },
];

describe("fixture data validates against JSON Schemas", () => {
  for (const { file, schemaId } of cases) {
    it(`${file} matches ${schemaId}`, () => {
      const validate = ajv.getSchema(schemaId);
      expect(validate).toBeDefined();
      for (const entity of loadFixture(file)) {
        const ok = validate!(entity);
        expect(ok, ajv.errorsText(validate!.errors)).toBe(true);
      }
    });
  }
});

describe("fixture cross-references resolve", () => {
  const skills = loadFixture("skills.json") as Array<{ name: string; acquisition: { trainers: string[]; captureBosses: string[] } }>;
  const locations = loadFixture("locations.json") as Array<{ name: string; trainer?: string; foes: string[] }>;
  const trainers = loadFixture("trainers.json") as Array<{ name: string; location: string; skillsOffered: string[] }>;
  const monsters = loadFixture("monsters.json") as Array<{ name: string; skills: string[]; bossElite?: string }>;

  const skillNames = new Set(skills.map((s) => s.name));
  const locationNames = new Set(locations.map((l) => l.name));
  const trainerNames = new Set(trainers.map((t) => t.name));
  const monsterNames = new Set(monsters.map((m) => m.name));

  it("trainer refs on skills exist", () => {
    for (const s of skills) {
      for (const t of s.acquisition.trainers) expect(trainerNames).toContain(t);
      for (const b of s.acquisition.captureBosses) expect(monsterNames).toContain(b);
    }
  });

  it("trainer locations and offered skills exist", () => {
    for (const t of trainers) {
      expect(locationNames).toContain(t.location);
      for (const s of t.skillsOffered) expect(skillNames).toContain(s);
    }
  });

  it("location trainers and foes exist", () => {
    for (const l of locations) {
      if (l.trainer) expect(trainerNames).toContain(l.trainer);
      for (const f of l.foes) expect(monsterNames).toContain(f);
    }
  });

  it("monster skills and boss elites exist", () => {
    for (const m of monsters) {
      for (const s of m.skills) expect(skillNames).toContain(s);
      if (m.bossElite) expect(skillNames).toContain(m.bossElite);
    }
  });
});

describe("scraped quests validate against the quest schema", () => {
  it("data/quests.json matches gw1-quest", () => {
    const path = fileURLToPath(new URL("../../data/quests.json", import.meta.url));
    const quests = JSON.parse(readFileSync(path, "utf8")) as unknown[];
    const validate = ajv.getSchema("gw1-quest")!;
    expect(quests.length).toBeGreaterThan(100);
    for (const q of quests) expect(validate(q), ajv.errorsText(validate.errors)).toBe(true);
  });
});
