# Workflow: Generate & Deploy Wedding Dashboard

## Objective
Regenerate `docs/index.html` from the latest data in "TJ MARRIAGE.xlsx" on Google Drive and push it live to GitHub Pages.

## Required Inputs
- `credentials.json` in project root (service account with Drive read access)
- `GOOGLE_DRIVE_FILE_ID` in `.env` (value: `1XUmzEu2Z2kzwaIX-BAKi4zOKW1mDCTvx`)
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
- Write a fresh `docs/index.html`

### 2. Review locally
Open `docs/index.html` in your browser and verify:
- [ ] Hero header shows correct countdown
- [ ] Quick stats bar shows current numbers
- [ ] Timeline rows show correct statuses (green=Booked, amber=Ongoing, gray=Not Started, red=Overdue)
- [ ] Budget table shows actuals where available
- [ ] Vendor cards show correct booked/unbooked state
- [ ] Day-of schedule renders cleanly

### 3. Commit & push to deploy
```bash
git add docs/index.html
git commit -m "update dashboard"
git push
```
GitHub Pages auto-deploys from the `main` branch `/docs` folder within ~1 minute.

**Live URL:** `https://<your-username>.github.io/tj-wedding/`

## GitHub Pages Setup (one-time)
1. Create repo on GitHub: `gh repo create tj-wedding --public --source=. --push`
2. Go to repo Settings → Pages → Source: **Deploy from branch** → Branch: `main`, Folder: `/docs`
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
- Re-run anytime the xlsx is updated — no manual edits to `index.html` needed.
