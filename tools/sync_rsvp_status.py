#!/usr/bin/env python3
"""
sync_rsvp_status.py — Copy RSVP answers onto the planner's Guest List.

Reads every reply in the "TJ Weddings RSVPs" sheet and brings the matching row
of the "Guest List" tab (TJ MARRIAGE workbook) in line with it:

  • replied yes → Status "Attending"
  • replied no  → the sheet's own can't-join convention: Status "Not joining",
                  Role prefixed "[CANT JOIN] ", Table Number cleared (so the
                  seat frees up in the Table PAX totals, which SUMIF on that
                  column), and the row moved down into the can't-join block at
                  the bottom of the list.
  • a "no" who later replies yes gets Status "Attending" and the prefix
    removed, and is reported so they can be given a table again.

Guests marked Attending in the sheet without an RSVP are left alone (the
couple sets some of those by hand from replies outside the form) and are
listed so they can be checked. Only confident name matches are written; fuzzy
ones are reported and skipped, using the same matcher as reconcile_rsvps.py.

Usage:
    py tools/sync_rsvp_status.py            # dry run: print what would change
    py tools/sync_rsvp_status.py --apply    # write the changes to the sheet

Setup (one-time):
  • The service account needs Editor on the planner workbook
    (GOOGLE_DRIVE_FILE_ID) and Viewer on the RSVP sheet (RSVP_SHEET_ID).

Credentials:
  • credentials.json  : service account key (project root)  — reused from gws.py
"""

import os
import sys

from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.path.insert(0, os.path.dirname(__file__))
from reconcile_rsvps import load_rsvps, normalize, best_match, MATCH_STRONG  # noqa: E402

load_dotenv()

# RSVP names that can't be fuzzy-matched but are known to be a specific guest
# (a married/alternate surname, or a first name only). Keys are normalized.
NAME_ALIASES = {
    "ann jaymee hinampas": "Ann Jaymee Esparagoza",
    "jephonie":            "Jephonie G. Lumansoy",
}

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

CREDS_FILE = os.path.join(os.path.dirname(__file__), "..", "credentials.json")
SCOPES     = ["https://www.googleapis.com/auth/spreadsheets"]
FILE_ID    = os.environ.get("GOOGLE_DRIVE_FILE_ID", "")
TAB        = "Guest List"

ATTENDING   = "Attending"
NOT_JOINING = "Not joining"
CANT_JOIN   = "[CANT JOIN]"


def col_letter(idx):
    """0-based column index → A1 letter(s)."""
    s, idx = "", idx + 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


# ── Guest List ────────────────────────────────────────────────────────────────

def read_guest_list(service):
    """Return (column map, guest rows) from the Guest List tab.

    Columns are found by header name like generate_site.read_guests, but only
    inside the guest table (up to its first blank header): the summary blocks
    to its right reuse names such as "Table".
    """
    values = service.spreadsheets().values().get(
        spreadsheetId=FILE_ID, range=f"'{TAB}'!A1:Z1000"
    ).execute().get("values", [])

    header, header_idx = None, None
    for i, row in enumerate(values):
        cells = [str(c).strip().lower() for c in row]
        if "name" in cells and "side" in cells and "pax" in cells:
            header = cells[:cells.index("")] if "" in cells else cells
            header_idx = i
            break
    if header is None:
        raise SystemExit("Couldn't find the Guest List header row (Name / Side / Pax).")

    def col(*aliases):
        for a in aliases:
            if a in header:
                return header.index(a)
        return None

    ci = {
        "num":    col("#"),
        "name":   col("name"),
        "role":   col("role"),
        "status": col("status"),
        "table":  col("table number", "table #", "table#", "table"),
    }
    missing = [k for k, v in ci.items() if v is None]
    if missing:
        raise SystemExit(f"Guest List is missing column(s): {', '.join(missing)}")

    guests = []
    for rownum, row in enumerate(values[header_idx + 1:], start=header_idx + 2):
        def get(key):
            idx = ci[key]
            return str(row[idx]).strip() if idx < len(row) else ""
        if not get("num").isdigit() or not get("name"):
            continue
        guests.append({
            "row":    rownum,   # 1-based sheet row
            "name":   get("name"),
            "role":   get("role"),
            "status": get("status"),
            "table":  get("table"),
        })
    return ci, guests


# ── Plan ──────────────────────────────────────────────────────────────────────

def plan_changes(guests, rsvps):
    """Work out which cells to change. Returns a dict of lists for reporting."""
    index = [(normalize(g["name"]), g["name"]) for g in guests]
    by_name = {g["name"]: g for g in guests}

    latest, fuzzy = {}, []
    for rv in rsvps:   # the sheet is in reply order, so a later row wins
        guess, sc = best_match(rv["name"], index)
        alias = NAME_ALIASES.get(normalize(rv["name"]))
        if alias in by_name:
            guess, sc = alias, 1.0
        if sc >= MATCH_STRONG:
            latest[guess] = rv
        else:
            fuzzy.append((rv, guess, sc))

    # The can't-join block is everything below the last guest still invited.
    last_active = max((g["row"] for g in guests if not g["role"].startswith(CANT_JOIN)), default=0)

    updates, moves, reseat = [], [], []
    for name, rv in latest.items():
        g = by_name[name]
        upd = {}
        if rv["attending"] == "yes":
            if g["status"].lower() != ATTENDING.lower():
                upd["status"] = ATTENDING
            if g["role"].startswith(CANT_JOIN):
                upd["role"] = g["role"][len(CANT_JOIN):].strip()
                if not g["table"]:
                    reseat.append(g)
        elif rv["attending"] == "no":
            if g["status"].lower() != NOT_JOINING.lower():
                upd["status"] = NOT_JOINING
            if not g["role"].startswith(CANT_JOIN):
                upd["role"] = f"{CANT_JOIN} {g['role']}".strip()
            if g["table"]:
                upd["table"] = ""
            if g["row"] < last_active:
                moves.append(g)
        if upd:
            updates.append((g, rv, upd))

    replied = set(latest)
    unreplied_attending = [g for g in guests
                           if g["status"].lower() == ATTENDING.lower() and g["name"] not in replied]
    return {
        "matched": latest, "fuzzy": fuzzy, "updates": updates, "moves": moves,
        "reseat": reseat, "unreplied_attending": unreplied_attending,
    }


# ── Apply ─────────────────────────────────────────────────────────────────────

def apply_changes(service, ci, guests, plan):
    """Write the planned cells, then move declined rows into the can't-join block."""
    data = []
    for g, _rv, upd in plan["updates"]:
        for key, val in upd.items():
            data.append({"range": f"'{TAB}'!{col_letter(ci[key])}{g['row']}", "values": [[val]]})
    if data:
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=FILE_ID, body={"valueInputOption": "RAW", "data": data}
        ).execute()

    if not plan["moves"]:
        return

    meta = service.spreadsheets().get(
        spreadsheetId=FILE_ID, ranges=[f"'{TAB}'!A1"],
        fields="sheets(properties(sheetId),basicFilter)",
    ).execute()["sheets"][0]
    sheet_id = meta["properties"]["sheetId"]
    last_row = max(g["row"] for g in guests)

    requests = []
    for n, g in enumerate(sorted(plan["moves"], key=lambda g: g["row"])):
        start = g["row"] - 1 - n          # each earlier move shifted this row up by one
        requests.append({"moveDimension": {
            "source": {"sheetId": sheet_id, "dimension": "ROWS",
                       "startIndex": start, "endIndex": start + 1},
            "destinationIndex": last_row,  # just past the last guest row
        }})
    # Moving a row to the very end can shrink the filter range; the row count
    # is unchanged, so putting the original range back is always right.
    bf = meta.get("basicFilter")
    if bf:
        requests.append({"setBasicFilter": {"filter": {
            k: bf[k] for k in ("range", "filterSpecs", "sortSpecs") if k in bf
        }}})
    service.spreadsheets().batchUpdate(spreadsheetId=FILE_ID, body={"requests": requests}).execute()


# ── Report ────────────────────────────────────────────────────────────────────

def report(plan):
    print(f"\n✏️  CHANGES ({len(plan['updates'])})")
    moving = {g["name"] for g in plan["moves"]}
    for g, rv, upd in sorted(plan["updates"], key=lambda x: x[0]["row"]):
        what = ", ".join(f"{k}: {g[k] or '—'} → {v or '(blank)'}" for k, v in upd.items())
        tail = "  + move to can't-join block" if g["name"] in moving else ""
        print(f"   row {g['row']:<4} {g['name']:<36} [{rv['attending']}]  {what}{tail}")

    if plan["fuzzy"]:
        print(f"\n❓ NOT WRITTEN — no confident guest-list match ({len(plan['fuzzy'])})")
        for rv, guess, sc in plan["fuzzy"]:
            print(f"   {rv['name']:<36} → closest: {guess} ({sc:.0%})")

    if plan["reseat"]:
        print(f"\n🪑 CHANGED TO YES — needs a table ({len(plan['reseat'])})")
        for g in plan["reseat"]:
            print(f"   {g['name']}")

    if plan["unreplied_attending"]:
        print(f"\nℹ️  ATTENDING IN THE SHEET, NO RSVP ON FILE — left as is ({len(plan['unreplied_attending'])})")
        for g in plan["unreplied_attending"]:
            print(f"   {g['name']}")


def main():
    apply = "--apply" in sys.argv[1:]
    if not FILE_ID:
        raise SystemExit("GOOGLE_DRIVE_FILE_ID not set in .env")

    creds = Credentials.from_service_account_file(CREDS_FILE, scopes=SCOPES)
    service = build("sheets", "v4", credentials=creds)

    print("Loading RSVPs…")
    rsvps = load_rsvps()
    print(f"  {len(rsvps)} replies.")
    print("Loading Guest List…")
    ci, guests = read_guest_list(service)
    print(f"  {len(guests)} guest rows.")

    plan = plan_changes(guests, rsvps)
    report(plan)

    if not plan["updates"]:
        print("\nGuest List already matches the RSVPs. Nothing to write.")
        return
    if not apply:
        print("\nDry run. Re-run with --apply to write these changes.")
        return

    print("\nWriting…")
    apply_changes(service, ci, guests, plan)
    _, guests_after = read_guest_list(service)
    left = plan_changes(guests_after, rsvps)["updates"]
    if left:
        print(f"  ⚠️  {len(left)} change(s) didn't stick — re-run to see them.")
        sys.exit(1)
    print(f"  Done. {len(plan['updates'])} guest rows updated, "
          f"{len(plan['moves'])} moved; re-read confirms the sheet matches.")


if __name__ == "__main__":
    main()
