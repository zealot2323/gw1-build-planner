# GW1 Build Planner

A build-planning tool for **Guild Wars 1** (the original 2005 game — NOT Guild Wars 2).
It answers: "given what my character has unlocked, which skills can I get right now,
and from where?"

## Repo layout

- `/scraper` — Node/TypeScript scripts that fetch and parse wiki data into JSON.
- `/data` — committed JSON datasets (the scraper's output). Fixtures live in `/data/fixtures`.
  `skill-changes.json` is the recent-game-updates log; `quests.json` the quests
  that reward skills (see Data decisions).
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
- **All four releases**: Prophecies, Factions, Nightfall, Eye of the North.
  EotN is an **expansion**, not a campaign: nobody starts there, so it never
  appears as a home campaign — only as one a character owns. Its instanced
  content is 18 **dungeons** rather than missions, and they carry a Location
  infobox (region, exits, foes), so they parse as locations with
  `kind: "dungeon"` rather than through the mission parser.
- **Campaigns are separate continents.** A character has a home campaign and
  a set of owned campaigns; `scopedDataset` narrows the whole dataset before
  indexing, so availability, travel distance, proximity and zone browsing are
  all campaign-correct without each having to filter. Characters saved
  without a campaign see everything (back-compat).
- **Normal mode is the default everywhere.** Availability logic (what a character
  can get) is normal-mode only. The zone browser additionally offers a hard mode
  toggle for viewing monster levels and bars — see Data decisions below.
- **Attributes ARE in scope for builds** (they were not originally): a build
  carries `attributes` (rank by name), template codes read and write them,
  and `validateBuild` checks them. Rules modelled: 200 points at level 20,
  the game's cumulative rank costs (rank 12 = 97 points), rank 12 as the
  ceiling points can buy, and the secondary profession's PRIMARY attribute
  being unavailable (no W/Mo has Divine Favor). Runes and headgear, which
  push a rank past 12, are not modelled. Title-track "attributes" (Sunspear
  rank, Asura rank, Allegiance rank) scale with a title, not points, and are
  excluded from the editor. Attribute ids come from gw1tools/gw1builds (MIT)
  and were cross-checked against our own scraped attribute names.

## Data source

- Campaign entry points live in `/scraper/src/campaigns.ts`. The wiki's page
  layouts differ per campaign in ways that bite:
  - **Trainer lists**: Prophecies uses "=== [[Name]] in [[Place]] ===" headings;
    every other campaign generates its list with a DPL query, so the trainers
    are not in the wikitext at all. Discovery uses the
    "<Campaign> skill trainers" **category** instead, for all campaigns.
  - **Trainer stock**: Prophecies keeps it on a "<Name>/Skills" subpage;
    others put {{Skill trainer list}} on the trainer's own page.
  - **Skill enumeration walks all ten professions for every campaign** — a
    campaign ships skills for professions it did not introduce (Nightfall
    adds Assassin and Ritualist skills).
  - Factions numbers its Kurzick/Luxon mission branches "9a."/"9b.".
  - **Acquisition group headers come in two forms**: bold
    ('''[[Skill trainer]]s''') and definition-list (;[[Skill trainer]]s).
    22 pages use the latter and lost every source until it was handled. The
    capture header is variously "Signet of Capture" or "Skill Capture".
  - EotN's PvE-only skills have **no profession at all**, so the profession
    walk cannot see them; they come from the four rank categories (Asura,
    Deldrimor, Ebon Vanguard, Norn) that the wiki's own list page queries.
  - Quest lines read "(from [[NPC]] in [[Location]])" in EotN — the location
    is the third link, not the second.
  - Pages without an in-game skill id are not skills ("Norn rank",
    "Rebel Yell"); they are dropped.
  - Skill-count guards are per-campaign totals, not a ratio against the raw
    category: only ~43% of EotN's category is learnable (the rest is dungeon
    effects, Norn brawling moves and quest siege skills).
- Everything comes from https://wiki.guildwars.com via its **MediaWiki API**
  (`https://wiki.guildwars.com/api.php`).
- **Never scrape rendered HTML.** Always fetch raw wikitext and parse the
  infobox/section templates.
- Be polite: **max 1 request/second**, descriptive User-Agent, **cache everything**
  (scraper caches raw wikitext on disk so re-runs don't re-fetch).
- **Game updates**: `npm run updates` caches 12 months of patch notes and
  the `/Skill history` subpages of every skill they touch. The app
  highlights a narrower 6-month window (`RECENT_MONTHS` in
  `/engine/src/changes.ts`), so re-windowing is a code change, not a refetch.
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
- **Title-gated skills** (10 Kurzick/Luxon allegiance skills) are a fourth
  acquisition channel: `titleNpcs` with the rank requirement quoted from the
  page. The gate is a rank, not a place, so they are never "available now" —
  they report where to go and what rank is needed. Title progression is not
  tracked per character.
- **Allegiance is a per-character setting** (`Character.allegiance`, default
  Kurzick). Each of those 10 skills exists twice in-game — same effect,
  different skill id and different icon — and the infobox packs both into one
  field, tagging the side only in an HTML comment:
  `id = 1954<!-- Luxon -->, 2097<!-- Kurzick -->`. That comment is the parse
  key; both ids land in `allegianceSkillIds`, and `gwSkillId` keeps whichever
  the wiki lists first. Icons are fetched per side from
  "File:<name> (Kurzick).jpg" / "File:<name> (Luxon).jpg" and saved under each
  side's own id, so the normal `<gwSkillId>.jpg` lookup still works — the app
  just swaps which id it asks for. The character's own side is also sorted
  first in the skill's sources, since the two versions are sold by different
  NPCs in different towns (House zu Heltzer vs Cavalon).
- **Capture sources are split**: `captureBosses` (always spawn) vs
  `conditionalCaptureBosses` (spawn only during a quest/event, or in a
  location outside our Prophecies set, e.g. War in Kryta variants) — quest
  gating is not modeled yet, so availability logic uses only the former.
- **Monsters can have several stat blocks** (20 do). The wiki keys them three
  ways: by encounter level ("Level 12" / "Level 28" — Riine Windrot), by zone
  ("Gates of Kryta", "During Iron Mines of Moladune"), or by loadout ("Ranger
  version"). The parser emits `variants[]` plus `locationLevels` (from the
  "(level N)" annotations on Locations/Missions groups); the engine's
  `variantsForLocation` picks by zone name, then by level, then by campaign
  fit, then falls back to showing every loadout. **Campaign fit**: a bar
  tagged with the zone's campaign wins; otherwise bars tagged for a different
  campaign are dropped; among what remains, one whose skills are all from
  that campaign or Core beats one that isn't. A monster with no bar for this
  campaign keeps what it has — a Nightfall Corsair bar in an EotN tunnel
  beats no bar at all. The zone's own foe LEVEL is more specific and still
  wins over the campaign tag. Anything showing a monster must go through it —
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
- **A zone's own foe line is the best source for encounter level.** Location
  and mission pages list foes as "* {{w}} 8 (23) [[Charr Axe Fiend]]" — that
  8 is the level HERE, whereas the monster page lists every level the
  creature appears at anywhere (Charr Axe Fiend's page says 20, Flash
  Gargoyle's says 3). Parsed into `foeLevels`/`foeLevelsHard` on the
  location, and preferred by `monstersInLocation` over anything on the
  monster page — including for picking the right variant.
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
- Monster Skills sections are filtered to normal-mode PvE blocks:
  event/cinematic blocks (Halloween, The Mausoleum, April Fools, ...) and the
  **Beyond releases — War in Kryta and Winds of Change** — are dropped, since
  they re-arm existing monsters with bars you never meet in the campaign
  zones. Mind the pages that label the ordinary bar "Non-War in Kryta
  version": the exclusion must not eat that one (a negative lookbehind
  guards it). Campaign-labelled blocks are KEPT and tagged instead, so the
  engine can pick per zone; "Bonus Mission Pack" is its own mini-campaign and
  is left untagged rather than counted as EotN. Encounter-level and
  mission-name subsections are included. Wiki redirects among monster
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
- **Recent balance changes** come from "Feedback:Game updates/YYYYMMDD"
  pages (`npm run updates` -> `/data/skill-changes.json`). Judgement calls:
  - The "Game updates" index is DPL-generated, so its wikitext lists
    nothing; the per-year "<year> updates" categories are the entry point.
  - A bullet counts as a change only when it STARTS with {{skill icon|X}};
    a template mid-sentence is prose. One bullet can name several skills.
    Separators drift across "-", ":", "&ndash;" and nothing at all.
  - **"Guild Wars Wiki notes" sections cannot be skipped OR trusted
    wholesale.** The wiki puts genuinely undocumented changes there (the
    only skill content in the 2026-05-04 update is one), alongside
    corrections saying a skill did NOT change and clarifications of
    long-standing behaviour. Bullets there are dropped when they read as a
    negation, and only count as `balance` when a change verb is present as
    a WHOLE WORD — loose stems tagged "additional foes" as "added" and
    "damage reduction" as "reduced".
  - Changes are classified `balance` / `bugfix` / `ai` / `note`; only
    `balance` marks a skill as recently changed. An AI retune changes when
    heroes pick a skill, not what it does.
  - PvP-split versions ("Dash (PvP)", or a "(PvP)" scope marker on the
    bullet) are different skills and out of scope for a PvE planner.
- **The wiki's /Skill history pages lag its patch notes.** Frenzy was
  reworked in August 2026 and its history page still reads "unchanged".
  So the "before" snapshot is whichever dated section is newest but still
  earlier than the change, it is labelled with its OWN date rather than
  presented as the exact pre-patch skill, and `previousIsStale` flags the
  case where another recorded change falls in between. Roughly 60% of
  changed skills have a history page at all.
- **`npm run updates` refetches the skills it finds changes for.** Their
  cached pages predate the patch, and showing a pre-patch skill as current
  while announcing that it just changed is worse than not flagging it.
- **Quests** (`npm run quests` -> `data/quests.json`) are found by following
  the quest links on cached skill pages — never a global crawl — then each
  quest page's {{Quest infobox}} is fetched, because it is authoritative
  where skill pages are not:
  - `given at` wins over the skill page's location (two skill pages put
    Locate Jinzo in different places).
  - `profession` + `primary = y` restricts a quest to that PRIMARY
    profession (template default: primary or secondary). `canTakeQuest`
    enforces it, so a W/A is never sent to Locate Jinzo for Assassin
    skills. `secondary = n` is ambiguous in the template docs and only
    ever appears alongside `primary = y`, so it is not consulted.
  - Skill pages link some quests via redirects or a male/female
    disambiguation page; `manifest.questSources` records the real page(s),
    and aliases of one quest are folded into a single canonical record
    (Rally the Recruits was otherwise split 1/16 across two entries).
  - Quest lines on skill pages come in several shapes: slash-joined quests
    sharing one location, unlinked locations, "(from [[NPC]] in [[Place]])".
    The location lives in the parentheses — "the second link" once turned
    the second of two quests into a place.
  - `precededBy` is shown, not enforced: quest completion isn't tracked.
  - Pre-Searing quests are only offered to a character with a pre-Searing
    location unlocked; the transition is one-way.
- **Travel distance 0 must mean "available now".** The wiki lists many
  one-way links (tutorial starts, mission maps exiting to their outpost,
  portals). The route search stays undirected — a directed one risks
  disconnecting the map — but the distance-0 seed follows the unlocked
  place's OWN exits, exactly like `reachableExplorables`.
- **Patch-note sub-bullets inherit their parent bullet** ("* Sword
  adrenaline reductions:" / "** Sever Artery from 4 to 3"). The parent
  supplies the missing text AND the classification ("* Skill AI
  adjustments:" makes its children `ai`, not `balance`).
- Manual corrections (wiki typos, non-locations like Lion's Gate, PvP arenas,
  progression-gated connections such as Ring of Fire -> Abaddon's Mouth ->
  Hell's Precipice, trainer list omissions) live in
  `/scraper/src/overrides.ts`, each with a WHY comment. Add new corrections
  there, never inline in parsers.

- **Travel distance** (`travelDistances`) is BFS over an undirected location
  graph from everywhere the character has unlocked; explorables adjacent to an
  unlocked outpost are distance 0. Consecutive story missions are linked
  because parts of Prophecies are only reachable by finishing the campaign to
  that point (you sail to the Crystal Desert after Sanctum Cay — no walkable
  exit exists for the infobox to record). Without those edges 43 locations are
  unreachable; with them only the 12 pre-Searing ones are, which is correct —
  that transition is one-way.
- Proximity buckets: 0-2 hops green, 3-5 yellow, 6+ red.

- **Build template codes** (`/engine/src/template.ts`) are encoded and decoded
  by `@buildwars/gw-templates` (MIT) — the same package gw1tools/gw1builds
  uses; we map profession ids and in-game skill ids onto our own types.
  Attribute spreads travel both ways: a pasted code keeps its ranks and a
  build exports the ranks it has. A code
  can name skills we don't have (PvP-only splits, skills newer than the last
  scrape): those come back in `unknownSkillIds` and the slot is left empty
  rather than dropped silently. The library packs skill ids in 11 bits, so
  an id above 2047 round-trips wrong — real game codes never have one.
- **Attribution**: the skill card layout and the template-code approach are
  borrowed from gw1tools/gw1builds (MIT); see README Credits. Keep the
  credit line in the app footer if that code is touched.

- **To-do entries are added from wherever you notice them**: the skill
  browser, the zone browser, and the to-do tab itself all go through
  `addTodos` in `/app/src/todos.ts`, which dedupes against entries that are
  still open (a completed entry can be added again).
- **"Everything I need to get there" uses `routeStops`**, which keeps the
  outposts and missions on a route and drops the explorable areas — you
  walk through those, you don't unlock them — along with anything already
  unlocked. A 20-hop route to Backbreaker becomes 6 trackable stops.

- **Community builds are other people's content.** `data/community-builds.json`
  holds builds imported from a file or found by the weekly crawl. Rules:
  - A build is identified by its TEMPLATE CODE, which is also its id, so the
    same build found twice merges instead of duplicating.
  - Nothing is imported unless the code DECODES against our skill data into
    a real primary profession and at least three skills we know. Base64-ish
    shape alone matches image ids and tracking parameters.
  - Curated entries (`source.kind` file/pvx) outrank crawled ones: a later
    crawl refreshes the score but never overwrites a curated name, and
    `firstSeen` is never moved forward.
  - The source link, author and the poster's own words are kept together and
    shown as a quote. Never present crawled text as the app's own writing,
    and never claim a build is endorsed or tested.
  - Reddit refuses anonymous reads (403); the crawl needs a script app's
    client id/secret. YouTube needs an API key. A missing credential is
    reported, never silently treated as "found nothing".

- **PvX builds** (`npm run pvx`) come from the dataset gw1tools/gw1builds
  maintains (MIT), not a page-by-page crawl. Only facts are taken — name,
  professions, skill ids, attributes, rating, tags — each entry links to its
  PvX page, and PvX is credited; their prose stays theirs (CC BY-NC-SA).
  Codes are re-encoded from the skill ids with our own encoder, so every
  code decodes. Note PvX quotes GEAR-INCLUSIVE ranks ("Dagger Mastery 16");
  the template format stores base ranks only, so those clamp to 12 on
  encode, which is correct.
- **Mobile is a supported size** (iPhone 13 mini, 375x812). What broke it:
  the 7-tab nav at 504px, fixed `min-width` on the two-column layouts
  (`.grow` is 24rem), and fixed-width inputs. Rules: no page may scroll
  sideways at 375px, controls are >=44px tall (36px for dense inline
  actions), inputs are 16px so iOS doesn't zoom on focus, and `body` carries
  safe-area padding. Long lists paginate — the Community tab mounted 1,192
  cards and 11,666 interactive elements before it did.
- **`data/community-builds.json` is loaded on demand**, not bundled: it is
  over a megabyte, and most visits never open that tab.

## Copy

- **Plain, neutral, specific.** Say what something is, not how the reader
  should feel about it. "Not signed in. Characters are saved in this
  browser." — not "Playing as guest."
- **Name the game's things by their in-game names**: outposts, explorable
  areas, missions, quests, attribute ranks, elite skills.
- **Never leave campaign-specific wording in shared copy.** "No known
  Prophecies source" and "not in the Prophecies skill set" survived long
  after the app covered four campaigns.
- Status labels read as statements about the skill, not jargon: "Can buy
  now", "Can get from a quest now", "Not available yet" — not "Questable".

## Conventions

- **Views read the CHARACTER-SCOPED index** (`useData()`), never the raw
  module-level `dataset`. The character editor's own checklists got this
  wrong and offered a Prophecies-only character every campaign's outposts,
  missions and skills to tick off.
- **All cross-entity references are by wiki page name** (the stable key), e.g.
  `"Healing Breeze"`, `"Yak's Bend"`. Ref types (`SkillRef`, `LocationRef`, …) are
  string aliases in `/engine/src/types.ts`.
- TypeScript types and their matching JSON Schemas both live in
  `/engine/src/types.ts`; keep them in sync when either changes.
- Fixture and scraped JSON must validate against those schemas (see
  `/engine/test/fixtures.test.ts`).
- `gwSkillId` is the numeric in-game skill id from the wiki infobox — required for
  generating build template codes.
