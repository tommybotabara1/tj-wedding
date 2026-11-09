"""
photo_drive_setup.py: connect the photo uploader (upload.tomyjeyan.com) to the
Google Drive that should receive the guests' photos and videos.

Run it once, on your own computer. It:
  1. Opens a browser so you sign in to the Google account whose Drive should
     hold the photos, and asks for one permission: "see, edit, create and
     delete only the specific Google Drive files you use with this app"
     (the drive.file scope). The uploader can add files to its folder; it can't
     see anything else in your Drive.
  2. Creates the folder "Tommy & Jeyan · Guest photos & videos" in that Drive
     (or reuses the one from a previous run), then writes and deletes a tiny
     test file to prove it can upload there.
  3. Shows how much free space that Drive has. Every guest upload counts
     against it (15 GB free, shared with Gmail and Google Photos).
  4. Saves the keys to .env (PHOTO_GOOGLE_CLIENT_ID, PHOTO_GOOGLE_CLIENT_SECRET,
     PHOTO_GOOGLE_REFRESH_TOKEN, PHOTO_DRIVE_FOLDER_ID).
  5. With --push, hands them to the Worker as secrets (plus PHOTO_PASSWORD) via
     `npx wrangler secret put`, then checks upload.tomyjeyan.com/ping says the
     Drive is connected.

Before the first run (Google Cloud Console, the project you use for this repo):
  a. APIs & Services > Library: enable "Google Drive API".
  b. APIs & Services > OAuth consent screen: user type External, and PUBLISH
     the app ("In production"). While it says "Testing", Google expires the
     permission after 7 days and uploads would stop before the wedding.
     Signing in will warn "Google hasn't verified this app": it's yours, so
     choose Advanced > Go to (app name).
  c. APIs & Services > Credentials > Create credentials > OAuth client ID >
     Desktop app. Download the JSON (e.g. as photo_oauth_client.json in the
     project root; *.json client files stay out of git, see .gitignore).

Usage
  cd workers/photo-upload && npx wrangler deploy && cd ../..   # Worker first
  python tools/photo_drive_setup.py --client photo_oauth_client.json --push

If uploads ever answer "drive-auth" (permission revoked or expired), rerun the
same command: it signs in again and replaces the secrets.

Dependencies
  pip install google-auth-oauthlib google-api-python-client
"""

import argparse
import io
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseUpload

sys.path.insert(0, str(Path(__file__).resolve().parent))
from set_photo_album import PASSWORD  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"
WORKER_DIR = ROOT / "workers" / "photo-upload"
PING = "https://upload.tomyjeyan.com/ping"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]
FOLDER_NAME = "Tommy & Jeyan · Guest photos & videos"


def read_env():
    out = {}
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def write_env(values):
    """Update or append these keys in .env, leaving every other line alone."""
    lines = ENV.read_text(encoding="utf-8").splitlines() if ENV.exists() else []
    done = set()
    for i, line in enumerate(lines):
        k = line.split("=", 1)[0].strip()
        if "=" in line and k in values:
            lines[i] = f"{k}={values[k]}"
            done.add(k)
    lines += [f"{k}={v}" for k, v in values.items() if k not in done]
    ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")


def gb(n):
    return f"{int(n) / 1024 ** 3:.1f} GB"


def folder(drive, existing):
    if existing:
        try:
            f = drive.files().get(fileId=existing, fields="id,name,trashed,webViewLink").execute()
            if not f.get("trashed"):
                print(f"  ok reusing the folder \"{f['name']}\"")
                return f
        except HttpError:
            pass
        print("  .. the folder from last time is gone or not reachable; making a new one")
    f = drive.files().create(
        body={"name": FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder",
              "description": "Photos and videos guests shared on tomyjeyan.com/photos"},
        fields="id,name,webViewLink",
    ).execute()
    print(f"  ok created the folder \"{f['name']}\"")
    return f


def prove_upload(drive, folder_id):
    media = MediaIoBaseUpload(io.BytesIO(b"setup check"), mimetype="text/plain", resumable=True)
    f = drive.files().create(body={"name": "setup-check.txt", "parents": [folder_id]},
                             media_body=media, fields="id").execute()
    drive.files().delete(fileId=f["id"]).execute()
    print("  ok test upload into the folder worked (and was deleted)")


def push(secrets):
    npx = shutil.which("npx")
    if not npx:
        sys.exit("  x npx not found. Install Node.js, or set the secrets by hand (see workers/photo-upload/wrangler.toml)")
    for name, value in secrets.items():
        print(f"  .. wrangler secret put {name}")
        subprocess.run([npx, "wrangler", "secret", "put", name], input=value + "\n", text=True,
                       cwd=WORKER_DIR, check=True, stdout=subprocess.DEVNULL)
    print("  ok secrets set on the Worker")


def ping():
    req = urllib.request.Request(PING, headers={"X-Photo-Password": PASSWORD, "Origin": "https://tomyjeyan.com",
                                                "User-Agent": "tj-wedding-setup"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body = json.loads(r.read())
            if body.get("drive"):
                print(f"  ok {PING} says the Drive is connected. Guests can send photos now.")
                return
        except (urllib.error.URLError, ValueError) as e:
            body = str(e)
        time.sleep(5)
    print(f"  ! {PING} isn't confirming yet ({body}). Give it a minute and open it in a browser with the "
          f"X-Photo-Password header, or just try tomyjeyan.com/photos.")


def main():
    client = Path(ARGS.client)
    if not client.exists():
        sys.exit(f"  x {client} not found. Download the Desktop app OAuth client JSON first (see the top of this file).")
    info = json.loads(client.read_text(encoding="utf-8"))
    conf = info.get("installed") or info.get("web")
    if not conf:
        sys.exit("  x that JSON isn't an OAuth client (a service account key won't work: those have no Drive storage)")

    print("Opening a browser to sign in. Use the Google account whose Drive should hold the photos.")
    flow = InstalledAppFlow.from_client_secrets_file(str(client), scopes=SCOPES)
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")
    if not creds.refresh_token:
        sys.exit("  x Google didn't hand back a refresh token. Remove the app's access at "
                 "myaccount.google.com/permissions and run this again.")
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)

    try:
        about = drive.about().get(fields="user(emailAddress),storageQuota").execute()
        q = about.get("storageQuota", {})
        who = about.get("user", {}).get("emailAddress", "?")
        if q.get("limit"):
            free = int(q["limit"]) - int(q.get("usage", 0))
            print(f"  ok signed in as {who}: {gb(free)} free of {gb(q['limit'])}")
            if free < 10 * 1024 ** 3:
                print("  ! under 10 GB free. A wedding's worth of guest videos can fill that; "
                      "consider more Google storage for December.")
        else:
            print(f"  ok signed in as {who} (unlimited storage)")
    except HttpError:
        print("  .. couldn't read the storage figures; carrying on")

    env = read_env()
    f = folder(drive, env.get("PHOTO_DRIVE_FOLDER_ID"))
    prove_upload(drive, f["id"])

    secrets = {
        "GOOGLE_CLIENT_ID": conf["client_id"],
        "GOOGLE_CLIENT_SECRET": conf["client_secret"],
        "GOOGLE_REFRESH_TOKEN": creds.refresh_token,
        "DRIVE_FOLDER_ID": f["id"],
        "PHOTO_PASSWORD": PASSWORD,
    }
    write_env({
        "PHOTO_GOOGLE_CLIENT_ID": secrets["GOOGLE_CLIENT_ID"],
        "PHOTO_GOOGLE_CLIENT_SECRET": secrets["GOOGLE_CLIENT_SECRET"],
        "PHOTO_GOOGLE_REFRESH_TOKEN": secrets["GOOGLE_REFRESH_TOKEN"],
        "PHOTO_DRIVE_FOLDER_ID": secrets["DRIVE_FOLDER_ID"],
    })
    print("  ok saved to .env")
    print(f"  Photos will land in: {f.get('webViewLink', 'your Drive, folder ' + FOLDER_NAME)}")

    if ARGS.push:
        push(secrets)
        ping()
    else:
        print("  Next: rerun with --push to hand these to the Worker (after `npx wrangler deploy` in workers/photo-upload).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--client", required=True, help="the Desktop app OAuth client JSON from Google Cloud Console")
    ap.add_argument("--push", action="store_true", help="also set the Worker's secrets with wrangler and check it")
    ARGS = ap.parse_args()
    main()
