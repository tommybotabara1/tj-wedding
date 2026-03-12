/**
 * TJ Wedding — RSVP Google Apps Script
 *
 * Deploy this as a Google Apps Script Web App:
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * After deployment, copy the web app URL and paste it into
 * invitation.html as the RSVP_ENDPOINT constant.
 *
 * See workflows/rsvp_setup.md for full setup instructions.
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Paste the ID of your Google Sheet here.
// The ID is the long string in the Sheet's URL:
//   https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';

// The sheet tab name where responses will be written.
const SHEET_TAB = 'RSVPs';
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Handle GET requests — simple health check so you can verify the
 * deployment is live by visiting the URL in a browser.
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'TJ Wedding RSVP endpoint is live.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests from the invitation page RSVP form.
 *
 * Expected JSON body:
 * {
 *   name:       string,       // required
 *   email:      string,       // optional
 *   attending:  "yes" | "no",
 *   party_size: number,
 *   guests:     string[],     // additional guest names (party_size - 1 entries)
 *   notes:      string        // optional dietary / general notes
 * }
 */
function doPost(e) {
  try {
    // Parse the incoming JSON payload
    const payload = JSON.parse(e.postData.contents);

    const name      = (payload.name      || '').trim();
    const email     = (payload.email     || '').trim();
    const attending = (payload.attending || '').trim();
    const partySize = parseInt(payload.party_size, 10) || 1;
    const guests    = Array.isArray(payload.guests) ? payload.guests.join(', ') : '';
    const notes     = (payload.notes     || '').trim();
    const timestamp = new Date().toISOString();

    if (!name) {
      return jsonResponse({ status: 'error', message: 'Name is required.' }, 400);
    }

    // Open the spreadsheet and target tab
    const ss   = SpreadsheetApp.openById(SHEET_ID);
    let sheet  = ss.getSheetByName(SHEET_TAB);

    // Auto-create the tab with headers if it doesn't exist yet
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_TAB);
      sheet.appendRow([
        'Timestamp',
        'Name',
        'Email',
        'Attending',
        'Party Size',
        'Additional Guests',
        'Notes'
      ]);
      // Bold the header row
      sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    }

    // Append the RSVP row
    sheet.appendRow([
      timestamp,
      name,
      email,
      attending,
      partySize,
      guests,
      notes
    ]);

    return jsonResponse({ status: 'ok' });

  } catch (err) {
    console.error('RSVP handler error:', err);
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}

/**
 * Helper — return a JSON response with CORS headers so the fetch()
 * call from the invitation page isn't blocked.
 */
function jsonResponse(data, statusCode) {
  // Apps Script ContentService doesn't support custom HTTP status codes,
  // but we include the status in the JSON body so the client can check it.
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
