# RSVP Backend Setup

**Objective:** Deploy the Google Apps Script RSVP backend and wire it to the invitation page so guest responses land in a Google Sheet.

**Estimated time:** ~10 minutes

---

## Prerequisites

- A Google account (the same one that owns your Google Sheets)
- The invitation page deployed to GitHub Pages (or running locally for testing)

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.new](https://sheets.new) to create a new spreadsheet.
2. Name it **TJ Wedding RSVPs** (top-left where it says "Untitled spreadsheet").
3. Copy the **Sheet ID** from the URL bar:
   ```
   https://docs.google.com/spreadsheets/d/  ← SHEET_ID_HERE →  /edit
   ```
   The ID is the long alphanumeric string between `/d/` and `/edit`.

---

## Step 2 — Create the Apps Script project

1. Go to [script.google.com](https://script.google.com).
2. Click **New project** (top-left).
3. Rename the project to **TJ Wedding RSVP** (click "Untitled project" at the top).
4. Delete the default `function myFunction() {}` placeholder.
5. Paste the entire contents of `tools/apps_script_rsvp.js` into the editor.
6. Find the `SHEET_ID` constant near the top and replace `'YOUR_GOOGLE_SHEET_ID_HERE'` with the ID you copied in Step 1:
   ```js
   const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'; // example
   ```
7. Click the **Save** icon (or Ctrl+S / Cmd+S).

---

## Step 3 — Deploy the Web App

1. Click **Deploy** → **New deployment** (top-right).
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set the configuration:
   - **Description:** TJ Wedding RSVP v1
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Google may ask you to authorize the script — click through the OAuth flow and grant access.
6. Copy the **Web app URL** that appears (it looks like `https://script.google.com/macros/s/.../exec`).

---

## Step 4 — Wire it to the invitation page

1. Open `docs/invitation.html` in your editor.
2. Find this line near the bottom of the `<script>` block:
   ```js
   const RSVP_ENDPOINT = 'YOUR_APPS_SCRIPT_URL_HERE';
   ```
3. Replace the placeholder with the URL you copied:
   ```js
   const RSVP_ENDPOINT = 'https://script.google.com/macros/s/ABC123.../exec';
   ```
4. Save the file.

---

## Step 5 — Test the integration

### Quick smoke test (browser)
1. Open `docs/invitation.html` locally (or on GitHub Pages).
2. Scroll to the RSVP section.
3. Fill out the form with test data and submit.
4. Open your Google Sheet — you should see a new row with timestamp, name, and all fields.

### Verify the endpoint directly
Visit your Web App URL in a browser. You should see:
```json
{ "status": "ok", "message": "TJ Wedding RSVP endpoint is live." }
```

---

## Updating the deployment

> ⚠️ **The #1 gotcha — pasting + saving code does NOT update the live site.**
> A web app keeps serving the *deployed version* until you bump it. Editing,
> saving (Ctrl+S), running a function, or re-authorizing scopes changes nothing
> the public `/exec` URL sees. You must update the **existing** deployment to a
> new version. Do **not** click "New deployment" — that mints a *different* URL
> and leaves the old one (the one the site uses) on the old code.

To push code changes live:
1. Click **Deploy** → **Manage deployments**.
2. On the **existing** deployment (the one whose URL matches `RSVP_ENDPOINT`
   in the HTML), click the **pencil ✏️ (Edit)** icon.
3. Open the **Version** dropdown → choose **New version**.
4. Click **Deploy**.

The URL stays the same — no need to touch the HTML.

**How to tell whether your redeploy actually took effect:** submit a test RSVP
with the honeypot tripped (see below). If a spam row still lands in the Sheet,
or no notification email arrives, you're still on the old version — redo the
steps above on the *existing* deployment.

> First redeploy after adding email: Google will prompt you to re-authorize
> because the script now needs the *send email as you* scope. Approve it. (A
> "Security alert: you allowed TJ Wedding RSVP access…" email is normal.)

---

## What the backend does (current behaviour)

On each POST the Apps Script (`tools/apps_script_rsvp.js`):
1. **Honeypot check** — the forms include a hidden `website` field that humans
   never see. If it arrives non-empty, the request is treated as a bot: the
   script returns `{status:"ok"}` (so the bot doesn't retry) but writes nothing
   and emails no one.
2. **Writes the row** to the `RSVPs` tab (this is the critical, first step).
3. **Emails the couple** a summary → `tjbo.4824@gmail.com`, BCC
   `tommybotabara@gmail.com` (reply-to is set to the guest's address).
4. **Confirms to the guest** — if they gave an email, sends a short branded
   "we've received your RSVP" note.

Email is best-effort: it runs *after* the row is saved and inside its own
try/catch, so a mail hiccup can never lose an RSVP or cause a duplicate.

---

## Reconciling RSVPs against the guest list

`tools/reconcile_rsvps.py` cross-references RSVP responses against the real
guest list (the `Guest List` tab of the planner workbook) and reports: matched,
uncertain (likely typos), unknown (no match), not-yet-replied, and possible
duplicates. Test rows (names starting with `__`) are skipped automatically.

**One-time setup:** share the **TJ Weddings RSVPs** Google Sheet (Viewer is
enough) with the service account:
`tj-wedding-bot@river-karma-489806-i7.iam.gserviceaccount.com`

**Run:**
```
python tools/reconcile_rsvps.py
```
The RSVP Sheet ID defaults to the live sheet; override with `RSVP_SHEET_ID` in
`.env` if it ever changes.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Something went wrong" on submit | Apps Script not deployed or URL wrong | Verify the URL is correct and the deployment is active |
| Sheet not found error in script logs | `SHEET_ID` is wrong | Double-check the ID in `apps_script_rsvp.js` |
| Authorization error | Script needs re-authorization | Go to script.google.com → Run `doGet` manually → authorize |
| CORS error in browser console | Apps Script access set to restricted | Re-deploy with "Anyone" access |
| Rows appear but wrong columns | Sheet was created manually with different headers | Delete the tab (named "RSVPs") — the script will recreate it with the right headers |

---

## Sheet columns

The script writes these columns in order:

| Column | Content |
|--------|---------|
| A | Timestamp (ISO 8601) |
| B | Name |
| C | Email |
| D | Attending (yes/no) |
| E | Party size |
| F | Additional guest names (comma-separated) |
| G | Dietary notes |
