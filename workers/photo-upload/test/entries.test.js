import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { handle } from '../src/index.js';
import { putSetting, updateMoment, getEntry, castVote, voteCounts } from '../src/store.js';
import { fakeGoogle, svcFor, req, resetDb } from './helpers.js';

const OPEN_DAY = Date.UTC(2026, 11, 27, 10, 0, 0);
const WRONG_KEY = 'f'.repeat(32);

async function call(request, svc) {
  const ctx = createExecutionContext();
  const res = await handle(request, env, ctx, svc);
  await waitOnExecutionContext(ctx);
  return res;
}

const startBody = (extra = {}) => ({ name: 'a.jpg', type: 'image/jpeg', size: 4, guest: 'Mae', ...extra });

async function begin(svc, extra) {
  const res = await call(req('POST', '/start', { json: startBody(extra) }), svc);
  return { res, body: await res.json() };
}

describe('contest entries', () => {
  let google, svc;
  beforeEach(async () => {
    await resetDb();
    google = fakeGoogle();
    svc = svcFor({ google, now: OPEN_DAY });
  });

  it('start with an open moment returns entry, key and moment', async () => {
    await putSetting(env.DB, 'contest', 'open');
    const { body } = await begin(svc, { moment: 'groufie', device: 'phone-1' });
    expect(body.session).toMatch(/upload_id=/);
    expect(body.moment).toBe('groufie');
    expect(body.key).toMatch(/^[0-9a-f]{32}$/);
    const row = await getEntry(env.DB, body.entry);
    expect(row.moment).toBe('groufie');
    expect(row.device).toBe('phone-1');
    expect(row.practice).toBe(0);
    expect(row.kind).toBe('photo');
    expect(row.token_hash).not.toBe(body.key);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('start with no moment or device is a plain share', async () => {
    const { res, body } = await begin(svc);
    expect(res.status).toBe(200);
    expect(body.moment).toBeNull();
    expect(body.entry).toBeTruthy();
    expect((await getEntry(env.DB, body.entry)).moment).toBeNull();
  });

  it('start before opening time stores the entry as a plain share', async () => {
    svc = svcFor({ google, now: Date.UTC(2026, 10, 20) });
    const { body } = await begin(svc, { moment: 'groufie', device: 'phone-1' });
    expect(body.moment).toBeNull();
    expect(body.entry).toBeTruthy();
    expect((await getEntry(env.DB, body.entry)).moment).toBeNull();
  });

  it('start for a moment in voting stores a plain share', async () => {
    await putSetting(env.DB, 'contest', 'open');
    await updateMoment(env.DB, 'groufie', { phase: 'voting' });
    const { body } = await begin(svc, { moment: 'groufie', device: 'phone-1' });
    expect(body.moment).toBeNull();
  });

  it('start in practice mode marks the entry practice', async () => {
    await putSetting(env.DB, 'practice', '1');
    const { body } = await begin(svc, { moment: 'aisle', device: 'p' });
    expect(body.moment).toBe('aisle');
    expect((await getEntry(env.DB, body.entry)).practice).toBe(1);
  });

  it('start still returns a session when D1 throws', async () => {
    const broken = { ...svc, db: { prepare() { throw new Error('d1 down'); } } };
    const { res, body } = await begin(broken, { moment: 'groufie', device: 'p' });
    expect(res.status).toBe(200);
    expect(body.session).toMatch(/upload_id=/);
    expect(body.entry).toBeNull();
    expect(body.key).toBeNull();
    expect(body.moment).toBeNull();
  });

  async function entryWithKey() {
    await putSetting(env.DB, 'contest', 'open');
    const { body } = await begin(svc, { moment: 'groufie', device: 'phone-1' });
    return body;
  }

  const copyReq = (entry, key, bytes = new Uint8Array(10)) =>
    req('POST', '/copy', { body: bytes, headers: { 'X-Entry': entry, 'X-Entry-Key': key, 'Content-Type': 'image/jpeg' } });

  it('copy with the wrong key is 403 entry-key', async () => {
    const e = await entryWithKey();
    const res = await call(copyReq(e.entry, WRONG_KEY), svc);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'entry-key' });
  });

  it('copy for an unknown entry is 404 no-entry', async () => {
    const res = await call(copyReq('nope', WRONG_KEY), svc);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'no-entry' });
  });

  it('copy over 1.5 MB is 413 too-big', async () => {
    const e = await entryWithKey();
    const res = await call(copyReq(e.entry, e.key, new Uint8Array(1.5 * 1024 ** 2 + 1)), svc);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: 'too-big' });
  });

  it('copy stores into the copies folder', async () => {
    const e = await entryWithKey();
    const res = await call(copyReq(e.entry, e.key), svc);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const made = google.calls.find((c) => c.fn === 'createSmall');
    expect(made.parents).toEqual(['copies-folder']);
    expect(made.name).toBe(e.entry + '.jpg');
    expect((await getEntry(env.DB, e.entry)).copy_id).toMatch(/^file-/);
  });

  async function finishedEntry() {
    const e = await entryWithKey();
    const done = await (await call(req('PUT', '/chunk', {
      body: new Uint8Array(4),
      headers: { 'X-Upload-Session': e.session, 'Content-Range': 'bytes 0-3/4' },
    }), svc)).json();
    await call(copyReq(e.entry, e.key), svc);
    return { ...e, original: done.file.id };
  }

  it('finishing the upload records the original on the entry', async () => {
    const e = await finishedEntry();
    expect((await getEntry(env.DB, e.entry)).drive_id).toBe(e.original);
  });

  const removeReq = (entry, key) => req('POST', '/remove', { json: { entry, key } });

  it('remove trashes both files and drops votes', async () => {
    const e = await finishedEntry();
    await castVote(env.DB, { moment: 'groufie', device: 'd1', entry: e.entry, practice: false, now: 1 });
    const res = await call(removeReq(e.entry, e.key), svc);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = await getEntry(env.DB, e.entry);
    expect(row.removed_at).toBe(OPEN_DAY);
    expect(google.files.get(e.original).trashed).toBe(true);
    expect(google.files.get(row.copy_id).trashed).toBe(true);
    expect(await voteCounts(env.DB, 'groufie')).toEqual([]);
  });

  it('remove twice still answers ok, and a wrong key is 403', async () => {
    const e = await finishedEntry();
    expect((await call(removeReq(e.entry, WRONG_KEY), svc)).status).toBe(403);
    expect((await call(removeReq(e.entry, e.key), svc)).status).toBe(200);
    const again = await call(removeReq(e.entry, e.key), svc);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
  });

  it('remove before the last piece lands trashes the original when it arrives', async () => {
    const e = await entryWithKey();
    expect((await call(removeReq(e.entry, e.key), svc)).status).toBe(200);
    const done = await (await call(req('PUT', '/chunk', {
      body: new Uint8Array(4),
      headers: { 'X-Upload-Session': e.session, 'Content-Range': 'bytes 0-3/4' },
    }), svc)).json();
    expect(done.done).toBe(true);
    expect(google.files.get(done.file.id).trashed).toBe(true);
  });
});
