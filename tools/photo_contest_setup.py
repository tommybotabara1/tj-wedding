"""
photo_contest_setup.py: get the photo contest (tomyjeyan.com/photos) ready.

Run it on your own computer, from the main checkout or any worktree: it always
reads and writes the MAIN checkout's .env (found through git), and it prints
names and ok/fail only, never a value. It:
  1. Makes PHOTO_ADMIN_PASSWORD if .env doesn't have one: four friendly words
     and two digits. Read it from .env; it is never printed.
  2. Makes PHOTO_MEDIA_KEY if .env doesn't have one.
  3. Creates or reuses the Drive folder "Tommy & Jeyan · Screen copies (safe to
     ignore)" and saves PHOTO_COPIES_FOLDER_ID. It signs in with the
     PHOTO_GOOGLE_* refresh token that photo_drive_setup.py saved (scope
     drive.file, so it only ever sees files this app made).
  4. Checks GEMINI_API_KEY is in .env and asks Gemini's free models list that
     the key works and that the model (GEMINI_MODEL, default
     gemini-3.1-flash-lite) is listed.
  5. With --push, hands GEMINI_API_KEY, ADMIN_PASSWORD, MEDIA_KEY and
     COPIES_FOLDER_ID to the Worker with `npx wrangler secret bulk` (JSON on
     stdin, so nothing touches disk), then checks upload.tomyjeyan.com/ping.

Existing values in .env are never replaced. Every step runs; a step whose
prerequisite is missing says what is missing and the rest carry on. The exit
code is 1 if any step failed. --push only runs when everything else passed.

Usage
  py tools/photo_contest_setup.py                 # check everything, no push
  py tools/photo_contest_setup.py --push          # and set the Worker's secrets
  py tools/photo_contest_setup.py --offline       # local steps only (no network)
  py tools/photo_contest_setup.py --env-file PATH # use another .env (testing)

Dependencies (for the Drive step only)
  pip install google-auth google-api-python-client
"""

import argparse
import json
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKER_DIR = ROOT / "workers" / "photo-upload"
PING = "https://upload.tomyjeyan.com/ping"
GUEST_PASSWORD = "ToMyJeyan"  # the public guests' password (see set_photo_album.py)
SCOPES = ["https://www.googleapis.com/auth/drive.file"]
TOKEN_URI = "https://oauth2.googleapis.com/token"
GEMINI_MODELS = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"
DEFAULT_MODEL = "gemini-3.1-flash-lite"
FOLDER_NAME = "Tommy & Jeyan · Screen copies (safe to ignore)"

# 64 short, friendly, unambiguous words; none sounds like another.
WORDS = [
    "lantern", "river", "maple", "quiet", "sunrise", "garden", "pebble", "meadow",
    "candle", "harbor", "willow", "ribbon", "cotton", "silver", "orange", "violet",
    "breeze", "cabin", "clover", "dolphin", "ember", "falcon", "ginger", "honey",
    "island", "jasmine", "kitten", "lemon", "marble", "nectar", "olive", "parrot",
    "pepper", "rabbit", "saddle", "tulip", "umbrella", "velvet", "walnut", "yellow",
    "zebra", "acorn", "banjo", "coral", "daisy", "eagle", "fern", "glacier",
    "hammock", "iris", "jelly", "koala", "lilac", "mango", "noodle", "oyster",
    "peach", "quartz", "robin", "sparrow", "tiger", "violin", "waffle", "pumpkin",
]
assert len(WORDS) == 64 and len(set(WORDS)) == 64

# .env name -> Worker secret name
SECRET_MAP = {
    "GEMINI_API_KEY": "GEMINI_API_KEY",
    "PHOTO_ADMIN_PASSWORD": "ADMIN_PASSWORD",
    "PHOTO_MEDIA_KEY": "MEDIA_KEY",
    "PHOTO_COPIES_FOLDER_ID": "COPIES_FOLDER_ID",
}


def main_checkout():
    out = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    return Path(out).parent


def read_env(path):
    out = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def write_env(path, values):
    """Update or append these keys, leaving every other line alone."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    done = set()
    for i, line in enumerate(lines):
        k = line.split("=", 1)[0].strip()
        if "=" in line and k in values:
            lines[i] = f"{k}={values[k]}"
            done.add(k)
    lines += [f"{k}={v}" for k, v in values.items() if k not in done]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def make_password():
    return " ".join(secrets.choice(WORDS) for _ in range(4)) + f" {secrets.randbelow(100):02d}"


def ensure_generated(env_path, env):
    new = {}
    if env.get("PHOTO_ADMIN_PASSWORD"):
        print("  ok PHOTO_ADMIN_PASSWORD is already in .env (left as it is)")
    else:
        new["PHOTO_ADMIN_PASSWORD"] = make_password()
        print("  ok made PHOTO_ADMIN_PASSWORD. Read it from .env; it isn't shown here.")
    if env.get("PHOTO_MEDIA_KEY"):
        print("  ok PHOTO_MEDIA_KEY is already in .env (left as it is)")
    else:
        new["PHOTO_MEDIA_KEY"] = secrets.token_urlsafe(32)
        print("  ok made PHOTO_MEDIA_KEY")
    if new:
        write_env(env_path, new)
        env.update(new)
    return 0


def drive_folder(env_path, env):
    need = ["PHOTO_GOOGLE_CLIENT_ID", "PHOTO_GOOGLE_CLIENT_SECRET", "PHOTO_GOOGLE_REFRESH_TOKEN"]
    missing = [k for k in need if not env.get(k)]
    if missing:
        print("  x missing from .env: " + ", ".join(missing) + ". Run tools/photo_drive_setup.py first; "
              "it saves them.")
        return 1
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
    except ImportError:
        print("  x the Google libraries aren't installed: pip install google-auth google-api-python-client")
        return 1
    try:
        creds = Credentials(None, refresh_token=env["PHOTO_GOOGLE_REFRESH_TOKEN"], token_uri=TOKEN_URI,
                            client_id=env["PHOTO_GOOGLE_CLIENT_ID"],
                            client_secret=env["PHOTO_GOOGLE_CLIENT_SECRET"], scopes=SCOPES)
        creds.refresh(Request())
        drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:  # noqa: BLE001: print the type only, never the message
        print(f"  x Google sign-in failed ({type(e).__name__}). Rerun tools/photo_drive_setup.py to sign in again.")
        return 1
    existing = env.get("PHOTO_COPIES_FOLDER_ID")
    try:
        if existing:
            try:
                f = drive.files().get(fileId=existing, fields="id,name,trashed").execute()
                if not f.get("trashed"):
                    print(f"  ok reusing the folder \"{f['name']}\"")
                    return 0
            except HttpError:
                pass
            print("  .. the folder from last time is gone or not reachable; making a new one")
        f = drive.files().create(
            body={"name": FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder",
                  "description": "Small copies the screen shows. Safe to ignore."},
            fields="id,name",
        ).execute()
    except HttpError as e:
        print(f"  x Drive answered {getattr(e.resp, 'status', '?')} making the folder")
        return 1
    write_env(env_path, {"PHOTO_COPIES_FOLDER_ID": f["id"]})
    env["PHOTO_COPIES_FOLDER_ID"] = f["id"]
    print(f"  ok created the folder \"{f['name']}\" and saved PHOTO_COPIES_FOLDER_ID")
    return 0


def check_gemini(env, offline):
    key = env.get("GEMINI_API_KEY")
    if not key:
        print("  x missing GEMINI_API_KEY in .env. Create a key in Google AI Studio (project "
              "tj-wedding-photos-514217), then add GEMINI_API_KEY=... to .env.")
        return 1
    print("  ok GEMINI_API_KEY is in .env")
    if offline:
        print("  .. --offline: not asking Gemini whether the key works")
        return 0
    model = env.get("GEMINI_MODEL") or DEFAULT_MODEL
    req = urllib.request.Request(GEMINI_MODELS, headers={"x-goog-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            names = [m.get("name", "").removeprefix("models/") for m in json.loads(r.read()).get("models", [])]
    except urllib.error.HTTPError as e:
        print(f"  x Gemini's models list answered {e.code}; the key isn't working")
        return 1
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        print(f"  x couldn't reach Gemini ({type(e).__name__})")
        return 1
    print("  ok the key works (the models list answered)")
    if model in names:
        print(f"  ok model {model} is listed")
        return 0
    lite = sorted(n for n in names if "flash-lite" in n)
    print(f"  x model {model} isn't listed. Flash-Lite models that are: " + (", ".join(lite) or "none")
          + ". Set GEMINI_MODEL in workers/photo-upload/wrangler.toml to one of them.")
    return 1


def push(env):
    wanted = {worker: env.get(local) for local, worker in SECRET_MAP.items()}
    missing = [local for local, worker in SECRET_MAP.items() if not wanted[worker]]
    if missing:
        print("  x can't push, missing from .env: " + ", ".join(missing))
        return 1
    npx = shutil.which("npx")
    if not npx:
        print("  x npx not found. Install Node.js, or set the secrets by hand")
        return 1
    print("  .. wrangler secret bulk (values go over stdin)")
    # utf-8 + replace: wrangler prints emoji and box lines; Windows' default
    # cp1252 can't read them and Python reports a (harmless) traceback.
    r = subprocess.run([npx, "wrangler", "secret", "bulk"], input=json.dumps(wanted), text=True,
                       cwd=WORKER_DIR, capture_output=True, encoding="utf-8", errors="replace")
    if r.returncode == 0:
        print("  ok secrets set on the Worker: " + ", ".join(wanted))
        return 0
    print(f"  .. bulk didn't work (exit {r.returncode}); setting them one at a time over stdin")
    for name, value in wanted.items():
        p = subprocess.run([npx, "wrangler", "secret", "put", name], input=value + "\n", text=True,
                           cwd=WORKER_DIR, capture_output=True, encoding="utf-8", errors="replace")
        if p.returncode != 0:
            print(f"  x wrangler secret put {name} failed (exit {p.returncode})")
            return 1
        print(f"  ok {name}")
    print("  ok secrets set on the Worker")
    return 0


def ping():
    req = urllib.request.Request(PING, headers={"X-Photo-Password": GUEST_PASSWORD, "Origin": "https://tomyjeyan.com",
                                                "User-Agent": "tj-wedding-setup"})
    body = "no answer"
    for _ in range(6):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body = json.loads(r.read())
            if body.get("drive"):
                print(f"  ok {PING} says the Drive is connected")
                return
        except (urllib.error.URLError, ValueError, TimeoutError) as e:
            body = type(e).__name__
        time.sleep(5)
    print(f"  ! {PING} isn't confirming yet ({body}). Give it a minute and try tomyjeyan.com/photos.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--push", action="store_true", help="also set the Worker's secrets with wrangler and check it")
    ap.add_argument("--offline", action="store_true", help="local steps only: skip Drive, Gemini and the push")
    ap.add_argument("--env-file", help="the .env to use (default: the main checkout's)")
    args = ap.parse_args()

    env_path = Path(args.env_file) if args.env_file else main_checkout() / ".env"
    env = read_env(env_path)
    print(f"Using {env_path.name} in {env_path.parent.name}/ ({'found' if env_path.exists() else 'new'})")
    failures = 0

    print("1. Admin password and media key")
    failures += ensure_generated(env_path, env)

    print("2. Drive folder for the screen copies")
    if args.offline:
        print("  .. --offline: skipped (needs Google)")
    else:
        failures += drive_folder(env_path, env)

    print("3. Gemini")
    failures += check_gemini(env, args.offline)

    if args.push:
        print("4. Push to the Worker")
        if args.offline:
            print("  .. --offline: skipped")
        elif failures:
            print("  x not pushing while a step above failed")
            failures += 1
        else:
            failures += push(env)
            if not failures:
                ping()
    else:
        print("Next: rerun with --push to hand these to the Worker (after the Worker is deployed).")

    print("All steps ok." if not failures else f"{failures} step(s) need attention.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
