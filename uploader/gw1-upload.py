#!/usr/bin/env python3
"""
Send GWToolbox's character_completion.json to the GW1 Build Planner.

Standard library only, so it runs on a Steam Deck as it ships: no pip, no
packages, nothing to install into SteamOS's read-only filesystem.

    ./gw1-upload.py --pair ABCD2345     # once, with the code from the site
    ./gw1-upload.py --once              # send the file if it has changed
    ./gw1-upload.py --install-service   # let systemd do it when the file changes
    ./gw1-upload.py --watch             # or poll for changes in the foreground

The file is sent exactly as GWToolbox wrote it. Decoding it into
characters, skills and maps happens in the app.

Note on timing: GWToolbox writes this file when it saves settings, which in
practice means when you close Guild Wars. --watch is therefore an
end-of-session sync, not a live one.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CONFIG_PATH = Path(
    os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")
) / "gw1-build-planner" / "uploader.json"

DEFAULT_INTERVAL = 300
TIMEOUT = 30


# --------------------------------------------------------------------------
# Finding the file
# --------------------------------------------------------------------------

# GWToolbox writes to Documents\GWToolboxpp\<COMPUTERNAME>\configs\default\,
# with an older layout one level up. Under Proton or Wine, "Documents" lives
# inside the prefix, so the Steam Deck copy is several directories down a
# path that has the game's app id in it.
FILENAME = "character_completion.json"
SEARCH_GLOBS = (
    "GWToolboxpp/*/configs/*/" + FILENAME,
    "GWToolboxpp/*/" + FILENAME,
)
PREFIX_GLOBS = (
    ".steam/steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/Documents",
    ".steam/root/steamapps/compatdata/*/pfx/drive_c/users/steamuser/Documents",
    ".local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/Documents",
    # a second library on the SD card
    "../../run/media/*/steamapps/compatdata/*/pfx/drive_c/users/steamuser/Documents",
    ".wine/drive_c/users/*/Documents",
    "Documents",
)


def candidate_files():
    """Every completion file we can find, newest first."""
    home = Path.home()
    found = []
    for prefix_glob in PREFIX_GLOBS:
        for documents in sorted(home.glob(prefix_glob)):
            for file_glob in SEARCH_GLOBS:
                found.extend(documents.glob(file_glob))
    unique = {path.resolve(): path.resolve() for path in found if path.is_file()}
    return sorted(unique.values(), key=lambda p: p.stat().st_mtime, reverse=True)


def resolve_path(configured):
    if configured:
        path = Path(configured).expanduser().resolve()
        if not path.is_file():
            die(f"no file at {path}")
        return path
    found = candidate_files()
    if not found:
        die(
            "could not find character_completion.json.\n"
            "Pass --path /full/path/to/character_completion.json, or run with --search to see where I looked."
        )
    return found[0]


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------


def load_config():
    try:
        return json.loads(CONFIG_PATH.read_text("utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        die(f"{CONFIG_PATH} is not valid JSON; delete it and pair again")


def save_config(config):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    # The token is a credential: written readable by this user only.
    fd = os.open(CONFIG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")


def setting(config, args, key, env):
    return getattr(args, key, None) or os.environ.get(env) or config.get(key)


# --------------------------------------------------------------------------
# Talking to Supabase
# --------------------------------------------------------------------------


def rpc(url, anon_key, function, payload):
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/{function}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}",
            "User-Agent": "gw1-build-planner-uploader",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = response.read().decode("utf-8").strip()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("message", detail)
        except json.JSONDecodeError:
            pass
        die(f"server said: {detail}")
    except urllib.error.URLError as error:
        die(f"could not reach {url}: {error.reason}")


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------


def die(message):
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def pair(args, config):
    url = setting(config, args, "url", "GW1_PLANNER_URL")
    anon_key = setting(config, args, "anon_key", "GW1_PLANNER_ANON_KEY")
    if not url or not anon_key:
        die("pairing needs --url and --anon-key (the site shows both next to the code)")

    label = args.label or os.uname().nodename
    token = rpc(url, anon_key, "claim_pairing_code", {"pairing_code": args.pair, "device_label": label})
    if not token:
        die("no token came back; the code may have expired")

    config.update({"url": url, "anon_key": anon_key, "token": token, "label": label})
    if args.path:
        config["path"] = str(Path(args.path).expanduser())
    save_config(config)
    print(f"paired as {label!r}; token saved to {CONFIG_PATH}")


def upload(config, path, force=False, quiet=False):
    """Send the file. Returns True if it was sent, False if unchanged."""
    raw = path.read_text("utf-8-sig")
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    if not force and digest == config.get("last_hash"):
        if not quiet:
            print("unchanged since the last upload")
        return False

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        die(f"{path} is not valid JSON ({error})")
    if not isinstance(payload, dict):
        die("that file is not a GWToolbox completion file")

    rpc(config["url"], config["anon_key"], "upload_completion",
        {"device_token": config["token"], "payload": payload})

    config["last_hash"] = digest
    config["last_upload"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    save_config(config)
    characters = [name for name in payload if name]
    print(f"sent {len(characters)} character(s): {', '.join(sorted(characters))}")
    return True


SERVICE_UNIT = """\
# Upload GWToolbox's completion file to the GW1 Build Planner.
# Started by gw1-upload.path when the file changes. Written by
# `gw1-upload.py --install-service` — edit that, not this.

[Unit]
Description=Upload GWToolbox completion to the GW1 Build Planner
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
# The file appears the moment Guild Wars closes; give the network a chance.
ExecStartPre=/usr/bin/sleep 5
ExecStart={script} --once
NoNewPrivileges=true
"""

PATH_UNIT = """\
# Watch GWToolbox's completion file and upload when it changes.
# GWToolbox writes it on shutdown, so this fires when you quit the game.
# Written by `gw1-upload.py --install-service`.

[Unit]
Description=Watch for GWToolbox completion changes

[Path]
PathChanged={file}
Unit=gw1-upload.service

[Install]
WantedBy=default.target
"""


def install_service(config, path):
    """
    Write a .path unit that runs one upload when the file changes.

    systemd does the watching, so nothing of ours stays resident and the
    upload happens seconds after Guild Wars closes rather than at the next
    poll. The file's own path is baked in because it cannot be guessed:
    Guild Wars is not a Steam title, so under Proton it sits behind the
    app id Steam generated when you added it.
    """
    script = Path(sys.argv[0]).resolve()
    path = path.resolve()
    # systemd wants absolute paths, and splits ExecStart on whitespace
    # unless the executable is quoted.
    quoted = f'"{script}"' if " " in str(script) else str(script)
    units = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd" / "user"
    units.mkdir(parents=True, exist_ok=True)
    (units / "gw1-upload.service").write_text(SERVICE_UNIT.format(script=quoted), "utf-8")
    (units / "gw1-upload.path").write_text(PATH_UNIT.format(file=path), "utf-8")
    print(f"wrote {units}/gw1-upload.{{service,path}}")
    print(f"  watching {path}")
    print(f"  running  {script} --once")

    if shutil.which("systemctl") is None:
        print("\nsystemctl not found here; on the Deck, finish with:")
        print("  systemctl --user daemon-reload")
        print("  systemctl --user enable --now gw1-upload.path")
        return
    for command in (
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", "--now", "gw1-upload.path"],
    ):
        if subprocess.run(command).returncode != 0:
            die(f"{' '.join(command)} failed")
    print("\nenabled. It will upload a few seconds after Guild Wars closes.")
    print("To keep it running while you are in Game Mode:  sudo loginctl enable-linger $USER")
    print("To see what it did:  journalctl --user -u gw1-upload -n 20")


def watch(config, path, interval):
    print(f"watching {path}\n(GWToolbox writes it when it closes, so expect an upload when you quit the game)")
    last_mtime = None
    while True:
        try:
            mtime = path.stat().st_mtime
            if mtime != last_mtime:
                last_mtime = mtime
                upload(config, path, quiet=True)
        except FileNotFoundError:
            pass
        except SystemExit:
            raise
        except Exception as error:  # keep watching through a transient failure
            print(f"warning: {error}", file=sys.stderr)
        time.sleep(interval)


def main():
    # Line buffering, so --watch output reaches journalctl (and the terminal)
    # as it happens rather than whenever the pipe buffer fills.
    sys.stdout.reconfigure(line_buffering=True)

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pair", metavar="CODE", help="link this machine using a code from the site")
    parser.add_argument("--once", action="store_true", help="upload now if the file has changed")
    parser.add_argument("--watch", action="store_true", help="upload whenever the file changes (polling)")
    parser.add_argument("--install-service", dest="install_service", action="store_true",
                        help="have systemd upload when the file changes, and stop running otherwise")
    parser.add_argument("--force", action="store_true", help="upload even if nothing has changed")
    parser.add_argument("--status", action="store_true", help="show what is configured")
    parser.add_argument("--search", action="store_true", help="list every completion file found")
    parser.add_argument("--path", help="path to character_completion.json")
    parser.add_argument("--url", help="Supabase project URL")
    parser.add_argument("--anon-key", dest="anon_key", help="Supabase anon/publishable key")
    parser.add_argument("--label", help="a name for this machine")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL, help="seconds between checks when watching")
    args = parser.parse_args()

    config = load_config()

    if args.search:
        found = candidate_files()
        print("\n".join(str(p) for p in found) if found else "nothing found")
        return

    if args.pair:
        pair(args, config)
        if not (args.once or args.watch):
            return
        config = load_config()

    if args.status:
        print(f"config    {CONFIG_PATH}")
        print(f"site      {config.get('url', '(not set)')}")
        print(f"device    {config.get('label', '(not paired)')}")
        print(f"paired    {'yes' if config.get('token') else 'no'}")
        print(f"last sent {config.get('last_upload', 'never')}")
        print(f"file      {config.get('path') or (candidate_files() or ['(not found)'])[0]}")
        return

    if not config.get("token"):
        die("not paired yet — run with --pair CODE using a code from the site")

    path = resolve_path(args.path or config.get("path"))
    # Remember where it was found, so --status and the service unit agree.
    if str(path) != config.get("path"):
        config["path"] = str(path)
        save_config(config)
    if args.install_service:
        install_service(config, path)
    elif args.watch:
        watch(config, path, max(10, args.interval))
    else:
        upload(config, path, force=args.force)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
