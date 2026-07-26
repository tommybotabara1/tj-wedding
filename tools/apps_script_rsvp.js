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
 *
 * ─── ONE REPLY PER GUEST (added Jul 2026) ─────────────────────────────────────
 * The guest's NAME is the identity key. A normalized form of it ("Tomás  Botábara"
 * → "tomas botabara") lives in the Key column.
 *
 *   · submit  — upserts. First reply appends a row and mints a reference code
 *               (TJ-XXXX). A later reply under the same name OVERWRITES that row
 *               and bumps Revisions; the previous version is appended to the
 *               "RSVP History" tab so nothing is ever lost. The headcount in the
 *               RSVPs tab is therefore always one row per guest.
 *   · lookup  — answers "have we already heard from this name?" so the form can
 *               offer to reopen an existing reply instead of creating a second
 *               one. It only answers on a confident match (every word typed must
 *               prefix a word in the stored name, minimum 3 characters, at most
 *               3 results), so the endpoint can't be used to browse the list.
 *
 * The sheet is read by header NAME, and missing headers are appended on first
 * run — an existing RSVPs tab with the original 7 columns upgrades in place
 * without losing or reordering any data.
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// The Google Sheet that stores responses ("TJ Weddings RSVPs").
// (This is the long string from the Sheet's URL, between /d/ and /edit.)
const SHEET_ID  = '1Jp_XgBngLZdp3x72IampqIi88QIIfh7mxFnnzC6NJlg';

// The sheet tab name where responses will be written.
const SHEET_TAB = 'RSVPs';

// Every superseded version of a reply is appended here (audit trail).
const HISTORY_TAB = 'RSVP History';

// Who gets notified when an RSVP arrives.
const NOTIFY_TO  = 'tjbo.4824@gmail.com';     // primary inbox for new RSVPs
const NOTIFY_BCC = 'tommybotabara@gmail.com'; // blind copy for the couple

// Display name + couple name used in outgoing email.
const SENDER_NAME = 'Tommy & Jeyan';
const COUPLE_NAME = 'Tommy & Jeyan';

// Columns, in the order a fresh sheet gets them. Order here only matters for a
// brand-new tab; afterwards everything is looked up by header name.
const HEADERS = [
  'Timestamp', 'Name', 'Email', 'Attending', 'Party Size', 'Additional Guests',
  'Ceremony', 'Reception', 'Notes', 'Code', 'Key', 'Updated', 'Revisions'
];
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
 * Submit body:
 * {
 *   action:     "submit" (or omitted),
 *   name:       string,       // required — the identity key
 *   email:      string,       // optional
 *   attending:  "yes" | "no",
 *   party_size: number,
 *   guests:     string[],     // additional guest names (party_size - 1 entries)
 *   ceremony:   boolean,
 *   reception:  boolean,
 *   notes:      string,       // optional dietary / general notes
 *   code:       string,       // optional — reference code of the reply being updated
 *   website:    string        // HONEYPOT — must be empty (bots fill it)
 * }
 *
 * Lookup body: { action: "lookup", name: string }
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if ((payload.action || '') === 'lookup') {
      return handleLookup(payload);
    }
    return handleSubmit(payload);

  } catch (err) {
    console.error('RSVP handler error:', err);
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ─── SUBMIT ───────────────────────────────────────────────────────────────────

function handleSubmit(payload) {
  // ── Honeypot ────────────────────────────────────────────────────────────────
  // Real visitors never see or fill the "website" field. If it's populated,
  // this is almost certainly a bot — quietly accept and discard (return ok so
  // the bot doesn't retry), but write nothing and email no one.
  if ((payload.website || '').trim() !== '') {
    return jsonResponse({ status: 'ok', code: '', updated_existing: false });
  }

  const name      = String(payload.name || '').trim().replace(/\s+/g, ' ');
  const email     = String(payload.email || '').trim();
  const attending = String(payload.attending || '').trim() === 'yes' ? 'yes' : 'no';
  const partySize = attending === 'yes' ? Math.min(Math.max(parseInt(payload.party_size, 10) || 1, 1), 8) : 1;
  const guests    = Array.isArray(payload.guests) ? payload.guests.filter(String).join(', ') : '';
  const ceremony  = attending === 'yes' && payload.ceremony !== false;
  const reception = attending === 'yes' && payload.reception !== false;
  const notes     = String(payload.notes || '').trim();
  const key       = normalizeKey(name);
  const now       = new Date().toISOString();

  if (!key) {
    return jsonResponse({ status: 'error', message: 'Name is required.' });
  }

  // Serialize writes: two guests submitting at the same instant must not both
  // append a row for the same person.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (lockErr) { /* proceed anyway rather than lose the reply */ }

  let code, wasUpdate = false;
  try {
    const sheet = ensureSheet();
    const col   = headerMap(sheet);
    const found = findRowByKeyOrCode(sheet, col, key, String(payload.code || '').trim());

    if (found) {
      wasUpdate = true;
      archiveRow(sheet, col, found.row);                       // keep the superseded version
      code = String(found.values[col['Code'] - 1] || '') || makeCode();
      const revisions = (parseInt(found.values[col['Revisions'] - 1], 10) || 1) + 1;
      writeRow(sheet, col, found.row, {
        Timestamp: found.values[col['Timestamp'] - 1] || now,   // first-reply time is preserved
        Name: name, Email: email, Attending: attending, 'Party Size': partySize,
        'Additional Guests': guests, Ceremony: yn(ceremony), Reception: yn(reception),
        Notes: notes, Code: code, Key: key, Updated: now, Revisions: revisions
      });
    } else {
      code = makeCode();
      const row = sheet.getLastRow() + 1;
      writeRow(sheet, col, row, {
        Timestamp: now, Name: name, Email: email, Attending: attending, 'Party Size': partySize,
        'Additional Guests': guests, Ceremony: yn(ceremony), Reception: yn(reception),
        Notes: notes, Code: code, Key: key, Updated: now, Revisions: 1
      });
    }
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }

  // ── Notifications (best-effort; never fail the RSVP over an email) ──────────
  // The row is already saved above. If email sending throws, we log it and
  // still return ok so the guest isn't prompted to resubmit.
  try {
    sendCoupleNotification({
      name, email, attending, partySize, guests, notes, timestamp: now,
      ceremony, reception, code, wasUpdate
    });
    if (email) {
      sendGuestConfirmation({ name, email, attending, partySize, guests, code, wasUpdate });
    }
  } catch (mailErr) {
    console.error('RSVP saved, but notification email failed:', mailErr);
  }

  return jsonResponse({ status: 'ok', code: code, updated_existing: wasUpdate, updated: now });
}

// ─── LOOKUP ───────────────────────────────────────────────────────────────────

/**
 * "Do we already have a reply under this name?"
 *
 * Deliberately conservative so the endpoint can never be walked to dump the
 * guest list: at least 3 normalized characters, every typed word must be the
 * start of a word in the stored name, and at most 3 matches come back.
 */
function handleLookup(payload) {
  const query = normalizeKey(payload.name || '');
  if (query.length < 3) return jsonResponse({ status: 'ok', matches: [] });

  const sheet = ensureSheet();
  const col   = headerMap(sheet);
  const last  = sheet.getLastRow();
  if (last < 2) return jsonResponse({ status: 'ok', matches: [] });

  const width  = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, last - 1, width).getValues();
  const qTokens = query.split(' ');
  const matches = [];

  for (let i = 0; i < values.length && matches.length < 3; i++) {
    const row  = values[i];
    const name = String(row[col['Name'] - 1] || '').trim();
    if (!name) continue;
    const key = String(row[col['Key'] - 1] || '') || normalizeKey(name);
    if (!keyMatches(key, query, qTokens)) continue;

    matches.push({
      name: name,
      email: String(row[col['Email'] - 1] || ''),
      attending: String(row[col['Attending'] - 1] || 'no') === 'yes' ? 'yes' : 'no',
      party_size: parseInt(row[col['Party Size'] - 1], 10) || 1,
      guests: String(row[col['Additional Guests'] - 1] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
      ceremony: String(row[col['Ceremony'] - 1] || 'yes') !== 'no',
      reception: String(row[col['Reception'] - 1] || 'yes') !== 'no',
      notes: String(row[col['Notes'] - 1] || ''),
      code: String(row[col['Code'] - 1] || ''),
      updated: asIso(row[col['Updated'] - 1] || row[col['Timestamp'] - 1])
    });
  }

  return jsonResponse({ status: 'ok', matches: matches });
}

/** Exact key, or every typed word prefixes a distinct word of the stored name. */
function keyMatches(key, query, qTokens) {
  if (!key) return false;
  if (key === query) return true;
  const kTokens = key.split(' ');
  const used = {};
  for (let t = 0; t < qTokens.length; t++) {
    let hit = -1;
    for (let k = 0; k < kTokens.length; k++) {
      if (!used[k] && kTokens[k].indexOf(qTokens[t]) === 0) { hit = k; break; }
    }
    if (hit === -1) return false;
    used[hit] = true;
  }
  return true;
}

// ─── SHEET HELPERS ────────────────────────────────────────────────────────────

/** Open (or create) the RSVPs tab and make sure every header in HEADERS exists. */
function ensureSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_TAB);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Upgrade an older sheet in place: append only the headers it is missing, to
  // the right of whatever is already there. Existing data never moves.
  const width   = Math.max(sheet.getLastColumn(), 1);
  const present = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  const missing = HEADERS.filter(function (h) { return present.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, width + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  return sheet;
}

/** { 'Header Name': 1-based column index } */
function headerMap(sheet) {
  const width = sheet.getLastColumn();
  const row   = sheet.getRange(1, 1, 1, width).getValues()[0];
  const map   = {};
  row.forEach(function (h, i) { map[String(h).trim()] = i + 1; });
  return map;
}

/** Locate an existing reply by reference code first, then by normalized name. */
function findRowByKeyOrCode(sheet, col, key, code) {
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const width  = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, last - 1, width).getValues();

  if (code) {
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][col['Code'] - 1] || '').trim().toUpperCase() === code.toUpperCase()) {
        return { row: i + 2, values: values[i] };
      }
    }
  }
  for (let i = 0; i < values.length; i++) {
    // Rows written before this upgrade have no Key — fall back to the Name column.
    const rowKey = String(values[i][col['Key'] - 1] || '') || normalizeKey(values[i][col['Name'] - 1]);
    if (rowKey && rowKey === key) return { row: i + 2, values: values[i] };
  }
  return null;
}

/** Write a { header: value } object into one row, leaving unknown columns alone. */
function writeRow(sheet, col, row, data) {
  Object.keys(data).forEach(function (header) {
    const c = col[header];
    if (c) sheet.getRange(row, c).setValue(data[header]);
  });
}

/** Copy a row to the history tab before it gets overwritten. */
function archiveRow(sheet, col, row) {
  const ss = sheet.getParent();
  let hist = ss.getSheetByName(HISTORY_TAB);
  const width = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, width).getValues()[0];

  if (!hist) {
    hist = ss.insertSheet(HISTORY_TAB);
    hist.appendRow(['Superseded At'].concat(header));
    hist.getRange(1, 1, 1, width + 1).setFontWeight('bold');
    hist.setFrozenRows(1);
  }
  const values = sheet.getRange(row, 1, 1, width).getValues()[0];
  hist.appendRow([new Date().toISOString()].concat(values));
}

// ─── SMALL HELPERS ────────────────────────────────────────────────────────────

/** "Tomás  P. Botábara" → "tomas p botabara" */
function normalizeKey(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short, human-readable reference. No I/O/0/1 so it can be read aloud. */
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return 'TJ-' + out;
}

function yn(b) { return b ? 'yes' : 'no'; }

function asIso(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ─── EMAIL ────────────────────────────────────────────────────────────────────

/**
 * Email the couple a summary of the new (or updated) RSVP.
 */
function sendCoupleNotification(r) {
  const attendingLabel = r.attending === 'yes' ? '✅ Attending' : '❌ Not attending';
  const verb = r.wasUpdate ? 'updated' : (r.attending === 'yes' ? 'attending' : 'regrets');
  const subject = (r.wasUpdate ? 'RSVP UPDATED: ' : 'RSVP: ') + r.name + ' — ' + verb;

  const rows = [
    ['Name', r.name],
    ['Email', r.email || '—'],
    ['Attending', attendingLabel],
    ['Party size', String(r.partySize)],
    ['Additional guests', r.guests || '—'],
    ['Ceremony', r.ceremony ? 'yes' : 'no'],
    ['Reception', r.reception ? 'yes' : 'no'],
    ['Notes', r.notes || '—'],
    ['Reference', r.code || '—'],
    ['Received', r.timestamp],
  ].map(function (kv) {
    return '<tr>' +
      '<td style="padding:6px 14px 6px 0;color:#8a7a6a;white-space:nowrap;vertical-align:top">' + kv[0] + '</td>' +
      '<td style="padding:6px 0;color:#2c2620">' + escapeHtml(kv[1]) + '</td>' +
      '</tr>';
  }).join('');

  const htmlBody =
    '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto">' +
      '<h2 style="font-weight:normal;color:#7a2438;margin:0 0 4px">' + (r.wasUpdate ? 'Updated RSVP' : 'New RSVP') + '</h2>' +
      '<p style="color:#8a7a6a;margin:0 0 18px;font-size:13px">' + COUPLE_NAME + ' · December 27, 2026</p>' +
      (r.wasUpdate ? '<p style="color:#8a7a6a;margin:0 0 14px;font-size:13px">This replaced their earlier reply. The previous version is in the "' + HISTORY_TAB + '" tab.</p>' : '') +
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
    ? (r.wasUpdate ? 'We\'ve updated your reply — it replaces the earlier one, so you are counted once.' : 'Your seat is booked — we can\'t wait to celebrate with you.') +
      (r.partySize > 1 ? ' We\'ve noted a party of ' + r.partySize + '.' : '')
    : (r.wasUpdate ? 'We\'ve updated your reply to regrets. Thank you for letting us know.' : 'Thank you for letting us know. We\'ll miss you, but we\'re grateful you replied.');

  const htmlBody =
    '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;text-align:center">' +
      '<p style="letter-spacing:3px;text-transform:uppercase;color:#b08d57;font-size:11px;margin:0 0 6px">The Wedding of</p>' +
      '<h1 style="font-weight:normal;font-style:italic;color:#7a2438;font-size:30px;margin:0 0 4px">' + COUPLE_NAME + '</h1>' +
      '<p style="color:#8a7a6a;font-size:13px;margin:0 0 22px">December 27, 2026 · Manila</p>' +
      '<p style="color:#2c2620;font-size:15px;line-height:1.6;margin:0 0 8px">Dear ' + escapeHtml(first) + ',</p>' +
      '<p style="color:#2c2620;font-size:15px;line-height:1.6;margin:0 0 18px">' + message + '</p>' +
      (r.code ? '<p style="color:#8a7a6a;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 22px">Your reference · ' + escapeHtml(r.code) + '<br><span style="letter-spacing:0;text-transform:none;font-size:12px">Reopen the RSVP form any time to change your reply.</span></p>' : '') +
      '<p style="color:#8a7a6a;font-size:13px;line-height:1.6;margin:0">With love,<br>' + COUPLE_NAME + '</p>' +
    '</div>';

  MailApp.sendEmail({
    to:       r.email,
    name:     SENDER_NAME,
    replyTo:  NOTIFY_BCC,
    subject:  (r.wasUpdate ? 'Your RSVP has been updated — ' : 'We\'ve received your RSVP — ') + COUPLE_NAME,
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
