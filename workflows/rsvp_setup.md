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

If you change the Apps Script code, you must **create a new deployment** for changes to take effect:
1. Click **Deploy** → **Manage deployments**.
2. Click the pencil icon on the active deployment.
3. Change the version to **New version**.
4. Click **Deploy**.

The URL stays the same — no need to update `invitation.html`.

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
