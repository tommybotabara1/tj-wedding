/* The control page's API: GET /admin/state and POST /admin/act. Every action
   is one small function in ACTIONS that does its work and returns the line
   for the log; act() then writes the log and answers with the new state. */

import { Fail, clean, secretMatches } from './http.js';
import { toItem, liveShortlist, winnerItem } from './public.js';
import { contestOpen, opensAt, onWall, eligible, rankShortlist, tally, assertPhase } from './contest.js';
import { trashEntry } from './entries.js';
import {
  listMoments, getMoment, updateMoment, getSettings, putSetting, setOperator, voteCounts, addLog, recentLog,
  practiceEntries, deletePractice, momentEntryCounts, deleteEntry, updateMomentIf, recentEntries, momentEntries, entriesByIds, getEntry,
} from './store.js';

const SCAN = 300;            // newest entries to look through
const WALL_SIZE = 30;
const CANDIDATES = 30;
const WAITING_SHOWN = 30;    // the true total is in counts.waiting
const PRACTICE_BEFORE = 6 * 3600_000;   // practice is refused from here...
const PRACTICE_AFTER = 30 * 3600_000;   // ...until here, around the opening time
const PENDING_MS = 5 * 60 * 1000;
const bad = () => new Fail(400, 'bad-request');

export async function requireAdmin(request, env) {
  if (!(await secretMatches(request.headers.get('X-Admin-Password'), env.ADMIN_PASSWORD))) {
    throw new Fail(403, 'admin-password');
  }
}

/* ---------- state ---------- */

export async function state(env, svc, origin) {
  const now = svc.now();
  const db = svc.db;
  const settings = await getSettings(db);
  const moments = await listMoments(db);
  const titles = new Map(moments.map((m) => [m.id, m.title]));
  const rows = await recentEntries(db, SCAN); // not removed, original landed

  const items = new Map(); // one signed Item per entry, however many lists it is in
  const item = async (e) => {
    if (!items.has(e.id)) items.set(e.id, await toItem(e, e.moment ? titles.get(e.moment) : null, origin, env, now));
    return items.get(e.id);
  };
  const extra = async (e, more) => ({ ...(await item(e)), ...more });

  const counts = await momentEntryCounts(db);
  const out = [];
  for (const m of moments) {
    const { live, gone } = await liveShortlist(svc, m);
    const t = tally(m.shortlist, await voteCounts(db, m.id), gone);
    const shortlist = [];
    for (const x of live) shortlist.push({ ...(await item(x.entry)), n: x.n, votes: t.counts[x.entry.id] || 0 });

    // The server's own pick: eligible entries only, one per phone, best first.
    const mine = await momentEntries(db, m.id);
    const ranked = rankShortlist(mine, CANDIDATES);
    const proposed = ranked.slice(0, 5);
    const byId = new Map(rows.map((e) => [e.id, e]));
    for (const e of mine) if (!byId.has(e.id)) byId.set(e.id, e);
    const order = ranked.filter((id) => byId.has(id));
    const seen = new Set(order);
    // This moment's own entries first, so the one entry of a quiet moment is never crowded out.
    for (const mine of [true, false]) {
      for (const e of rows) {
        if (!seen.has(e.id) && (e.moment === m.id) === mine && order.length < CANDIDATES) { order.push(e.id); seen.add(e.id); }
      }
    }
    const candidates = [];
    for (const id of order.slice(0, CANDIDATES)) {
      const e = byId.get(id);
      candidates.push(await extra(e, {
        fit: e.fit, quality: e.quality, note: e.note, state: e.check_state, hidden: e.operator === 'hidden', shown: e.operator === 'shown',
      }));
    }

    out.push({
      id: m.id, title: m.title, phase: m.phase, entryCount: counts[m.id] || 0, shortlist, proposed, candidates, tally: t,
      winner: await winnerItem(env, svc, m, live, origin, now),
    });
  }

  const waitingRows = rows.filter((e) =>
    e.operator !== 'hidden' && e.operator !== 'shown' &&
    (e.check_state === 'held' || e.check_state === 'error' || (e.check_state === 'pending' && e.created_at < now - PENDING_MS)));
  const waiting = [];
  for (const e of waitingRows.slice(0, WAITING_SHOWN)) waiting.push(await extra(e, { state: e.check_state, note: e.note }));

  const onWallRows = rows.filter((e) => onWall(e, settings));
  const wall = [];
  for (const e of onWallRows.slice(0, WALL_SIZE)) wall.push(await item(e));

  return {
    settings: {
      contest: settings.contest,
      open: contestOpen(settings, now, opensAt(env)),
      skipCheck: settings.skipCheck,
      practice: settings.practice,
    },
    screen: { mode: settings.screen.mode, moment: settings.screen.moment || null },
    moments: out,
    waiting,
    wall,
    counts: { sent: rows.length, onWall: onWallRows.length, waiting: waitingRows.length },
    gemini: { lastOk: settings.geminiOk, lastError: settings.geminiErr },
    log: await recentLog(db, 10),
  };
}

/* ---------- actions ---------- */

const putScreen = (db, mode, moment) =>
  putSetting(db, 'screen', JSON.stringify(moment ? { mode, moment } : { mode }));

async function momentOf(db, body) {
  const m = typeof body.moment === 'string' ? await getMoment(db, body.moment) : null;
  if (!m) throw bad();
  return m;
}

async function entryOf(db, body) {
  const e = typeof body.entry === 'string' ? await getEntry(db, body.entry) : null;
  if (!e) throw new Fail(404, 'no-entry');
  return e;
}

const usable = (e) => !!e && !e.removed_at && !!e.drive_id;

// Who may win a reveal from `closed`: the leaders, or everyone still live if nobody has votes.
async function revealFromClosed(svc, m, winner) {
  const { live, gone } = await liveShortlist(svc, m);
  const t = tally(m.shortlist, await voteCounts(svc.db, m.id), gone);
  const pool = t.leaders.length ? t.leaders : live.map((x) => x.entry.id);
  if (winner === undefined) {
    if (t.leaders.length === 1) return t.leaders[0];
    throw new Fail(400, 'pick-a-winner', undefined, { leaders: pool });
  }
  if (winner === 'none' && !t.leaders.length) return 'none';
  if (!pool.includes(winner)) throw new Fail(400, 'pick-a-winner', undefined, { leaders: pool });
  return winner;
}

async function revealFromEntries(svc, winner) {
  if (winner === 'none') return 'none';
  if (typeof winner !== 'string') throw bad();
  const e = (await entriesByIds(svc.db, [winner]))[0];
  if (!usable(e)) throw bad();
  if (!e.copy_id || !eligible(e)) throw new Fail(400, 'not-eligible'); // never crown a held, unchecked or copy-less photo
  return winner;
}

// The write that counts: refuses (409) if another call already moved the phase.
async function guarded(svc, m, allowed, fields) {
  if (!(await updateMomentIf(svc.db, m.id, allowed, fields))) throw new Fail(409, 'wrong-phase');
}

const CLEAR_BATCH = 6; // practice rows per call, to stay under the free plan's 50 D1 queries per request

const ACTIONS = {
  async screen({ svc, body }) {
    const mode = body.mode;
    if (mode === 'wall') {
      await putScreen(svc.db, 'wall');
      return 'Screen: wall';
    }
    if (mode !== 'shortlist' && mode !== 'winner') throw bad();
    const m = await momentOf(svc.db, body);
    await putScreen(svc.db, mode, m.id);
    return 'Screen: ' + mode + ' · ' + m.title;
  },

  async 'open-voting'({ svc, body }) {
    const m = await momentOf(svc.db, body);
    assertPhase(m, ['entries', 'closed']);
    const ids = body.shortlist;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 || new Set(ids).size !== ids.length) throw bad();
    if (!ids.every((id) => typeof id === 'string')) throw bad();
    const rows = await entriesByIds(svc.db, ids);
    if (rows.length !== ids.length || !rows.every(usable)) throw bad();
    // Held, unchecked or hidden photos stay off the shortlist unless the operator Showed them first.
    if (!rows.every(eligible)) throw new Fail(400, 'not-eligible');
    if (new Set(rows.map((e) => e.device)).size !== rows.length) throw new Fail(400, 'one-per-phone');
    await guarded(svc, m, ['entries', 'closed'], { phase: 'voting', shortlist: ids });
    return 'Open voting: ' + m.title;
  },

  async 'close-voting'({ svc, body }) {
    const m = await momentOf(svc.db, body);
    assertPhase(m, ['voting']);
    await guarded(svc, m, ['voting'], { phase: 'closed' });
    return 'Close voting: ' + m.title;
  },

  async reveal({ svc, body }) {
    const m = await momentOf(svc.db, body);
    assertPhase(m, ['entries', 'closed']);
    const winner = m.phase === 'closed' ? await revealFromClosed(svc, m, body.winner) : await revealFromEntries(svc, body.winner);
    await guarded(svc, m, ['entries', 'closed'], { phase: 'revealed', winner });
    await putScreen(svc.db, 'winner', m.id);
    return 'Reveal: ' + m.title;
  },

  async hide({ svc, body }) {
    await setOperator(svc.db, (await entryOf(svc.db, body)).id, 'hidden');
    return 'Hide entry';
  },

  async show({ svc, body }) {
    await setOperator(svc.db, (await entryOf(svc.db, body)).id, 'shown');
    return 'Show entry';
  },

  async remove({ svc, body }) {
    const e = await entryOf(svc.db, body);
    if (!e.removed_at) await trashEntry(svc, e, svc.now());
    return 'Remove entry';
  },

  async settings({ svc, body }) {
    const said = [];
    if (body.contest !== undefined) {
      if (!['auto', 'open', 'closed'].includes(body.contest)) throw bad();
      await putSetting(svc.db, 'contest', body.contest);
      said.push('contest ' + body.contest);
    }
    if (body.skipCheck !== undefined) {
      if (typeof body.skipCheck !== 'boolean') throw bad();
      await putSetting(svc.db, 'skip_check', body.skipCheck ? '1' : '0');
      said.push('skip check ' + (body.skipCheck ? 'on' : 'off'));
    }
    return 'Settings: ' + (said.join(', ') || 'no change');
  },

  async 'practice-start'({ svc, env, body }) {
    const s = await getSettings(svc.db);
    if (s.practice) throw new Fail(409, 'wrong-phase');
    // Practice on the wedding day would put practice rows among real ones.
    const opens = Date.parse(opensAt(env));
    const now = svc.now();
    if (body.force !== true && now >= opens - PRACTICE_BEFORE && now < opens + PRACTICE_AFTER) throw new Fail(409, 'wedding-day');
    const moments = (await listMoments(svc.db)).map((m) => ({ id: m.id, phase: m.phase, shortlist: m.shortlist, winner: m.winner }));
    await putSetting(svc.db, 'snapshot', JSON.stringify({ moments, screen: s.screen, contest: s.contest, skipCheck: s.skipCheck }));
    await putSetting(svc.db, 'practice', '1');
    return 'Practice started';
  },

  // Works in bounded passes. A row goes only once its files are in the bin, so
  // a failed trash is retried by the next pass instead of being orphaned.
  async 'practice-clear'({ svc, out }) {
    const s = await getSettings(svc.db);
    if (!s.practice) throw new Fail(409, 'wrong-phase');
    const now = svc.now();
    for (const e of await practiceEntries(svc.db, CLEAR_BATCH)) {
      if ((await trashEntry(svc, e, now)).ok) await deleteEntry(svc.db, e.id);
    }
    const remaining = (await practiceEntries(svc.db)).length;
    if (remaining) {
      out.clearing = { remaining };
      return 'Practice clearing: ' + remaining + ' left';
    }
    await deletePractice(svc.db); // practice votes on real entries

    let snap = null;
    try { snap = JSON.parse(s.snapshot); } catch { /* no snapshot: reset below */ }
    const saved = new Map(((snap && snap.moments) || []).map((m) => [m.id, m]));
    for (const m of await listMoments(svc.db)) {
      const was = saved.get(m.id) || {};
      await updateMoment(svc.db, m.id, { phase: was.phase || 'entries', shortlist: was.shortlist || [], winner: was.winner ?? null });
    }
    await putSetting(svc.db, 'screen', JSON.stringify((snap && snap.screen) || { mode: 'wall' }));
    // Switches changed during practice (say, contest closed) go back as they were.
    if (snap && ['auto', 'open', 'closed'].includes(snap.contest)) await putSetting(svc.db, 'contest', snap.contest);
    if (snap && typeof snap.skipCheck === 'boolean') await putSetting(svc.db, 'skip_check', snap.skipCheck ? '1' : '0');
    await putSetting(svc.db, 'practice', '0');
    await putSetting(svc.db, 'snapshot', '');
    return 'Practice cleared';
  },
};

export async function act(request, env, svc, origin) {
  let body;
  try { body = await request.json(); } catch { throw bad(); }
  if (!body || typeof body !== 'object') throw bad();
  const fn = Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
  if (!fn) throw bad();
  const out = {}; // extra fields for the reply (practice-clear's `clearing`)
  const what = await fn({ svc, env, body, out });
  await addLog(svc.db, clean(body.by, 30) || 'someone', what, svc.now());
  return { ...(await state(env, svc, origin)), ...out };
}
