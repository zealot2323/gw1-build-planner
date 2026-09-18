/**
 * Import-file parsing. The point is that a file can arrive in whatever
 * shape someone's spreadsheet or scrape produced, and still be read.
 */
import { describe, expect, it } from "vitest";
import { parseImportFile } from "../src/community.js";

describe("parseImportFile", () => {
  it("reads a JSON array of objects, whatever the columns are called", () => {
    const rows = parseImportFile(
      JSON.stringify([
        { Name: "Bonder", "Template Code": "OwAT...", By: "someone", Link: "https://example.invalid", Notes: "keeps bonds" },
      ]),
    );
    expect(rows[0]).toMatchObject({
      code: "OwAT...",
      name: "Bonder",
      author: "someone",
      url: "https://example.invalid",
      notes: "keeps bonds",
    });
  });

  it("reads a JSON array of bare codes", () => {
    expect(parseImportFile('["OQAT1", "OQAT2"]').map((r) => r.code)).toEqual(["OQAT1", "OQAT2"]);
  });

  it("reads an object with a builds array", () => {
    expect(parseImportFile('{"builds":[{"code":"OQAT1"}]}')[0].code).toBe("OQAT1");
  });

  it("reads CSV with quoted fields containing commas", () => {
    const csv = ['name,code,notes', '"Bonder, 55hp",OQAT1,"Keep bonds up, never drop it"'].join("\n");
    const rows = parseImportFile(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Bonder, 55hp");
    expect(rows[0].notes).toBe("Keep bonds up, never drop it");
  });

  it("reads TSV", () => {
    const rows = parseImportFile("name\tcode\nSpike\tOQAT9");
    expect(rows[0]).toMatchObject({ name: "Spike", code: "OQAT9" });
  });

  it("splits tags on the usual separators", () => {
    expect(parseImportFile("name,code,tags\nX,OQAT1,PvE;farming").at(0)?.tags).toEqual(["PvE", "farming"]);
    expect(parseImportFile('[{"code":"OQAT1","tags":["PvE","farming"]}]').at(0)?.tags).toEqual(["PvE", "farming"]);
  });

  it("falls back to one row per line, keeping the line as context", () => {
    const rows = parseImportFile("Great warrior bar OQAT1 from the forums\nAnother OQAT2");
    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toContain("Great warrior bar");
    // no code column: the importer scans the text instead
    expect(rows[0].code).toBeUndefined();
  });
});
