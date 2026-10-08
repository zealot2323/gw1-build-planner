/**
 * PvP skill splits:  npm run pvp
 *
 * Writes data/pvp-skills.json: for every skill in data/skills.json that the
 * game balances separately for PvP, the split's id, text and numbers.
 *
 * Discovery skips the wiki's "X (PvP)" pages, and that stays right — a split
 * is not a skill you learn, trainers don't sell it and bosses don't carry
 * it. What it changes is how the skill PLAYS, and the game client says that
 * exactly: each gwtoolbox-api skill names its twin in `pvp_skill_id`, and
 * the twin carries `pvp_only`. So this reads the cached API files only and
 * runs offline, like `parse`.
 *
 * Its own file rather than a field in skills.json, so it can be regenerated
 * without re-running the wiki parse. The engine attaches it at load time
 * (`attachPvpVersions`).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PvpSkillsFile, Skill, SkillPvpVersion } from "@gw1/engine";
import { adrenalineStrikes, loadGwToolbox } from "./gwtoolbox.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

const skills: Skill[] = JSON.parse(await readFile(`${DATA_DIR}skills.json`, "utf8"));
const toolbox = await loadGwToolbox();

const out: PvpSkillsFile = { source: "api.gwtoolbox.com (pvp_skill_id)", skills: {} };
const problems: string[] = [];

for (const skill of skills) {
  const pve = toolbox.skills.get(skill.gwSkillId);
  if (!pve?.pvp_skill_id || pve.pvp_only) continue;
  const twin = toolbox.skills.get(pve.pvp_skill_id);
  if (!twin) {
    problems.push(`${skill.name}: PvP id ${pve.pvp_skill_id} is not in the API`);
    continue;
  }
  // The pair must point at each other, and the twin must be the PvP side.
  if (!twin.pvp_only || twin.pvp_skill_id !== skill.gwSkillId) {
    problems.push(`${skill.name}: ${twin.id} is not its PvP twin`);
    continue;
  }
  const version: SkillPvpVersion = {
    gwSkillId: twin.id,
    // The wiki titles every split "<name> (PvP)", as the client names it.
    // (the client double-spaces a few: "Aegis  (PvP)")
    wikiPage: twin.name ? twin.name.replace(/\s+/g, " ").trim() : `${skill.wikiPage} (PvP)`,
    description: twin.description ?? "",
    ...(twin.concise ? { concise: twin.concise } : {}),
    energyCost: twin.energy_cost ?? null,
    adrenalineCost: adrenalineStrikes(twin.adrenaline),
    sacrificePercent: twin.health_cost ?? null,
    activation: twin.activation ?? 0,
    aftercast: twin.aftercast ?? 0,
    exhaustion: twin.overcast ?? null,
    recharge: twin.recharge ?? 0,
  };
  if (version.wikiPage !== `${skill.name} (PvP)`) {
    problems.push(`${skill.name}: twin is named "${version.wikiPage}"`);
  }
  out.skills[skill.wikiPage] = version;
}

// The API also lists ~20 PvP-only skills whose PvE side no longer names
// them (Energy Drain, Panic, ...): splits the game has since merged back.
// The PvE side is the authority, so those are left out.
const oneWay = [...toolbox.skills.values()].filter(
  (s) => s.pvp_only && s.pvp_skill_id && toolbox.skills.get(s.pvp_skill_id)?.pvp_skill_id !== s.id,
).length;
await writeFile(`${DATA_DIR}pvp-skills.json`, JSON.stringify(out, null, 1) + "\n", "utf8");
console.log(
  `pvp-skills.json: ${Object.keys(out.skills).length} PvP splits ` +
    `(${oneWay} merged-back PvP ids skipped)`,
);
for (const p of problems) console.log(`  ! ${p}`);
