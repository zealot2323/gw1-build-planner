# GWToolbox uploader

Sends GWToolbox's `character_completion.json` to your GW1 Build Planner
account, so skills, unlocked places, missions (normal and hard mode) and
vanquishes stay current without copying files around.

Written for a Steam Deck, where getting that file off the device by hand is
the annoying part. Python 3 and nothing else — no `pip`, no packages, no
writing to SteamOS's read-only filesystem.

## Setup

One-off, on the machine that runs Guild Wars:

1. On the site, open **Characters → GWToolbox sync → Link a machine**. It
   shows a code and the exact command, with your project URL and key
   already filled in.
2. In Desktop Mode, open Konsole and run that command. The code is good for
   15 minutes and works once.

```bash
./gw1-upload.py --pair ABCD2345 --url https://xxxx.supabase.co --anon-key eyJ...
```

The token it gets back is written to
`~/.config/gw1-build-planner/uploader.json`, readable only by you. Revoke it
from the same panel on the site at any time.

## Day to day

```bash
./gw1-upload.py --once      # send it if it changed
./gw1-upload.py --watch     # keep sending whenever it changes
./gw1-upload.py --status    # what's configured, what was last sent
./gw1-upload.py --search    # every completion file it can find
```

**GWToolbox writes that file when it shuts down**, which in practice means
when you quit Guild Wars. There is nothing to sync mid-session, so the
useful moment is right after you stop playing — which is what
`--install-service` below automates.

The file is found automatically under Proton — including a second library on
the SD card — and under Wine. If yours is somewhere unusual, pass
`--path /full/path/to/character_completion.json` once and it is remembered.

## Uploading on its own, when you quit the game

```bash
~/.local/bin/gw1-upload.py --install-service
```

That writes two systemd user units and enables them: a `.path` unit that
watches the completion file, and a one-shot that uploads when it changes.
GWToolbox writes the file as it shuts down, so the upload lands a few
seconds after you quit Guild Wars. Nothing of ours stays running in
between.

It runs in Game Mode as well as Desktop Mode — they are both sessions for
the same user. One command makes that airtight across the switch between
them:

```bash
sudo loginctl enable-linger $USER
```

To see what it has been doing:

```bash
journalctl --user -u gw1-upload -n 20
```

The units bake in the path to your completion file, because it cannot be
guessed: Guild Wars is not a Steam title, so under Proton it lives behind
the app id Steam made up when you added it. Re-run `--install-service` if
that ever moves.

`--watch` does the same job by polling in the foreground, if you would
rather watch it work than hand it to systemd.

## What gets sent

The file, unchanged. It holds one record per character: profession, which
account it belongs to, and bitfields for skills, maps, missions, vanquishes,
heroes, minipets and festival hats. The planner reads the first four and
ignores the rest.

The token can do exactly one thing: replace the pending upload on your
account. It cannot read your characters, your builds or anything else.
