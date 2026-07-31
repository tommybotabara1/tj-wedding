# Workflow: Generate & Deploy Wedding Dashboard

## Objective
Regenerate the couple-only planner pages in `docs/planner-7k2a/` from the latest data in "TJ MARRIAGE.xlsx" on Google Drive and push it live to GitHub Pages.

## Required Inputs
- `credentials.json` in project root (service account with Drive read access)
- `GOOGLE_DRIVE_FILE_ID` in `.env` (value: `1V2_mY3ytslbclDLdOoOTOklR9hQ_WsuHAQdl15pAuHw`)
- Python dependencies installed (see below)

## Dependencies
```
pip install google-auth google-auth-oauthlib google-api-python-client openpyxl python-dotenv
```

## Steps

### 1. Pull latest data & regenerate site
```bash
python tools/generate_site.py
```
This will:
- Download the xlsx from Drive using the service account
- Parse all relevant sheets (Timeline, Budget, Vendor Tracker, Schedule)
- Write fresh `docs/planner-7k2a/{index,reception,floor-plan}.html`

### 2. Review locally
Open `docs/planner-7k2a/index.html` in your browser and verify:
- [ ] Hero header shows correct countdown
- [ ] Quick stats bar shows current numbers
- [ ] Timeline rows show correct statuses (green=Booked, amber=Ongoing, gray=Not Started, red=Overdue)
- [ ] Budget table shows actuals where available
- [ ] Vendor cards show correct booked/unbooked state
- [ ] Day-of schedule renders cleanly

### 3. Commit & push to deploy
```bash
git add docs/planner-7k2a/
git commit -m "update dashboard"
git push
```
GitHub Pages auto-deploys from the **`master`** branch `/docs` folder within ~1 minute.

**Planner URL:** `https://tomyjeyan.com/planner-7k2a/`

These pages carry budget, vendor and guest data. They are deliberately kept out of
`docs/` root, unlinked from the invitation and marked `noindex`. Do not link to them
from any guest-facing page, and keep the folder name as-is — the obscure name is
part of the protection.

## GitHub Pages Setup (one-time)
1. Create repo on GitHub: `gh repo create tj-wedding --public --source=. --push`
2. Go to repo Settings → Pages → Source: **Deploy from branch** → Branch: `master`, Folder: `/docs`
3. Save. The URL will be `https://<username>.github.io/tj-wedding/`

## Sheets Read
| Sheet | Purpose |
|-------|---------|
| `Timeline  Task List` | Planning milestones with status & deadlines |
| `Budget` | Category ranges + actual spend |
| `Vendor Tracker` | Vendor names + booked status |
| `Schedule` | Dec 27 day-of timeline |

## Status Color Logic
| Status | Display |
|--------|---------|
| Booked / Done | Green badge |
| Ongoing | Amber badge |
| Not Started | Gray badge |
| Overdue (deadline past + not booked) | Red badge + red row tint |

## Notes
- The `Guest List` sheet is currently empty; guest count shows "TBD" on the dashboard.
- The `Receipts` and `Theme & Pegs` sheets are not displayed (unstructured data).
- Schedule emojis/special characters are stripped to avoid encoding issues on Windows.
- Re-run anytime the xlsx is updated — no manual edits to the generated pages needed.
- The generator writes the three planner pages only. It never touches `docs/index.html`,
  which since Jul 31, 2026 **is the invitation itself**, served at https://tomyjeyan.com.
  (`docs/lanterns.html` is now just a redirect stub for links shared before the move.)
