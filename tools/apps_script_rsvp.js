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

// ── The GUEST LIST (a different spreadsheet: the couple's "TJ MARRIAGE" planner) ──
// This is the invitee list the couple actually maintains, and it is what the RSVP
// form searches. This script executes as the account that OWNS that workbook, so no
// sharing step is needed.
const GUEST_SHEET_ID  = '1V2_mY3ytslbclDLdOoOTOklR9hQ_WsuHAQdl15pAuHw';
const GUEST_TAB       = 'Guest List';
const GUEST_RANGE     = 'A1:K1000';   // same bound tools/gws.py already uses
const GUEST_CACHE_KEY = 'guestlist-v1';
const GUEST_CACHE_TTL = 21600;        // 6h backstop — real freshness comes from the
                                      // onGuestListChange trigger, not from this clock
const GUEST_MIN_QUERY = 3;            // normalized chars before we answer at all
const GUEST_MAX_HITS  = 8;            // enough to pick a cousin out of a family, not a dump

// Titles that must not defeat a name match. Mirrors HONORIFICS in tools/reconcile_rsvps.py.
const HONORIFICS = {
  mr: 1, mrs: 1, ms: 1, miss: 1, dr: 1, sir: 1, madam: 1, maam: 1,
  atty: 1, engr: 1, rev: 1, hon: 1
};
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
 * Lookup body: { action: "lookup", name: string }   — searches the RSVPs sheet
 * Guests body: { action: "guests", name: string }   — searches the GUEST LIST
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = (payload.action || '');

    // Routing happens BEFORE the honeypot is read, deliberately: the form fills the
    // honeypot on read-only calls so that a stale deployment (one that predates these
    // actions) discards them instead of mistaking them for new RSVPs.
    if (action === 'lookup') return handleLookup(payload);
    if (action === 'guests') return handleGuestList(payload);
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

// ─── GUEST LIST ───────────────────────────────────────────────────────────────

/**
 * "Which invited guests match what this person typed?"
 *
 * Answers from the couple's live Guest List. The RSVP form gates on this: a name
 * that isn't here can't reply, and the `Pax` value caps how many seats they can
 * claim. Returns full names, because the guest has to recognise and tap their own.
 *
 * `source: 'guests'` in the response is load-bearing — it is how the form tells
 * "genuinely not on the list" apart from "this deployment is too old to know this
 * action". Without it, a stale backend would tell every real guest they aren't invited.
 */
function handleGuestList(payload) {
  const query = normalizeName(payload.name || '');
  if (query.length < GUEST_MIN_QUERY) {
    return jsonResponse({ status: 'ok', source: 'guests', matches: [] });
  }

  const guests = readGuestList();          // [[name, pax, table], ...]
  const qTokens = query.split(' ');
  const exact = [], starts = [], contains = [];

  for (let i = 0; i < guests.length; i++) {
    const row = guests[i];
    const key = normalizeName(row[0]);
    if (!key) continue;

    // Every word typed must appear SOMEWHERE in the stored name. Substring rather
    // than prefix, so "santos", "mar san" and "ria" all find Maria Santos, in any order.
    let all = true;
    for (let t = 0; t < qTokens.length; t++) {
      if (key.indexOf(qTokens[t]) === -1) { all = false; break; }
    }
    if (!all) continue;

    const hit = { name: row[0], pax: row[1], table: row[2] };
    if (key === query) exact.push(hit);
    else if (key.indexOf(query) === 0) starts.push(hit);
    else contains.push(hit);
  }

  const matches = exact.concat(starts, contains).slice(0, GUEST_MAX_HITS);
  return jsonResponse({ status: 'ok', source: 'guests', matches: matches });
}

/**
 * The Guest List as a compact [[name, pax, table], ...], cached.
 *
 * Columns are resolved BY HEADER NAME, the same way read_guests() does in
 * tools/generate_site.py — an honorific column was once inserted mid-sheet and broke
 * index-based parsing. Rows without an integer in the "#" column are skipped, same rule.
 */
function readGuestList() {
  const cache = CacheService.getScriptCache();
  const cached = readChunked(cache, GUEST_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through and rebuild */ }
  }

  const rows = fetchGuestRows_();
  if (!rows.length) return [];

  // Header row = the first one carrying all of name / side / pax.
  let head = -1, cols = null;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const lower = rows[r].map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });
    if (lower.indexOf('name') !== -1 && lower.indexOf('side') !== -1 && lower.indexOf('pax') !== -1) {
      head = r;
      cols = {
        num:   lower.indexOf('#'),
        name:  lower.indexOf('name'),
        pax:   lower.indexOf('pax'),
        table: firstOf(lower, ['table #', 'table#', 'table'])
      };
      break;
    }
  }
  if (head === -1) {
    console.error('Guest List: no header row containing name/side/pax was found.');
    return [];
  }

  const out = [];
  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r];
    const num = parseInt(String(cell(row, cols.num)).trim(), 10);
    if (isNaN(num)) continue;                       // legend rows, spacers, totals
    const name = String(cell(row, cols.name)).trim();
    if (!name) continue;
    const pax = Math.min(Math.max(parseInt(String(cell(row, cols.pax)).trim(), 10) || 1, 1), 8);
    const tbl = String(cell(row, cols.table)).trim();
    out.push([name, pax, tbl || null]);
  }

  writeChunked(cache, GUEST_CACHE_KEY, JSON.stringify(out), GUEST_CACHE_TTL);
  return out;
}

/**
 * Read the tab, preferring the Sheets REST API and falling back to SpreadsheetApp.
 *
 * REST first because the planner workbook is ~35 MB: openById loads the whole
 * spreadsheet model and costs seconds, while a values-get is one light request.
 *
 * But REST only works if the Sheets API is enabled on the Cloud project behind
 * this script — it isn't by default, and a fresh project answers 403 "Sheets API
 * has not been used in project N before or it is disabled". SpreadsheetApp has no
 * such requirement, so it is the safety net: slower on a cache miss, but it always
 * works. Enable the Sheets API (Apps Script editor → Services → Google Sheets API)
 * to get the fast path; nothing breaks either way.
 */
function fetchGuestRows_() {
  try {
    return fetchGuestRowsRest_();
  } catch (restErr) {
    console.warn('Guest List REST read unavailable, falling back to SpreadsheetApp: ' + restErr.message);
    return fetchGuestRowsApp_();
  }
}

function fetchGuestRowsRest_() {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + GUEST_SHEET_ID +
    '/values/' + encodeURIComponent(GUEST_TAB + '!' + GUEST_RANGE) +
    '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE';
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('REST ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 120));
  }
  return JSON.parse(res.getContentText()).values || [];
}

function fetchGuestRowsApp_() {
  const sheet = SpreadsheetApp.openById(GUEST_SHEET_ID).getSheetByName(GUEST_TAB);
  if (!sheet) throw new Error('Guest List tab "' + GUEST_TAB + '" not found.');
  // Bound the read to what actually exists, so we don't pull 1000 empty rows.
  const rows = Math.min(sheet.getLastRow(), 1000);
  const cols = Math.min(sheet.getLastColumn(), 11);
  if (!rows || !cols) return [];
  return sheet.getRange(1, 1, rows, cols).getDisplayValues();
}

/* ── cache freshness ──────────────────────────────────────────────────────────
   The couple edit the guest list constantly, so a time-based cache would always
   be showing someone a stale answer. Instead the cache lives for hours and is
   thrown away the instant the sheet changes. */

/** Installed trigger. RUN ONCE BY HAND from the editor's function dropdown. */
function installGuestListTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onGuestListChange') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onGuestListChange')
    .forSpreadsheet(GUEST_SHEET_ID)
    .onChange()
    .create();
  console.log('Guest List change trigger installed.');
}

function onGuestListChange(e) { clearGuestCache(); }

/** Manual escape hatch — run from the editor if a trigger ever misfires. */
function clearGuestCache() {
  const cache = CacheService.getScriptCache();
  const count = parseInt(cache.get(GUEST_CACHE_KEY + '-n'), 10) || 0;
  const keys = [GUEST_CACHE_KEY, GUEST_CACHE_KEY + '-n'];
  for (let i = 0; i < count; i++) keys.push(GUEST_CACHE_KEY + '-' + i);
  cache.removeAll(keys);
  console.log('Guest List cache cleared.');
}

/* CacheService caps a value at 100KB. ~300 guests is around 12KB so one key is
   normally plenty — but silently truncating the guest list would be the worst
   failure this script could have, so oversize spills into numbered chunks. */
const CACHE_CHUNK = 90000;

function writeChunked(cache, key, value, ttl) {
  if (value.length <= CACHE_CHUNK) {
    cache.putAll(pair(key, value, key + '-n', '0'), ttl);
    return;
  }
  const parts = {};
  let n = 0;
  for (let i = 0; i < value.length; i += CACHE_CHUNK) {
    parts[key + '-' + n] = value.slice(i, i + CACHE_CHUNK);
    n++;
  }
  parts[key + '-n'] = String(n);
  parts[key] = '';
  cache.putAll(parts, ttl);
}

function readChunked(cache, key) {
  const n = parseInt(cache.get(key + '-n'), 10);
  if (isNaN(n)) return null;
  if (n === 0) return cache.get(key) || null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = cache.get(key + '-' + i);
    if (part == null) return null;    // a chunk expired — rebuild rather than serve a stub
    out += part;
  }
  return out;
}

function pair(k1, v1, k2, v2) { const o = {}; o[k1] = v1; o[k2] = v2; return o; }
function cell(row, idx) { return (idx == null || idx < 0 || idx >= row.length) ? '' : (row[idx] == null ? '' : row[idx]); }
function firstOf(lower, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const at = lower.indexOf(aliases[i]);
    if (at !== -1) return at;
  }
  return -1;
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

/**
 * Like normalizeKey, but also drops honorifics — "Engr. Leslie R. Ang" → "leslie r ang".
 * Used for guest-list SEARCH only; the RSVP identity key stays normalizeKey so that
 * existing rows keep matching.
 */
function normalizeName(s) {
  const parts = normalizeKey(s).split(' ');
  const kept = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] && !HONORIFICS[parts[i]]) kept.push(parts[i]);
  }
  return kept.join(' ');
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
