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
- **Community** — builds collected from elsewhere, each linking back to its source.

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

npm run pvx                       # import PvX wiki builds
npm run community -- builds.csv   # import community builds from a file
npm run crawl                     # weekly sweep of Reddit + YouTube for codes
```

### Community builds

`npm run community -- <file>` imports builds from JSON, CSV/TSV or plain
text. A template code is the only required field; `name`, `author`, `url`,
`tags` and `notes` are used when present, under any reasonable column name.
Every code is verified by decoding it against the skill data, and rows
whose code doesn't decode are reported rather than imported.

`npm run crawl` looks through recent Reddit posts and YouTube videos for
codes and records each with its source link and the text around it. It runs
weekly in GitHub Actions and needs repository secrets:

| Secret | For |
| --- | --- |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | *optional* — a Reddit "script" app. Without it the crawl reads Reddit's public RSS feeds, which need no credentials but carry no post score |
| `YOUTUBE_API_KEY` | YouTube Data API v3 |

Missing credentials don't fail the run; that half is skipped and reported.

`CLAUDE.md` documents the domain rules and every parsing judgement call.

## Credits

Fan-made, not affiliated with ArenaNet.

- Skill, location, quest and monster data from the
  [Guild Wars Wiki](https://wiki.guildwars.com/) (GNU FDL).
- Guild Wars artwork, skill icons and cost icons © ArenaNet, LLC.
- Community build data from [PvX wiki](https://gwpvx.fandom.com/) (CC BY-NC-SA 2.5),
  read via the dataset in [gw1tools/gw1builds](https://github.com/gw1tools/gw1builds) (MIT).
  Only build facts are used — names, professions, skill bars, attributes, ratings —
  and every entry links back to its PvX page.
- Build template codes are encoded/decoded with
  [@buildwars/gw-templates](https://github.com/build-wars/gw-templates) (MIT).
- The template-code handling and the skill-card layout (48px icon, gold elite
  name and `[Elite]` tag, uppercase profession • attribute line, costs as
  number + tango icon) follow
  [gw1tools/gw1builds](https://github.com/gw1tools/gw1builds) (MIT).
