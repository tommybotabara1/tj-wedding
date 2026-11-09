/* Every database read and write for the contest. Each function takes the D1
   database first. Rows come back as plain snake_case objects, except moments
   (shortlist parsed into an array) and settings (the camelCase shape). */

export const DEFAULT_SETTINGS = {
  contest: 'auto',
  screen: '{"mode":"wall"}',
  skip_check: '0',
  practice: '0',
  snapshot: '',
  gemini_ok: '',
  gemini_err: '',
};

const ENTRY_COLUMNS = [
  'id', 'device', 'guest', 'moment', 'kind', 'mime', 'size', 'session_key', 'drive_id', 'copy_id',
  'token_hash', 'check_state', 'check_tries', 'copy_tries', 'fit', 'quality', 'note', 'operator',
  'removed_at', 'practice', 'created_at',
];

const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();

/* ---------- settings ---------- */

function num(v) {
  const n = Number(v);
  return v === '' || v == null || !Number.isFinite(n) ? null : n;
}

function parseScreen(raw) {
  try {
    const s = JSON.parse(raw);
    if (s && typeof s.mode === 'string') return s;
  } catch { /* fall through */ }
  return { mode: 'wall' };
}

export async function getSettings(db) {
  const rows = await all(db, 'SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return {
    contest: s.contest,
    screen: parseScreen(s.screen),
    skipCheck: s.skip_check === '1',
    practice: s.practice === '1',
    snapshot: s.snapshot,
    geminiOk: num(s.gemini_ok),
    geminiErr: num(s.gemini_err),
  };
}

export async function putSetting(db, key, value) {
  await run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

/* ---------- moments ---------- */

function momentRow(r) {
  if (!r) return null;
  let shortlist = [];
  try { shortlist = JSON.parse(r.shortlist); } catch { /* keep [] */ }
  return { ...r, shortlist: Array.isArray(shortlist) ? shortlist : [] };
}

export async function listMoments(db) {
  return (await all(db, 'SELECT * FROM moments ORDER BY sort')).map(momentRow);
}

export async function getMoment(db, id) {
  return momentRow(await one(db, 'SELECT * FROM moments WHERE id = ?', id));
}

export async function updateMoment(db, id, { phase, shortlist, winner } = {}) {
  const sets = [];
  const args = [];
  if (phase !== undefined) { sets.push('phase = ?'); args.push(phase); }
  if (shortlist !== undefined) { sets.push('shortlist = ?'); args.push(JSON.stringify(shortlist)); }
  if (winner !== undefined) { sets.push('winner = ?'); args.push(winner); }
  if (!sets.length) return;
  await run(db, 'UPDATE moments SET ' + sets.join(', ') + ' WHERE id = ?', ...args, id);
}

/* ---------- entries ---------- */

export async function createEntry(db, row) {
  const cols = ENTRY_COLUMNS.filter((c) => row[c] !== undefined);
  await run(
    db,
    'INSERT INTO entries (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')',
    ...cols.map((c) => row[c]),
  );
}

export function getEntry(db, id) {
  return one(db, 'SELECT * FROM entries WHERE id = ?', id);
}

export async function entriesByIds(db, ids) {
  if (!ids.length) return [];
  return all(db, 'SELECT * FROM entries WHERE id IN (' + ids.map(() => '?').join(', ') + ')', ...ids);
}

// Records the Drive id of a finished original; null when no entry has that session key.
export async function attachOriginal(db, sessionKey, driveId) {
  return one(db, 'UPDATE entries SET drive_id = ? WHERE session_key = ? RETURNING *', driveId, sessionKey);
}

export async function setCopy(db, id, copyId) {
  await run(db, 'UPDATE entries SET copy_id = ? WHERE id = ?', copyId, id);
}

export async function setCheck(db, id, { state, fit, quality, note }) {
  await run(
    db,
    'UPDATE entries SET check_state = ?, fit = ?, quality = ?, note = ? WHERE id = ?',
    state, fit ?? null, quality ?? null, note ?? null, id,
  );
}

export async function bumpTries(db, id, column) {
  if (column !== 'check_tries' && column !== 'copy_tries') throw new Error('bad column ' + column);
  await run(db, 'UPDATE entries SET ' + column + ' = ' + column + ' + 1 WHERE id = ?', id);
}

export async function markRemoved(db, id, now) {
  await db.batch([
    db.prepare('UPDATE entries SET removed_at = ? WHERE id = ?').bind(now, id),
    db.prepare('DELETE FROM votes WHERE entry = ?').bind(id),
  ]);
}

export async function setOperator(db, id, value) {
  await run(db, 'UPDATE entries SET operator = ? WHERE id = ?', value, id);
}

export function recentEntries(db, limit) {
  return all(
    db,
    'SELECT * FROM entries WHERE removed_at IS NULL AND drive_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ?',
    limit,
  );
}

export function momentEntries(db, momentId) {
  return all(db, 'SELECT * FROM entries WHERE moment = ? ORDER BY created_at, id', momentId);
}

export function pendingChecks(db, before, limit) {
  return all(
    db,
    `SELECT * FROM entries WHERE copy_id IS NOT NULL AND removed_at IS NULL
       AND check_state IN ('pending', 'error') AND check_tries < 3 AND created_at < ?
     ORDER BY created_at LIMIT ?`,
    before, limit,
  );
}

export function missingCopies(db, before, limit) {
  return all(
    db,
    `SELECT * FROM entries WHERE drive_id IS NOT NULL AND copy_id IS NULL AND removed_at IS NULL
       AND copy_tries < 3 AND created_at < ?
     ORDER BY created_at LIMIT ?`,
    before, limit,
  );
}

export function practiceEntries(db) {
  return all(db, 'SELECT * FROM entries WHERE practice = 1 ORDER BY created_at');
}

export async function deletePractice(db) {
  await db.batch([
    db.prepare('DELETE FROM votes WHERE practice = 1 OR entry IN (SELECT id FROM entries WHERE practice = 1)'),
    db.prepare('DELETE FROM entries WHERE practice = 1'),
  ]);
}

/* ---------- votes ---------- */

export async function castVote(db, { moment, device, entry, practice, now }) {
  await run(
    db,
    `INSERT INTO votes (moment, device, entry, practice, at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(moment, device) DO UPDATE SET entry = excluded.entry, practice = excluded.practice, at = excluded.at`,
    moment, device, entry, practice ? 1 : 0, now,
  );
}

export function voteCounts(db, moment) {
  return all(db, 'SELECT entry, COUNT(*) AS n FROM votes WHERE moment = ? GROUP BY entry ORDER BY entry', moment);
}

export async function myVotes(db, device) {
  const out = {};
  for (const r of await all(db, 'SELECT moment, entry FROM votes WHERE device = ?', device)) out[r.moment] = r.entry;
  return out;
}

/* ---------- log ---------- */

export async function addLog(db, by, what, now) {
  await run(db, 'INSERT INTO log (at, by, what) VALUES (?, ?, ?)', now, by, what);
}

export function recentLog(db, n) {
  return all(db, 'SELECT at, by, what FROM log ORDER BY at DESC, rowid DESC LIMIT ?', n);
}
