import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { handle } from '../src/index.js';
import { getEntry, createEntry, updateMoment, putSetting, castVote, voteCounts, setOperator, markRemoved } from '../src/store.js';
import { toItem } from '../src/public.js';
import { fakeGoogle, svcFor, req, resetDb } from './helpers.js';

const NOW = Date.UTC(2026, 11, 27, 10, 0, 0);

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

async function shortlist(moment, ids, phase = 'voting') {
  for (const id of ids) await mk(id);
  await updateMoment(env.DB, moment, { phase, shortlist: ids });
}

describe('contest status, voting and the screen feed', () => {
  let svc;
  beforeEach(async () => {
    await resetDb();
    seq = 0;
    svc = svcFor({ google: fakeGoogle(), now: NOW });
  });

  const contest = async (device) => (await call(req('GET', '/contest' + (device ? '?device=' + device : '')), svc)).json();
  const aisle = (body) => body.moments.find((m) => m.id === 'aisle');

  it('routes need the guest password', async () => {
    expect((await call(req('GET', '/contest', { password: null }), svc)).status).toBe(403);
    expect((await call(req('GET', '/screen', { password: 'nope' }), svc)).status).toBe(403);
    expect((await call(req('POST', '/vote', { password: null, json: {} }), svc)).status).toBe(403);
  });

  it('contest status hides shortlist while taking entries', async () => {
    await mk('a');
    await updateMoment(env.DB, 'aisle', { shortlist: ['a'] }); // still in the entries phase
    const body = await contest();
    expect(body.open).toBe(true); // 2026-12-27 10:00 UTC is after the opening
    expect(body.practice).toBe(false);
    expect(body.opensAt).toBe('2026-12-26T16:00:00Z');
    expect(body.moments).toHaveLength(6);
    const m = aisle(body);
    expect(m).toMatchObject({ id: 'aisle', title: 'Here comes the bride', phase: 'entries', accepting: true, myVote: null, winner: null });
    expect(m.hint).toBe("Jeyan's walk down the church aisle.");
    expect(m).not.toHaveProperty('shortlist');
  });

  it('shortlist items are numbered 1-5 in stored order', async () => {
    await shortlist('aisle', ['c', 'a', 'b']);
    const m = aisle(await contest());
    expect(m.accepting).toBe(false);
    expect(m.shortlist.map((i) => [i.id, i.n])).toEqual([['c', 1], ['a', 2], ['b', 3]]);
    expect(m.shortlist[0]).toMatchObject({ kind: 'photo', guest: 'Guest c', moment: 'Here comes the bride' });
    expect(m.shortlist[0].copy).toMatch(/^https:\/\/upload\.test\/m\/c\/copy\?e=\d+&s=/);
    expect(m.shortlist[0].orig).toBeNull(); // a photo is shown from its copy
    expect(JSON.stringify(m)).not.toMatch(/"votes"|"count"/);
  });

  it('only a video carries an orig link', async () => {
    await mk('v', { kind: 'video', mime: 'video/mp4' });
    const e = await getEntry(env.DB, 'v');
    const item = await toItem(e, 'Here comes the bride', 'https://upload.test', env, NOW);
    expect(item.orig).toMatch(/^https:\/\/upload\.test\/m\/v\/orig\?e=\d+&s=/);
  });

  it('myVote reflects this device only', async () => {
    await shortlist('aisle', ['a', 'b']);
    await castVote(env.DB, { moment: 'aisle', device: 'phone-1', entry: 'b', practice: false, now: NOW });
    expect(aisle(await contest('phone-1')).myVote).toBe('b');
    expect(aisle(await contest('phone-2')).myVote).toBeNull();
    expect(aisle(await contest()).myVote).toBeNull();
  });

  it('vote while not voting is 409 voting-closed', async () => {
    await shortlist('aisle', ['a'], 'closed');
    const res = await call(req('POST', '/vote', { json: { moment: 'aisle', entry: 'a', device: 'p1' } }), svc);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('voting-closed');
    expect(await voteCounts(env.DB, 'aisle')).toEqual([]);
  });

  it('vote for an entry off the shortlist is 400', async () => {
    await shortlist('aisle', ['a']);
    await mk('z');
    const vote = (entry) => call(req('POST', '/vote', { json: { moment: 'aisle', entry, device: 'p1' } }), svc);
    for (const entry of ['z', 'nope']) {
      const res = await vote(entry);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('not-on-shortlist');
    }
    await setOperator(env.DB, 'a', 'hidden');
    expect((await vote('a')).status).toBe(400);
  });

  it('changing a vote keeps one vote', async () => {
    await shortlist('aisle', ['a', 'b']);
    await putSetting(env.DB, 'practice', '1');
    const vote = (entry) => call(req('POST', '/vote', { json: { moment: 'aisle', entry, device: 'p1' } }), svc);
    const first = await vote('a');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, myVote: 'a' });
    await vote('b');
    expect(await voteCounts(env.DB, 'aisle')).toEqual([{ entry: 'b', n: 1 }]);
    const row = await env.DB.prepare('SELECT practice FROM votes WHERE device = ?').bind('p1').first();
    expect(row.practice).toBe(1);
  });

  it('removed shortlisted entry is dropped from contest status', async () => {
    await shortlist('aisle', ['a', 'b', 'c', 'd', 'e']);
    await markRemoved(env.DB, 'b', NOW);
    const m = aisle(await contest());
    expect(m.shortlist.map((i) => [i.id, i.n])).toEqual([['a', 1], ['c', 3], ['d', 4], ['e', 5]]);
    // a vote for it is refused too
    const res = await call(req('POST', '/vote', { json: { moment: 'aisle', entry: 'b', device: 'p1' } }), svc);
    expect(res.status).toBe(400);
  });

  it('a removed or hidden winner is reported as null', async () => {
    await shortlist('aisle', ['a', 'b'], 'revealed');
    await updateMoment(env.DB, 'aisle', { winner: 'a' });
    let m = aisle(await contest());
    expect(m.winner).toMatchObject({ id: 'a', n: 1 });
    await setOperator(env.DB, 'a', 'hidden');
    m = aisle(await contest());
    expect(m.winner).toBeNull();
    await setOperator(env.DB, 'a', null);
    await updateMoment(env.DB, 'aisle', { winner: 'none' });
    expect(aisle(await contest()).winner).toBeNull();
  });

  it('a winner awarded directly (off any shortlist) shows on /contest and /screen', async () => {
    await mk('a');
    await updateMoment(env.DB, 'aisle', { phase: 'revealed', winner: 'a' });
    await putSetting(env.DB, 'screen', JSON.stringify({ mode: 'winner', moment: 'aisle' }));
    expect(aisle(await contest()).winner).toMatchObject({ id: 'a', guest: 'Guest a', moment: 'Here comes the bride' });
    let body = await (await call(req('GET', '/screen'), svc)).json();
    expect(body.mode).toBe('winner');
    expect(body.moment.winner).toMatchObject({ id: 'a', guest: 'Guest a' });
    await markRemoved(env.DB, 'a', NOW);
    expect(aisle(await contest()).winner).toBeNull();
    body = await (await call(req('GET', '/screen'), svc)).json();
    expect(body.moment.winner).toBeNull();
  });

  it('a directly awarded winner that is hidden, or only a pending reveal, is null', async () => {
    await mk('a');
    await updateMoment(env.DB, 'aisle', { phase: 'closed', winner: 'a' });
    expect(aisle(await contest()).winner).toBeNull();
    await updateMoment(env.DB, 'aisle', { phase: 'revealed' });
    await setOperator(env.DB, 'a', 'hidden');
    expect(aisle(await contest()).winner).toBeNull();
  });

  it('screen wall lists only onWall entries, newest first, max 40', async () => {
    for (let i = 0; i < 45; i++) await mk('w' + String(i).padStart(2, '0'), { moment: i === 44 ? null : 'aisle' });
    await mk('held', { check_state: 'held', created_at: NOW });
    await mk('hid', { operator: 'hidden', created_at: NOW });
    await mk('gone', { created_at: NOW });
    await markRemoved(env.DB, 'gone', NOW);
    await mk('nocopy', { copy_id: null, created_at: NOW });
    const res = await call(req('GET', '/screen'), svc);
    const body = await res.json();
    expect(body.mode).toBe('wall');
    expect(body.moment).toBeNull();
    expect(body.at).toBe(NOW);
    expect(body.wall).toHaveLength(40);
    expect(body.wall[0].id).toBe('w44');
    expect(body.wall[0].moment).toBeNull();
    expect(body.wall[1]).toMatchObject({ id: 'w43', moment: 'Here comes the bride' });
    expect(body.wall[39].id).toBe('w05');
    expect(body.wall.map((i) => i.id)).not.toContain('held');
    expect(body.wall.map((i) => i.id)).not.toContain('hid');
  });

  it('screen shortlist mode carries the vote total but no per-entry counts', async () => {
    await shortlist('aisle', ['a', 'b', 'c']);
    await putSetting(env.DB, 'screen', JSON.stringify({ mode: 'shortlist', moment: 'aisle' }));
    await castVote(env.DB, { moment: 'aisle', device: 'p1', entry: 'a', practice: false, now: NOW });
    await castVote(env.DB, { moment: 'aisle', device: 'p2', entry: 'a', practice: false, now: NOW });
    await castVote(env.DB, { moment: 'aisle', device: 'p3', entry: 'c', practice: false, now: NOW });
    const body = await (await call(req('GET', '/screen'), svc)).json();
    expect(body.mode).toBe('shortlist');
    expect(body.moment).toMatchObject({ id: 'aisle', title: 'Here comes the bride', votes: 3, winner: null });
    expect(body.moment.shortlist.map((i) => i.n)).toEqual([1, 2, 3]);
    expect(JSON.stringify(body.moment)).not.toMatch(/"count"|"votes":\{/);
    // a removed entry's votes stop counting
    await markRemoved(env.DB, 'a', NOW);
    const after = await (await call(req('GET', '/screen'), svc)).json();
    expect(after.moment.votes).toBe(1);
    expect(after.moment.shortlist.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('screen in winner mode shows the winner, and null once it is hidden', async () => {
    await shortlist('aisle', ['a', 'b'], 'revealed');
    await updateMoment(env.DB, 'aisle', { winner: 'b' });
    await putSetting(env.DB, 'screen', JSON.stringify({ mode: 'winner', moment: 'aisle' }));
    let body = await (await call(req('GET', '/screen'), svc)).json();
    expect(body.moment.winner).toMatchObject({ id: 'b', n: 2, guest: 'Guest b' });
    await setOperator(env.DB, 'b', 'hidden');
    body = await (await call(req('GET', '/screen'), svc)).json();
    expect(body.moment.winner).toBeNull();
  });

  it('toItem accepts a moment row, a title or null', async () => {
    await mk('t');
    const entry = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind('t').first();
    const a = await toItem(entry, { title: 'Happy tears' }, 'https://x.test', env, NOW, 2);
    const b = await toItem(entry, 'Happy tears', 'https://x.test', env, NOW);
    const c = await toItem(entry, null, 'https://x.test', env, NOW);
    expect(a).toMatchObject({ id: 't', n: 2, kind: 'photo', guest: 'Guest t', moment: 'Happy tears' });
    expect(b).not.toHaveProperty('n');
    expect(c.moment).toBeNull();
  });
});
