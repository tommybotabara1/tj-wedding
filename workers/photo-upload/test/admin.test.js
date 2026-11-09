import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { handle } from '../src/index.js';
import {
  createEntry, getEntry, getMoment, updateMoment, putSetting, getSettings, castVote, voteCounts, recentLog,
} from '../src/store.js';
import { fakeGoogle, svcFor, req, resetDb } from './helpers.js';

const NOW = Date.UTC(2026, 11, 27, 10, 0, 0);
const ADMIN = 'test admin';

async function call(request, svc) {
  const ctx = createExecutionContext();
  const res = await handle(request, env, ctx, svc);
  await waitOnExecutionContext(ctx);
  return res;
}

let seq = 0;
async function mk(id, over = {}) {
  await createEntry(env.DB, {
    id, device: 'dev-' + id, guest: 'Guest ' + id, moment: 'aisle', kind: 'photo', mime: 'image/jpeg',
    drive_id: 'drive-' + id, copy_id: 'copy-' + id, check_state: 'shown', fit: 7, quality: 6,
    created_at: NOW - 100000 + (seq++), ...over,
  });
}

describe('control-page API', () => {
  let google, svc;
  beforeEach(async () => {
    await resetDb();
    seq = 0;
    google = fakeGoogle();
    svc = svcFor({ google, now: NOW });
  });

  const act = (body, { admin = ADMIN, password } = {}) =>
    call(req('POST', '/admin/act', { json: { by: 'Maya', ...body }, admin, password }), svc);
  const state = async () => (await call(req('GET', '/admin/state', { admin: ADMIN, password: null }), svc)).json();
  const mom = (st, id) => st.moments.find((m) => m.id === id);

  it('wrong admin password is 403', async () => {
    const res = await call(req('GET', '/admin/state', { admin: 'nope', password: null }), svc);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'admin-password' });
    expect((await call(req('GET', '/admin/state', { password: null }), svc)).status).toBe(403);
    expect((await act({ action: 'settings' }, { admin: 'nope' })).status).toBe(403);
  });

  it('guest password alone is 403', async () => {
    const res = await call(req('GET', '/admin/state', { admin: 'ToMyJeyan' }), svc);
    expect(res.status).toBe(403);
    expect((await call(req('GET', '/admin/state'), svc)).status).toBe(403);
  });

  it('state has the documented shape and needs no guest password', async () => {
    await mk('a');
    const res = await call(req('GET', '/admin/state', { admin: ADMIN, password: null }), svc);
    expect(res.status).toBe(200);
    const st = await res.json();
    expect(st.settings).toEqual({ contest: 'auto', open: true, skipCheck: false, practice: false });
    expect(st.screen).toEqual({ mode: 'wall', moment: null });
    expect(st.moments).toHaveLength(6);
    expect(st.counts).toEqual({ sent: 1, onWall: 1, waiting: 0 });
    expect(st.gemini).toEqual({ lastOk: null, lastError: null });
    expect(st.wall).toHaveLength(1);
    expect(st.log).toEqual([]);
  });

  it('waiting lists held, error and old pending entries', async () => {
    await mk('held', { check_state: 'held', note: 'blurry' });
    await mk('err', { check_state: 'error' });
    await mk('old', { check_state: 'pending', created_at: NOW - 10 * 60000 });
    await mk('fresh', { check_state: 'pending', created_at: NOW - 60000 });
    await mk('ok');
    const st = await state();
    expect(st.waiting.map((w) => w.id).sort()).toEqual(['err', 'held', 'old']);
    expect(st.waiting.find((w) => w.id === 'held')).toMatchObject({ state: 'held', note: 'blurry' });
    expect(st.counts.waiting).toBe(3);
  });

  it('actions are guarded by phase', async () => {
    await mk('a');
    expect((await act({ action: 'close-voting', moment: 'aisle' })).status).toBe(409);
    expect((await act({ action: 'open-voting', moment: 'aisle', shortlist: ['a'] })).status).toBe(200);
    const again = await act({ action: 'open-voting', moment: 'aisle', shortlist: ['a'] });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, error: 'wrong-phase' });
    expect((await act({ action: 'close-voting', moment: 'aisle' })).status).toBe(200);
    expect((await act({ action: 'reveal', moment: 'aisle', winner: 'a' })).status).toBe(200);
    expect((await act({ action: 'reveal', moment: 'aisle', winner: 'a' })).status).toBe(409);
  });

  it('open-voting freezes the given shortlist', async () => {
    await mk('a'); await mk('b');
    const res = await act({ action: 'open-voting', moment: 'aisle', shortlist: ['b', 'a'] });
    const st = await res.json();
    expect(mom(st, 'aisle')).toMatchObject({ phase: 'voting' });
    expect(mom(st, 'aisle').shortlist.map((i) => i.id)).toEqual(['b', 'a']);
    expect((await getMoment(env.DB, 'aisle')).shortlist).toEqual(['b', 'a']);
    await mk('c');
    expect((await getMoment(env.DB, 'aisle')).shortlist).toEqual(['b', 'a']);
  });

  it('open-voting checks the shortlist', async () => {
    await mk('a'); await mk('nodrive', { drive_id: null }); await mk('gone', { removed_at: 5 });
    const bad = async (shortlist) => (await act({ action: 'open-voting', moment: 'aisle', shortlist })).status;
    expect(await bad([])).toBe(400);
    expect(await bad(['a', 'nodrive'])).toBe(400);
    expect(await bad(['a', 'gone'])).toBe(400);
    expect(await bad(['a', 'missing'])).toBe(400);
    expect(await bad(['a', 'a'])).toBe(400);
    expect(await bad(['a', 'a1', 'a2', 'a3', 'a4', 'a5'])).toBe(400);
    expect((await getMoment(env.DB, 'aisle')).phase).toBe('entries');
  });

  async function voting(ids) {
    for (const id of ids) await mk(id);
    expect((await act({ action: 'open-voting', moment: 'aisle', shortlist: ids })).status).toBe(200);
  }
  const vote = (device, entry) => castVote(env.DB, { moment: 'aisle', device, entry, practice: false, now: 1 });

  it('reveal with a tie needs a winner from the leaders', async () => {
    await voting(['a', 'b', 'c']);
    await vote('d1', 'a'); await vote('d2', 'b'); await vote('d3', 'c');
    await act({ action: 'close-voting', moment: 'aisle' });
    const res = await act({ action: 'reveal', moment: 'aisle' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'pick-a-winner', leaders: ['a', 'b', 'c'] });
    await vote('d4', 'a'); await vote('d5', 'b');
    const tie = await act({ action: 'reveal', moment: 'aisle' });
    expect(tie.status).toBe(400);
    expect((await tie.json()).leaders).toEqual(['a', 'b']);
    expect((await act({ action: 'reveal', moment: 'aisle', winner: 'c' })).status).toBe(400);
    expect((await act({ action: 'reveal', moment: 'aisle', winner: 'b' })).status).toBe(200);
    expect((await getMoment(env.DB, 'aisle')).winner).toBe('b');
  });

  it('reveal with nobody voting asks for a pick among the live shortlist', async () => {
    await voting(['a', 'b']);
    await act({ action: 'close-voting', moment: 'aisle' });
    const res = await act({ action: 'reveal', moment: 'aisle' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'pick-a-winner', leaders: ['a', 'b'] });
    expect((await act({ action: 'reveal', moment: 'aisle', winner: 'a' })).status).toBe(200);
  });

  it('reveal with a single clear leader needs no winner', async () => {
    await voting(['a', 'b']);
    await vote('d1', 'b');
    await act({ action: 'close-voting', moment: 'aisle' });
    expect((await act({ action: 'reveal', moment: 'aisle' })).status).toBe(200);
    expect((await getMoment(env.DB, 'aisle')).winner).toBe('b');
  });

  it('removed entry never wins a reveal', async () => {
    await voting(['a', 'b', 'c']);
    await vote('d1', 'a'); await vote('d2', 'a'); await vote('d3', 'a'); await vote('d4', 'b'); await vote('d5', 'b');
    await act({ action: 'close-voting', moment: 'aisle' });
    expect((await act({ action: 'remove', entry: 'a' })).status).toBe(200);
    expect((await act({ action: 'reveal', moment: 'aisle', winner: 'a' })).status).toBe(400);
    expect((await act({ action: 'reveal', moment: 'aisle' })).status).toBe(200);
    expect((await getMoment(env.DB, 'aisle')).winner).toBe('b');
  });

  it('reveal from entries needs a winner or none', async () => {
    await mk('a');
    expect((await act({ action: 'reveal', moment: 'aisle' })).status).toBe(400);
    expect((await act({ action: 'reveal', moment: 'aisle', winner: 'nope' })).status).toBe(400);
    expect((await getMoment(env.DB, 'aisle')).phase).toBe('entries');
  });

  it('reveal from entries with winner none sets revealed with winner none', async () => {
    await mk('a');
    const res = await act({ action: 'reveal', moment: 'aisle', winner: 'none' });
    expect(res.status).toBe(200);
    expect(await getMoment(env.DB, 'aisle')).toMatchObject({ phase: 'revealed', winner: 'none' });
  });

  it('reveal from entries can award an entry directly', async () => {
    await mk('a');
    expect((await act({ action: 'reveal', moment: 'aisle', winner: 'a' })).status).toBe(200);
    expect((await getMoment(env.DB, 'aisle')).winner).toBe('a');
  });

  it('reveal moves the screen to winner mode', async () => {
    await mk('a');
    const st = await (await act({ action: 'reveal', moment: 'aisle', winner: 'a' })).json();
    expect(st.screen).toEqual({ mode: 'winner', moment: 'aisle' });
    expect((await getSettings(env.DB)).screen).toEqual({ mode: 'winner', moment: 'aisle' });
  });

  it('screen needs a moment for shortlist and winner', async () => {
    expect((await act({ action: 'screen', mode: 'shortlist' })).status).toBe(400);
    expect((await act({ action: 'screen', mode: 'winner', moment: 'nope' })).status).toBe(400);
    expect((await act({ action: 'screen', mode: 'bogus' })).status).toBe(400);
    const st = await (await act({ action: 'screen', mode: 'shortlist', moment: 'happy-tears' })).json();
    expect(st.screen).toEqual({ mode: 'shortlist', moment: 'happy-tears' });
    const wall = await (await act({ action: 'screen', mode: 'wall' })).json();
    expect(wall.screen).toEqual({ mode: 'wall', moment: null });
  });

  it('hide, show and remove are operator overrides', async () => {
    await mk('a', { check_state: 'held' });
    await act({ action: 'show', entry: 'a' });
    expect((await getEntry(env.DB, 'a')).operator).toBe('shown');
    await act({ action: 'hide', entry: 'a' });
    expect((await getEntry(env.DB, 'a')).operator).toBe('hidden');
    expect((await act({ action: 'hide', entry: 'missing' })).status).toBe(404);
    await act({ action: 'remove', entry: 'a' });
    expect((await getEntry(env.DB, 'a')).removed_at).toBe(NOW);
    expect(google.calls.filter((c) => c.fn === 'trash').map((c) => c.id).sort()).toEqual(['copy-a', 'drive-a']);
  });

  it('settings changes contest and skipCheck', async () => {
    const st = await (await act({ action: 'settings', contest: 'closed', skipCheck: true })).json();
    expect(st.settings).toMatchObject({ contest: 'closed', open: false, skipCheck: true });
    expect((await act({ action: 'settings', contest: 'sometimes' })).status).toBe(400);
    const back = await (await act({ action: 'settings', contest: 'auto', skipCheck: false })).json();
    expect(back.settings).toMatchObject({ contest: 'auto', open: true, skipCheck: false });
  });

  it('unknown action is 400', async () => {
    expect((await act({ action: 'dance' })).status).toBe(400);
  });

  it('practice round trip', async () => {
    await mk('real', { moment: 'groufie' });
    await updateMoment(env.DB, 'aisle', { phase: 'revealed', shortlist: ['real'], winner: 'real' });
    await putSetting(env.DB, 'screen', JSON.stringify({ mode: 'winner', moment: 'aisle' }));

    expect((await (await act({ action: 'practice-start' })).json()).settings.practice).toBe(true);
    expect((await act({ action: 'practice-start' })).status).toBe(409);

    await mk('p1', { practice: 1, moment: 'groufie' });
    await mk('p2', { practice: 1, moment: 'groufie' });
    await castVote(env.DB, { moment: 'groufie', device: 'x', entry: 'p1', practice: true, now: 1 });
    expect((await act({ action: 'open-voting', moment: 'groufie', shortlist: ['p1', 'p2'] })).status).toBe(200);
    await act({ action: 'screen', mode: 'shortlist', moment: 'groufie' });

    const st = await (await act({ action: 'practice-clear' })).json();
    expect(st.settings.practice).toBe(false);
    expect(await getEntry(env.DB, 'p1')).toBeNull();
    expect(await getEntry(env.DB, 'p2')).toBeNull();
    expect(await voteCounts(env.DB, 'groufie')).toEqual([]);
    for (const id of ['p1', 'p2']) {
      expect(google.calls).toContainEqual({ fn: 'trash', id: 'drive-' + id });
      expect(google.calls).toContainEqual({ fn: 'trash', id: 'copy-' + id });
    }
    expect(google.calls.some((c) => c.fn === 'trash' && c.id.endsWith('real'))).toBe(false);
    const groufie = await getMoment(env.DB, 'groufie');
    expect(groufie).toMatchObject({ phase: 'entries', winner: null });
    expect(groufie.shortlist).toEqual([]);
    expect(await getMoment(env.DB, 'aisle')).toMatchObject({ phase: 'revealed', winner: 'real', shortlist: ['real'] });
    const settings = await getSettings(env.DB);
    expect(settings.practice).toBe(false);
    expect(settings.snapshot).toBe('');
    expect(settings.screen).toEqual({ mode: 'winner', moment: 'aisle' });
    expect((await getEntry(env.DB, 'real')).removed_at).toBeNull();
    expect((await act({ action: 'practice-clear' })).status).toBe(409);
  });

  it('every action writes a log line with by', async () => {
    await mk('a');
    await act({ action: 'screen', mode: 'shortlist', moment: 'happy-tears', by: 'Maya' });
    await act({ action: 'open-voting', moment: 'groufie', shortlist: ['a'], by: 'Maya' });
    await act({ action: 'hide', entry: 'a', by: 'Maya' });
    await act({ action: 'practice-start', by: '  ' });
    await act({ action: 'practice-clear', by: 'x'.repeat(50) });
    const log = await recentLog(env.DB, 10);
    expect(log.map((l) => l.what)).toEqual([
      'Practice cleared', 'Practice started', 'Hide entry', 'Open voting: Groufie with the newlyweds', 'Screen: shortlist · Happy tears',
    ]);
    expect(log.map((l) => l.by)).toEqual(['x'.repeat(30), 'someone', 'Maya', 'Maya', 'Maya']);
    expect(log[0].at).toBe(NOW);
    const st = await state();
    expect(st.log).toHaveLength(5);
    expect(st.log[0]).toEqual({ at: NOW, by: 'x'.repeat(30), what: 'Practice cleared' });
  });

  it('a refused action writes no log line', async () => {
    await act({ action: 'close-voting', moment: 'aisle' });
    expect(await recentLog(env.DB, 10)).toEqual([]);
  });

  it('candidates include plain shares for topping up', async () => {
    await mk('best', { fit: 9, quality: 9 });
    await mk('low', { fit: 2, quality: 2 });
    await mk('plain', { moment: null, fit: null, quality: null });
    await mk('nodrive', { drive_id: null });
    await mk('gone', { removed_at: 5 });
    const st = await state();
    const cands = mom(st, 'aisle').candidates;
    const ids = cands.map((c) => c.id);
    expect(ids[0]).toBe('best');
    expect(ids).toContain('plain');
    expect(ids).toContain('low');
    expect(ids).not.toContain('nodrive');
    expect(ids).not.toContain('gone');
    expect(cands[0]).toMatchObject({ fit: 9, quality: 9, id: 'best' });
    expect(mom(st, 'groufie').candidates.map((c) => c.id)).toContain('plain');
  });

  it('moment state carries votes, tally and winner', async () => {
    await voting(['a', 'b']);
    await vote('d1', 'b');
    const m = mom(await state(), 'aisle');
    expect(m.tally).toEqual({ counts: { a: 0, b: 1 }, total: 1, leaders: ['b'] });
    expect(m.shortlist.map((s) => [s.id, s.votes])).toEqual([['a', 0], ['b', 1]]);
    expect(m.winner).toBeNull();
  });
});
