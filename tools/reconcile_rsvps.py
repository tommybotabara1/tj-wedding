#!/usr/bin/env python3
"""
reconcile_rsvps.py — Match RSVP responses against the real guest list.

Pulls two sources and cross-references them:
  1. The guest list   → the "Guest List" tab of TJ MARRIAGE.xlsx on Drive
                         (read via generate_site.read_guests, the same parser
                         the dashboard uses).
  2. The RSVP responses → the "RSVPs" tab of the "TJ Weddings RSVPs" Google
                          Sheet that the Apps Script web app writes to.

It then reports:
  • MATCHED      — an RSVP name that confidently maps to a guest-list name
  • UNCERTAIN    — an RSVP name with only a fuzzy/partial match (likely a typo);
                   shows the closest guest so you can eyeball it
  • UNKNOWN      — an RSVP name with no plausible match (crasher, or new name)
  • NOT REPLIED  — guest-list names with no RSVP yet (your follow-up list)
  • DUPLICATES   — the same person appears to have RSVP'd more than once

Usage:
    python tools/reconcile_rsvps.py

Setup (one-time):
  • Share the "TJ Weddings RSVPs" Google Sheet (Viewer is enough) with the
    service account:  tj-wedding-bot@river-karma-489806-i7.iam.gserviceaccount.com
  • Optionally set RSVP_SHEET_ID in .env (defaults to the known sheet).

Credentials:
  • credentials.json  : service account key (project root)  — reused from gws.py
"""

import os
import re
import sys
from difflib import SequenceMatcher

from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.path.insert(0, os.path.dirname(__file__))
from gws import download_workbook          # noqa: E402
from generate_site import read_guests      # noqa: E402

load_dotenv()

# Windows consoles default to cp1252 and choke on the arrows/emoji below.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

CREDS_FILE     = os.path.join(os.path.dirname(__file__), "..", "credentials.json")
SCOPES         = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
RSVP_SHEET_ID  = os.environ.get("RSVP_SHEET_ID", "1Jp_XgBngLZdp3x72IampqIi88QIIfh7mxFnnzC6NJlg")
RSVP_TAB       = "RSVPs"

# Confidence thresholds for fuzzy name matching (0..1).
MATCH_STRONG = 0.86   # >= this  → confident match
MATCH_WEAK   = 0.62   # >= this  → uncertain (show closest guest), else unknown

HONORIFICS = {"mr", "mrs", "ms", "miss", "dr", "sir", "madam", "maam", "atty", "engr", "rev", "hon"}


# ── Name normalisation + matching ─────────────────────────────────────────────

def normalize(name):
    """Lowercase, strip honorifics/punctuation, collapse whitespace."""
    s = str(name or "").lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)          # drop punctuation
    tokens = [t for t in s.split() if t and t not in HONORIFICS]
    return " ".join(tokens)


def score(a, b):
    """Similarity 0..1 between two normalised names.

    Combines a whole-string ratio with a token-overlap measure so that
    'tommy' vs 'tommy botabara' (first-name-only RSVPs) still score well.
    """
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ratio = SequenceMatcher(None, a, b).ratio()
    ta, tb = set(a.split()), set(b.split())
    overlap = len(ta & tb) / max(len(ta), len(tb)) if ta and tb else 0.0
    return max(ratio, overlap)


def best_match(name, guest_index):
    """Return (best_guest_name, best_score) for `name` against the guest list."""
    n = normalize(name)
    best_name, best_score = None, 0.0
    for norm_g, original_g in guest_index:
        s = score(n, norm_g)
        if s > best_score:
            best_name, best_score = original_g, s
    return best_name, best_score


# ── Data loaders ──────────────────────────────────────────────────────────────

def load_guest_list():
    """Return a list of guest-list names (one per guest-list row)."""
    wb = download_workbook()
    guests = read_guests(wb)
    names = [g["name"].strip() for g in guests["rows"] if g.get("name") and g["name"].strip()]
    return names


def load_rsvps():
    """Return a list of RSVP dicts from the RSVPs sheet tab.

    Columns: Timestamp, Name, Email, Attending, Party Size, Additional Guests, Notes
    """
    creds = Credentials.from_service_account_file(CREDS_FILE, scopes=SCOPES)
    service = build("sheets", "v4", credentials=creds)
    resp = service.spreadsheets().values().get(
        spreadsheetId=RSVP_SHEET_ID, range=f"{RSVP_TAB}!A:G"
    ).execute()
    values = resp.get("values", [])
    if not values:
        return []

    rows = values[1:]  # skip header
    rsvps = []
    for r in rows:
        r = (r + [""] * 7)[:7]  # pad short rows
        name = (r[1] or "").strip()
        if not name or name.startswith("__"):   # skip blanks + test probes
            continue
        rsvps.append({
            "timestamp": r[0],
            "name":      name,
            "email":     (r[2] or "").strip(),
            "attending": (r[3] or "").strip().lower(),
            "party_size": r[4],
            "guests":    (r[5] or "").strip(),
            "notes":     (r[6] or "").strip(),
        })
    return rsvps


# ── Report ────────────────────────────────────────────────────────────────────

def main():
    print("Loading guest list from Drive workbook…")
    try:
        guest_names = load_guest_list()
    except Exception as e:
        print(f"  ERROR reading guest list: {e}")
        sys.exit(1)
    print(f"  {len(guest_names)} guests on the list.")

    print("Loading RSVPs from the responses sheet…")
    try:
        rsvps = load_rsvps()
    except Exception as e:
        print(f"  ERROR reading RSVP sheet: {e}")
        print("  → Did you share the sheet with the service account "
              "(tj-wedding-bot@river-karma-489806-i7.iam.gserviceaccount.com)?")
        sys.exit(1)
    print(f"  {len(rsvps)} real RSVPs (test rows skipped).")

    guest_index = [(normalize(g), g) for g in guest_names]

    matched, uncertain, unknown = [], [], []
    matched_guest_names = set()       # guest-list names that got an RSVP
    seen_norm = {}                    # normalised name → count (duplicate detection)

    for rv in rsvps:
        norm = normalize(rv["name"])
        seen_norm[norm] = seen_norm.get(norm, 0) + 1
        guess, sc = best_match(rv["name"], guest_index)
        if sc >= MATCH_STRONG:
            matched.append((rv, guess, sc))
            matched_guest_names.add(guess)
        elif sc >= MATCH_WEAK:
            uncertain.append((rv, guess, sc))
            matched_guest_names.add(guess)   # tentatively mark replied
        else:
            unknown.append((rv, guess, sc))

    not_replied = [g for g in guest_names if g not in matched_guest_names]
    duplicates = {n: c for n, c in seen_norm.items() if c > 1}

    def att(rv):
        return "attending" if rv["attending"] == "yes" else "regrets"

    print("\n" + "=" * 64)
    print("RSVP RECONCILIATION")
    print("=" * 64)

    print(f"\n✅ MATCHED ({len(matched)})")
    for rv, guess, sc in sorted(matched, key=lambda x: x[0]["name"].lower()):
        print(f"   {rv['name']:<28} → {guess:<28} [{att(rv)}]")

    print(f"\n❓ UNCERTAIN — likely typo, please verify ({len(uncertain)})")
    for rv, guess, sc in sorted(uncertain, key=lambda x: -x[2]):
        print(f"   {rv['name']:<28} → closest: {guess}  ({sc:.0%}) [{att(rv)}]")

    print(f"\n⚠️  UNKNOWN — no match on the guest list ({len(unknown)})")
    for rv, guess, sc in unknown:
        hint = f"  (closest: {guess}, {sc:.0%})" if guess else ""
        print(f"   {rv['name']:<28} [{att(rv)}]{hint}")

    print(f"\n📭 NOT REPLIED YET ({len(not_replied)})")
    for g in not_replied:
        print(f"   {g}")

    if duplicates:
        print(f"\n🔁 POSSIBLE DUPLICATE RSVPs ({len(duplicates)})")
        for n, c in duplicates.items():
            print(f"   '{n}' appears {c}×")

    attending = sum(1 for rv in rsvps if rv["attending"] == "yes")
    regrets   = len(rsvps) - attending
    print("\n" + "-" * 64)
    print(f"Summary: {len(rsvps)} responses — {attending} attending, {regrets} regrets. "
          f"{len(not_replied)} of {len(guest_names)} guests not yet replied.")
    print("-" * 64)


if __name__ == "__main__":
    main()
