/**
 * TJ Wedding — RSVP Google Apps Script
 *
 * Deploy this as a Google Apps Script Web App:
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * After deployment, copy the web app URL and paste it into the RSVP pages
 * (invitation.html / journey.html / lanterns.html) as RSVP_ENDPOINT.
 *
 * IMPORTANT: editing this code does NOT update the live site automatically.
 * You must paste it into script.google.com and create a NEW VERSION deployment
 * (Deploy → Manage deployments → edit → New version). The /exec URL stays the same.
 *
 * See workflows/rsvp_setup.md for full setup instructions.
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// The Google Sheet that stores responses ("TJ Weddings RSVPs").
// (This is the long string from the Sheet's URL, between /d/ and /edit.)
const SHEET_ID  = '1Jp_XgBngLZdp3x72IampqIi88QIIfh7mxFnnzC6NJlg';

// The sheet tab name where responses will be written.
const SHEET_TAB = 'RSVPs';

// Who gets notified when an RSVP arrives.
const NOTIFY_TO  = 'tjbo.4824@gmail.com';     // primary inbox for new RSVPs
const NOTIFY_BCC = 'tommybotabara@gmail.com'; // blind copy for the couple

// Display name + couple name used in outgoing email.
const SENDER_NAME = 'Tommy & Jeyan';
const COUPLE_NAME = 'Tommy & Jeyan';
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Handle GET requests — simple health check so you can verify the
 * deployment is live by visiting the URL in a browser.
 */
function doGet(e) {
  return jsonResponse({ status: 'ok', message: 'TJ Wedding RSVP endpoint is live.' });
}

/**
 * Handle POST requests from the RSVP forms.
 *
 * Expected JSON body:
 * {
 *   name:       string,       // required
 *   email:      string,       // optional
 *   attending:  "yes" | "no",
 *   party_size: number,
 *   guests:     string[],     // additional guest names (party_size - 1 entries)
 *   notes:      string,       // optional dietary / general notes
 *   website:    string        // HONEYPOT — must be empty (bots fill it)
 * }
 */
function doPost(e) {
  try {
    // Parse the incoming JSON payload
    const payload = JSON.parse(e.postData.contents);

    // ── Honeypot ──────────────────────────────────────────────────────────────
    // Real visitors never see or fill the "website" field. If it's populated,
    // this is almost certainly a bot — quietly accept and discard (return ok so
    // the bot doesn't retry), but write nothing and email no one.
    if ((payload.website || '').trim() !== '') {
      return jsonResponse({ status: 'ok' });
    }

    const name      = (payload.name      || '').trim();
    const email     = (payload.email     || '').trim();
    const attending = (payload.attending || '').trim();
    const partySize = parseInt(payload.party_size, 10) || 1;
    const guests    = Array.isArray(payload.guests) ? payload.guests.join(', ') : '';
    const notes     = (payload.notes     || '').trim();
    const timestamp = new Date().toISOString();

    if (!name) {
      return jsonResponse({ status: 'error', message: 'Name is required.' });
    }

    // ── Write the row (the critical step) ─────────────────────────────────────
    const ss   = SpreadsheetApp.openById(SHEET_ID);
    let sheet  = ss.getSheetByName(SHEET_TAB);

    // Auto-create the tab with headers if it doesn't exist yet
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_TAB);
      sheet.appendRow([
        'Timestamp', 'Name', 'Email', 'Attending',
        'Party Size', 'Additional Guests', 'Notes'
      ]);
      sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    }

    sheet.appendRow([timestamp, name, email, attending, partySize, guests, notes]);

    // ── Notifications (best-effort; never fail the RSVP over an email) ────────
    // The row is already saved above. If email sending throws, we log it and
    // still return ok so the guest isn't prompted to resubmit (which would
    // create a duplicate row).
    try {
      sendCoupleNotification({ name, email, attending, partySize, guests, notes, timestamp });
      if (email) {
        sendGuestConfirmation({ name, email, attending, partySize, guests });
      }
    } catch (mailErr) {
      console.error('RSVP saved, but notification email failed:', mailErr);
    }

    return jsonResponse({ status: 'ok' });

  } catch (err) {
    console.error('RSVP handler error:', err);
    return jsonResponse({ status: 'error', message: err.message });
  }
}

/**
 * Email the couple a summary of the new RSVP.
 */
function sendCoupleNotification(r) {
  const attendingLabel = r.attending === 'yes' ? '✅ Attending' : '❌ Not attending';
  const subject = `RSVP: ${r.name} — ${r.attending === 'yes' ? 'attending' : 'regrets'}`;

  const rows = [
    ['Name', r.name],
    ['Email', r.email || '—'],
    ['Attending', attendingLabel],
    ['Party size', String(r.partySize)],
    ['Additional guests', r.guests || '—'],
    ['Notes', r.notes || '—'],
    ['Received', r.timestamp],
  ].map(function (kv) {
    return '<tr>' +
      '<td style="padding:6px 14px 6px 0;color:#8a7a6a;white-space:nowrap;vertical-align:top">' + kv[0] + '</td>' +
      '<td style="padding:6px 0;color:#2c2620">' + escapeHtml(kv[1]) + '</td>' +
      '</tr>';
  }).join('');

  const htmlBody =
    '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto">' +
      '<h2 style="font-weight:normal;color:#7a2438;margin:0 0 4px">New RSVP</h2>' +
      '<p style="color:#8a7a6a;margin:0 0 18px;font-size:13px">' + COUPLE_NAME + ' · December 27, 2026</p>' +
      '<table style="border-collapse:collapse;font-size:14px;width:100%">' + rows + '</table>' +
    '</div>';

  MailApp.sendEmail({
    to:       NOTIFY_TO,
    bcc:      NOTIFY_BCC,
    replyTo:  r.email || NOTIFY_TO,
    name:     SENDER_NAME + ' · RSVP',
    subject:  subject,
    htmlBody: htmlBody,
  });
}

/**
 * Send the guest a short branded confirmation that we received their RSVP.
 */
function sendGuestConfirmation(r) {
  const first = r.name.split(' ')[0] || r.name;

  const message = r.attending === 'yes'
    ? 'Your seat is booked — we can\'t wait to celebrate with you.' +
      (r.partySize > 1 ? ' We\'ve noted a party of ' + r.partySize + '.' : '')
    : 'Thank you for letting us know. We\'ll miss you, but we\'re grateful you replied.';

  const htmlBody =
    '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;text-align:center">' +
      '<p style="letter-spacing:3px;text-transform:uppercase;color:#b08d57;font-size:11px;margin:0 0 6px">The Wedding of</p>' +
      '<h1 style="font-weight:normal;font-style:italic;color:#7a2438;font-size:30px;margin:0 0 4px">' + COUPLE_NAME + '</h1>' +
      '<p style="color:#8a7a6a;font-size:13px;margin:0 0 22px">December 27, 2026 · Manila</p>' +
      '<p style="color:#2c2620;font-size:15px;line-height:1.6;margin:0 0 8px">Dear ' + escapeHtml(first) + ',</p>' +
      '<p style="color:#2c2620;font-size:15px;line-height:1.6;margin:0 0 22px">We\'ve received your RSVP. ' + message + '</p>' +
      '<p style="color:#8a7a6a;font-size:13px;line-height:1.6;margin:0">With love,<br>' + COUPLE_NAME + '</p>' +
    '</div>';

  MailApp.sendEmail({
    to:       r.email,
    name:     SENDER_NAME,
    replyTo:  NOTIFY_BCC,
    subject:  'We\'ve received your RSVP — ' + COUPLE_NAME,
    htmlBody: htmlBody,
  });
}

/**
 * Helper — escape user-supplied text before dropping it into an HTML email.
 */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Helper — return a JSON response.
 *
 * Apps Script ContentService can't set custom HTTP status codes, so the client
 * checks the `status` field in the JSON body. The redirect Apps Script issues
 * already carries Access-Control-Allow-Origin: *, so cross-origin fetch() reads
 * the response fine.
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
