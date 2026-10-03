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
when you quit Guild Wars. So `--watch` is an end-of-session sync, not a live
one; `--once` after playing does the same job.

The file is found automatically under Proton — including a second library on
the SD card — and under Wine. If yours is somewhere unusual, pass
`--path /full/path/to/character_completion.json` once and it is remembered.

## Running it in the background

```bash
mkdir -p ~/.config/systemd/user
cp gw1-upload.service ~/.config/systemd/user/
systemctl --user enable --now gw1-upload
journalctl --user -u gw1-upload -f
```

Copy `gw1-upload.py` somewhere stable first (`~/.local/bin/` is fine) and
point the unit at it. On a Steam Deck, `sudo loginctl enable-linger $USER`
keeps it running when you are not logged into the desktop.

## What gets sent

The file, unchanged. It holds one record per character: profession, which
account it belongs to, and bitfields for skills, maps, missions, vanquishes,
heroes, minipets and festival hats. The planner reads the first four and
ignores the rest.

The token can do exactly one thing: replace the pending upload on your
account. It cannot read your characters, your builds or anything else.
