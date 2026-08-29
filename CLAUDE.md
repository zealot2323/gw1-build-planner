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
- **Normal mode is the default everywhere.** Availability logic (what a character
  can get) is normal-mode only. The zone browser additionally offers a hard mode
  toggle for viewing monster levels and bars — see Data decisions below.
- **Attributes / attribute point spreads: out of scope**, EXCEPT that build template
  codes encode them — always export template codes with all attributes at 0.

## Data source

- Everything comes from https://wiki.guildwars.com via its **MediaWiki API**
  (`https://wiki.guildwars.com/api.php`).
- **Never scrape rendered HTML.** Always fetch raw wikitext and parse the
  infobox/section templates.
- Be polite: **max 1 request/second**, descriptive User-Agent, **cache everything**
  (scraper caches raw wikitext on disk so re-runs don't re-fetch).
- **Skill icons**: `npm run icons` resolves each skill's `File:<name>.jpg` via the
  API (imageinfo, 50 titles/request) and downloads it to
  `/app/public/icons/<gwSkillId>.jpg` — committed, and already-present icons are
  never refetched. `gwSkillId` is the filename key, so icons survive renames.

## Data decisions

- **Trainer lists are the source of truth** for who sells a skill. Each
  skill's `acquisition.trainers` is derived from the trainer lists at parse
  time; the skill page's own trainer list is ignored when they disagree.
- **Pre-Searing is out of scope for now**: monsters whose infobox level has no
  hard-mode value (no parentheses) AND is <= 12 are pre-Searing creatures and
  are skipped (the level cap protects high-level boss pages that also omit
  the hard-mode level).
- Bosses legitimately have no elite at any level — never flag that. Capture
  coverage is validated from the skill side instead: each unconditional
  capture boss must exist in the bestiary and list the skill.
- **Capture sources are split**: `captureBosses` (always spawn) vs
  `conditionalCaptureBosses` (spawn only during a quest/event, or in a
  location outside our Prophecies set, e.g. War in Kryta variants) — quest
  gating is not modeled yet, so availability logic uses only the former.
- **Monsters can have several stat blocks** (20 do). The wiki keys them three
  ways: by encounter level ("Level 12" / "Level 28" — Riine Windrot), by zone
  ("Gates of Kryta", "During Iron Mines of Moladune"), or by loadout ("Ranger
  version"). The parser emits `variants[]` plus `locationLevels` (from the
  "(level N)" annotations on Locations/Missions groups); the engine's
  `variantsForLocation` picks by zone name, then by level, then falls back to
  showing every loadout. Anything showing a monster must go through it —
  a creature's level and skill bar are per-zone facts, not page-level ones.
- **Hard mode is parsed, not discarded**: hard-mode-only skills land in a
  variant's `hardModeSkills`, whole hard-mode blocks get `hardMode: true`, and
  the infobox's parenthesized level becomes `levelHard`. The zone browser has
  a hard mode toggle; `monstersInLocation(loc, index, hardMode)` and
  `variantsForLocation(..., hardMode)` select between them. Page-level
  `skills` stays normal-mode.
- **Capture availability is variant-scoped**: `locationsWithSkill` only counts
  zones where the boss's applicable block actually carries the skill, so a
  boss's high-level elite is not capturable at its low-level spawns (Riine
  Windrot's Offering of Blood is Thunderhead Keep only).
- **Infobox level strings are messy.** "<br>" separates individual entries on
  some pages ("1 (22),<br>4 (22),<br>8 (23),<br>15") and whole campaign groups
  on others ("5, 6 (23)<br>10, 12, 14") — a group containing a comma marks the
  latter, and only the first group counts. Entries carrying a hard-mode value
  are real encounters; when some do and some don't, the bare ones are
  event-only versions and are dropped (Carrion Devourer's "15" is the April
  Fools zone).
- April Fools content (Annihilation Day, "Lakeside County: 1070 AE") is
  excluded from locations and monster loadouts.
- Pre-Searing Ascalon locations are flagged (`preSearing`) from the overrides
  list so the zone browser can offer a pre/post-Searing toggle; the wiki's
  own pre/post split is lost when discovery flattens the lists.
- Infobox levels read "7 (23) [30]": bare = normal, parens = hard mode,
  brackets = a special (Titan quest) version — only the bare number is the
  normal-mode level.
- Monster Skills sections are filtered to Prophecies normal-mode blocks:
  campaign/Beyond/event/cinematic sub-blocks and headings (Eye of the North,
  War in Kryta, Halloween, The Mausoleum, ...) are excluded; encounter-level
  and mission-name subsections are included. Wiki redirects among monster
  pages (typos like "Gren Waveslosh") are followed to the canonical page.
- Monster pages missing an infobox, locations, or skills are usually species
  summary pages — parse what's there, don't flag.
- **Armor is summarized, not dumped**: `armorProfile` reduces the 7-row table
  to a median baseline plus the damage types that deviate (weak vs / tough
  vs). The median matters — the mode ties on the common 3-physical /
  3-elemental split and picks an arbitrary side.
- **Zone briefings** (`zoneSummary`) tag what a zone throws at you (Heavy AoE,
  Interrupts, Energy denial, ...) from skill descriptions, since the wiki has
  no structured field for it. Judgement calls baked in:
  - Patterns are word-anchored: a bare "heal" substring also matches
    "Health", which tagged every damage skill as healing.
  - "Heavy AoE" means area *pressure*, not an area *shape*. Heal Area hits an
    area but heals the enemy's own side (that's Enemy healing); an area hex
    or area condition IS AoE pressure even with no direct damage.
  - Friendly-target skills never earn offensive tags.
  - A tag backed by a single skill is noise, so it drops to `minorThreats`.
- **Damage-type notes** come from `affiliation`, not species: `affiliation =
  Undead` (64 monsters) is the reliable marker for the holy-damage weakness,
  since the Zombie/Skeleton species labels are inconsistent.
- Manual corrections (wiki typos, non-locations like Lion's Gate, PvP arenas,
  progression-gated connections such as Ring of Fire -> Abaddon's Mouth ->
  Hell's Precipice, trainer list omissions) live in
  `/scraper/src/overrides.ts`, each with a WHY comment. Add new corrections
  there, never inline in parsers.

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
