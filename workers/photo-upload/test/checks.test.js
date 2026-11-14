import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import worker, { handle } from '../src/index.js';
import { runCheck, runCron } from '../src/checks.js';
import { createEntry, getEntry, getSettings, setCopy, markRemoved } from '../src/store.js';
import { Fail, sha256hex } from '../src/http.js';
import { fakeGoogle, fakeGemini, svcFor, req, resetDb } from './helpers.js';

const NOW = Date.UTC(2026, 11, 27, 10, 0, 0);
const GOOD = { wallOk: true, fit: 8, quality: 7, note: 'ok' };
const entry = (o = {}) => ({
  id: 'e1', device: 'd', guest: 'Ann', moment: 'aisle', kind: 'photo', mime: 'image/jpeg', size: 4,
  session_key: 'sk-' + (o.id || 'e1'), token_hash: 'th', created_at: NOW - 5 * 60_000, ...o,
});

async function withCopy(google, o = {}) {
  const row = entry(o);
  await createEntry(env.DB, row);
  const f = await google.createSmall({ name: row.id + '.jpg', parents: [], type: 'image/jpeg', bytes: new Uint8Array([9, 9]) });
  await setCopy(env.DB, row.id, f.id);
  return row.id;
}

describe('checks', () => {
  let google;
  beforeEach(async () => { await resetDb(); google = fakeGoogle(); });

  it('runCheck marks shown and records gemini_ok', async () => {
    const id = await withCopy(google);
    const gemini = fakeGemini(() => GOOD);
    const svc = svcFor({ google, gemini, now: NOW });
    expect(await runCheck(env, svc, id)).toBe('shown');
    const row = await getEntry(env.DB, id);
    expect(row).toMatchObject({ check_state: 'shown', fit: 8, quality: 7, note: 'ok' });
    expect((await getSettings(env.DB)).geminiOk).toBe(NOW);
    expect(gemini.calls[0].moment.id).toBe('aisle');
    expect(gemini.calls[0].jpeg.byteLength).toBe(2);
  });

  it('stops calling Gemini once the daily cap is used, and starts again the next day', async () => {
    const ids = [];
    for (const n of [1, 2, 3]) ids.push(await withCopy(google, { id: 'cap' + n }));
    const gemini = fakeGemini(() => GOOD);
    const capped = { ...env, GEMINI_DAILY_CAP: '2' };
    const svc = svcFor({ google, gemini, now: NOW });
    expect(await runCheck(capped, svc, ids[0])).toBe('shown');
    expect(await runCheck(capped, svc, ids[1])).toBe('shown');
    expect(await runCheck(capped, svc, ids[2])).toBe('capped');
    expect(gemini.calls.length).toBe(2);
    const row = await getEntry(env.DB, ids[2]);
    expect(row.check_state).toBe('pending');
    expect(row.check_tries).toBe(0);
    expect((await getSettings(env.DB)).geminiErr).toBe(NOW);
    const tomorrow = svcFor({ google, gemini, now: NOW + 24 * 3600_000 });
    expect(await runCheck(capped, tomorrow, ids[2])).toBe('shown');
    expect(gemini.calls.length).toBe(3);
  });

  it('a cap of 0 turns Gemini off', async () => {
    const id = await withCopy(google);
    const gemini = fakeGemini(() => GOOD);
    expect(await runCheck({ ...env, GEMINI_DAILY_CAP: '0' }, svcFor({ google, gemini, now: NOW }), id)).toBe('capped');
    expect(gemini.calls.length).toBe(0);
  });

  it('runCheck holds an entry that is not wall-safe', async () => {
    const id = await withCopy(google);
    const svc = svcFor({ google, gemini: fakeGemini(() => ({ ...GOOD, wallOk: false })), now: NOW });
    expect(await runCheck(env, svc, id)).toBe('held');
    expect((await getEntry(env.DB, id)).check_state).toBe('held');
  });

  it('runCheck error bumps check_tries and records gemini_err', async () => {
    const id = await withCopy(google);
    const svc = svcFor({ google, gemini: fakeGemini(() => { throw new Fail(502, 'gemini'); }), now: NOW });
    expect(await runCheck(env, svc, id)).toBe('error');
    const row = await getEntry(env.DB, id);
    expect(row.check_state).toBe('error');
    expect(row.check_tries).toBe(1);
    expect((await getSettings(env.DB)).geminiErr).toBe(NOW);
  });

  it('runCheck skips removed entries and plain shares get a null moment', async () => {
    const gone = await withCopy(google, { id: 'gone' });
    await markRemoved(env.DB, gone, NOW);
    const gemini = fakeGemini(() => GOOD);
    const svc = svcFor({ google, gemini, now: NOW });
    expect(await runCheck(env, svc, gone)).toBe('skipped');
    expect(gemini.calls).toHaveLength(0);
    const plain = await withCopy(google, { id: 'plain', moment: null });
    await runCheck(env, svc, plain, new Uint8Array([1]));
    expect(gemini.calls[0].moment).toBeNull();
  });

  it('cron retries pending checks older than a minute only', async () => {
    const old = await withCopy(google, { id: 'old', created_at: NOW - 90_000 });
    const fresh = await withCopy(google, { id: 'fresh', created_at: NOW - 10_000 });
    const gemini = fakeGemini(() => GOOD);
    const out = await runCron(env, svcFor({ google, gemini, now: NOW }));
    expect(out.checked).toBe(1);
    expect((await getEntry(env.DB, old)).check_state).toBe('shown');
    expect((await getEntry(env.DB, fresh)).check_state).toBe('pending');
  });

  it('cron stops after 3 tries', async () => {
    const id = await withCopy(google);
    const gemini = fakeGemini(() => { throw new Fail(502, 'gemini'); });
    const svc = svcFor({ google, gemini, now: NOW });
    for (let i = 0; i < 5; i++) await runCron(env, svc);
    expect(gemini.calls).toHaveLength(3);
    expect((await getEntry(env.DB, id)).check_tries).toBe(3);
  });

  it('cron uses the Drive thumbnail when no small copy arrived', async () => {
    await createEntry(env.DB, entry({ id: 'big', drive_id: 'file-orig', created_at: NOW - 180_000 }));
    google.files.set('file-orig', { name: 'o.jpg', parents: [], bytes: new Uint8Array(5), trashed: false, thumbnail: new Uint8Array([7, 7, 7]) });
    const gemini = fakeGemini(() => GOOD);
    const out = await runCron(env, svcFor({ google, gemini, now: NOW }));
    expect(out.thumbs).toBe(1);
    const row = await getEntry(env.DB, 'big');
    expect(row.copy_id).toMatch(/^file-/);
    expect(row.check_state).toBe('shown');
    expect(gemini.calls).toHaveLength(1);
  });

  it('a cron run takes at most 5 checks and 2 small copies', async () => {
    for (let i = 0; i < 8; i++) await withCopy(google, { id: 'c' + i, created_at: NOW - 5 * 60_000 + i });
    for (let i = 0; i < 4; i++) {
      await createEntry(env.DB, entry({ id: 'm' + i, drive_id: 'f' + i, created_at: NOW - 600_000 + i }));
      google.files.set('f' + i, { name: 'o', parents: [], bytes: new Uint8Array(1), trashed: false, thumbnail: new Uint8Array([1]) });
    }
    const out = await runCron(env, svcFor({ google, gemini: fakeGemini(() => GOOD), now: NOW }));
    expect(out.thumbs).toBe(2);
    expect(out.checked).toBe(5);
  });

  it('a failed small copy waits longer before the next try', async () => {
    await createEntry(env.DB, entry({ id: 'slow', drive_id: 'file-s', created_at: NOW - 5 * 60_000 }));
    google.files.set('file-s', { name: 'o', parents: [], bytes: new Uint8Array(1), trashed: false });
    const thumbCalls = () => google.calls.filter((c) => c.fn === 'thumbnail').length;
    await runCron(env, svcFor({ google, now: NOW }));                   // try 1 fails
    expect(thumbCalls()).toBe(1);
    await runCron(env, svcFor({ google, now: NOW + 60_000 }));          // 6 min after sending: under the 6 min wait
    expect(thumbCalls()).toBe(1);
    await runCron(env, svcFor({ google, now: NOW + 2 * 60_000 }));      // 7 min: past it
    expect(thumbCalls()).toBe(2);
  });

  it('cron counts a try when Drive has no thumbnail yet', async () => {
    await createEntry(env.DB, entry({ id: 'nothumb', drive_id: 'file-x', created_at: NOW - 180_000 }));
    google.files.set('file-x', { name: 'o', parents: [], bytes: new Uint8Array(1), trashed: false });
    const out = await runCron(env, svcFor({ google, now: NOW }));
    expect(out.thumbs).toBe(0);
    const row = await getEntry(env.DB, 'nothumb');
    expect(row.copy_tries).toBe(1);
    expect(row.copy_id).toBeNull();
  });

  it('copy upload triggers an immediate check', async () => {
    const key = 'a'.repeat(32);
    await createEntry(env.DB, entry({ id: 'live', created_at: NOW, token_hash: await sha256hex(key) }));
    const gemini = fakeGemini(() => GOOD);
    const svc = svcFor({ google, gemini, now: NOW });
    const ctx = createExecutionContext();
    const res = await handle(
      req('POST', '/copy', { body: new Uint8Array([1, 2, 3]), headers: { 'X-Entry': 'live', 'X-Entry-Key': key, 'Content-Type': 'image/jpeg' } }),
      env, ctx, svc,
    );
    expect(res.status).toBe(200);
    await waitOnExecutionContext(ctx);
    expect((await getEntry(env.DB, 'live')).check_state).toBe('shown');
    expect(gemini.calls[0].jpeg.byteLength).toBe(3);
  });

  it('scheduled runs the catch-up', async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);
  });
});
