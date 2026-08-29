# GW1 Build Planner

A build-planning tool for **Guild Wars 1** (the original 2005 game — NOT Guild Wars 2).
It answers: "given what my character has unlocked, which skills can I get right now,
and from where?"

## Repo layout

- `/scraper` — Node/TypeScript scripts that fetch and parse wiki data into JSON.
- `/data` — committed JSON datasets (the scraper's output). Fixtures live in `/data/fixtures`.
- `/engine` — pure TypeScript library: types, JSON Schemas, availability/build logic. **No UI dependencies.**
- `/app` — static React app (Vite). No backend — it loads the committed JSON from `/data`.
- `/export` — Obsidian vault generator.

npm workspaces from the root; run engine tests with `npm test -w engine`.

## Domain rules (Guild Wars 1)

### Professions
- A character has exactly **1 primary profession, fixed at creation**.
- A character may unlock **multiple secondary professions** over time; a build selects
  one of them. The primary can **never** also be a secondary.
- 10 professions total: 6 core (Warrior, Ranger, Monk, Necromancer, Mesmer, Elementalist)
  and 4 expansion (Assassin, Ritualist, Paragon, Dervish).

### Builds
- A build is exactly **8 skill slots** (slots may be empty/null).
- At most **1 elite skill** per build.
- Every skill in a build must belong to the character's **primary profession**, the
  build's **currently-selected secondary**, or be a **no-profession/common skill**.

### Skill state
- Skills are modeled at **character level only** (skills the character knows).
- **Account-wide unlocks are explicitly out of scope for the PoC.**

### Skill acquisition channels (all in scope)
1. **Skill trainers** — NPCs located in outposts/towns.
2. **Quest rewards**.
3. **Elite capture** — Signet of Capture used on a boss that uses the elite skill.

### Availability logic
- **Purchasable now**: a trainer skill, if its trainer is in an outpost the character
  has unlocked.
- **Capturable now**: an elite, if a boss using it spawns in an explorable area
  **adjacent to any unlocked outpost**. ⚠ SIMPLIFICATION — real reachability can span
  multiple explorables; flag this in code comments wherever implemented.
- **Questable**: a quest skill, if the quest is given from an unlocked outpost or an
  explorable adjacent to one. ⚠ Same adjacency simplification — flag in code comments.

### Scope limits
- **Prophecies campaign only.**
- **Normal mode only** — ignore hard mode skills and stats everywhere.
- **Attributes / attribute point spreads: out of scope**, EXCEPT that build template
  codes encode them — always export template codes with all attributes at 0.

## Data source

- Everything comes from https://wiki.guildwars.com via its **MediaWiki API**
  (`https://wiki.guildwars.com/api.php`).
- **Never scrape rendered HTML.** Always fetch raw wikitext and parse the
  infobox/section templates.
- Be polite: **max 1 request/second**, descriptive User-Agent, **cache everything**
  (scraper caches raw wikitext on disk so re-runs don't re-fetch).

## Conventions

- **All cross-entity references are by wiki page name** (the stable key), e.g.
  `"Healing Breeze"`, `"Yak's Bend"`. Ref types (`SkillRef`, `LocationRef`, …) are
  string aliases in `/engine/src/types.ts`.
- TypeScript types and their matching JSON Schemas both live in
  `/engine/src/types.ts`; keep them in sync when either changes.
- Fixture and scraped JSON must validate against those schemas (see
  `/engine/test/fixtures.test.ts`).
- `gwSkillId` is the numeric in-game skill id from the wiki infobox — required for
  generating build template codes.
