# GW1 Build Planner

A planner for **Guild Wars 1** (the 2005 game): given what your character has
unlocked, which skills can you get right now, and from where?

Live at **https://zealot2323.github.io/gw1-build-planner/**

- **Skills** — every skill your primary/secondary can use, grouped by how you'd
  get it now (buy, quest, capture) or later, with how many zones away it is.
- **Builds** — paste a game template code to save a build against a character,
  and see which of its skills you already have.
- **Quests** — quests that reward a skill you could learn, nearest first.
- **Zones** — what spawns where, with per-zone levels, skill bars and a threat
  briefing; normal and hard mode.
- **To-do** — skills, builds, outposts, missions or free-text notes per character.

Characters save in the browser; signing in (emailed link, no password) keeps
them in an account and syncs across devices.

## Running it

```bash
npm install
npm test                       # engine + scraper tests
npm run dev --workspace=app    # the app
```

Scraper jobs (all polite: 1 request/second, everything cached on disk):

```bash
npm run discover   # enumerate pages -> data/manifest.json
npm run parse      # cache -> data/*.json (no network)
npm run quests     # quest pages named by skill pages
npm run updates    # recent game updates + /Skill history
npm run icons      # skill, profession and cost icons
```

`CLAUDE.md` documents the domain rules and every parsing judgement call.

## Credits

Fan-made, not affiliated with ArenaNet.

- Skill, location, quest and monster data from the
  [Guild Wars Wiki](https://wiki.guildwars.com/) (GNU FDL).
- Guild Wars artwork, skill icons and cost icons © ArenaNet, LLC.
- Build template codes are encoded/decoded with
  [@buildwars/gw-templates](https://github.com/build-wars/gw-templates) (MIT).
- The template-code handling and the skill-card layout (48px icon, gold elite
  name and `[Elite]` tag, uppercase profession • attribute line, costs as
  number + tango icon) follow
  [gw1tools/gw1builds](https://github.com/gw1tools/gw1builds) (MIT).
