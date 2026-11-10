import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { handle } from '../src/index.js';
import { mediaUrl, verifyMedia } from '../src/media.js';
import { createEntry, markRemoved } from '../src/store.js';
import { fakeGoogle, svcFor, req, resetDb } from './helpers.js';

const NOW = Date.UTC(2026, 11, 27, 10, 30, 0);
const ORIGIN = 'https://upload.test';
const KEY = 'test-media-key';

async function call(request, svc) {
  const ctx = createExecutionContext();
  const res = await handle(request, env, ctx, svc);
  await waitOnExecutionContext(ctx);
  return res;
}

// A GET for a signed link, with no password, as an <img> would send it.
const getLink = (link, headers) => req('GET', link.slice(ORIGIN.length), { password: null, headers });

describe('signing keys', () => {
  it('imports each key once, however many links it signs', async () => {
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    try {
      for (let i = 0; i < 5; i++) await mediaUrl(ORIGIN, 'memo-test-key', 'e' + i, 'copy', NOW);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
});

describe('signed media links', () => {
  let google, svc;
  beforeEach(async () => {
    await resetDb();
    google = fakeGoogle();
    svc = svcFor({ google, now: NOW });
    google.files.set('drive-1', { name: 'a.mp4', bytes: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), trashed: false });
    google.files.set('copy-1', { name: 'a.jpg', bytes: new Uint8Array([255, 216, 255, 217]), trashed: false });
    await createEntry(env.DB, {
      id: 'e1', device: 'd1', guest: 'Mae', kind: 'video', mime: 'video/mp4',
      drive_id: 'drive-1', copy_id: 'copy-1', created_at: NOW - 1000,
    });
  });

  it('signature round-trips', async () => {
    const link = await mediaUrl(ORIGIN, KEY, 'e1', 'copy', NOW);
    const u = new URL(link);
    expect(u.pathname).toBe('/m/e1/copy');
    const exp = Number(u.searchParams.get('e'));
    // next whole hour (11:00) plus 6 h
    expect(exp).toBe(Date.UTC(2026, 11, 27, 17, 0, 0) / 1000);
    const sig = u.searchParams.get('s');
    expect(sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await verifyMedia(KEY, 'e1', 'copy', exp, sig, NOW)).toBe(true);
    expect(await verifyMedia(KEY, 'e1', 'orig', exp, sig, NOW)).toBe(false);
    expect(await verifyMedia('other-key', 'e1', 'copy', exp, sig, NOW)).toBe(false);

    const res = await call(getLink(link), svc);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://tomyjeyan.com');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([255, 216, 255, 217]);
  });

  it('expired link is 404', async () => {
    const link = await mediaUrl(ORIGIN, KEY, 'e1', 'copy', NOW);
    const later = svcFor({ google, now: NOW + 8 * 3600 * 1000 });
    expect((await call(getLink(link), later)).status).toBe(404);
  });

  it('tampered id is 404', async () => {
    await createEntry(env.DB, { id: 'e2', device: 'd2', guest: 'Bo', kind: 'photo', drive_id: 'drive-1', copy_id: 'copy-1', created_at: NOW });
    const link = await mediaUrl(ORIGIN, KEY, 'e1', 'copy', NOW);
    expect((await call(getLink(link.replace('/m/e1/', '/m/e2/')), svc)).status).toBe(404);
    expect((await call(getLink(link.replace(/s=.{3}/, 's=AAA')), svc)).status).toBe(404);
  });

  it('removed entry is 404', async () => {
    const link = await mediaUrl(ORIGIN, KEY, 'e1', 'copy', NOW);
    expect((await call(getLink(link), svc)).status).toBe(200);
    await markRemoved(env.DB, 'e1', NOW);
    expect((await call(getLink(link), svc)).status).toBe(404);
    const orig = await mediaUrl(ORIGIN, KEY, 'e1', 'orig', NOW);
    expect((await call(getLink(orig), svc)).status).toBe(404);
  });

  it('orig forwards Range and returns 206 from the fake', async () => {
    const link = await mediaUrl(ORIGIN, KEY, 'e1', 'orig', NOW);
    const res = await call(getLink(link, { Range: 'bytes=2-4' }), svc);
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 2-4/10');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://tomyjeyan.com');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([2, 3, 4]);
    expect(google.calls.find((c) => c.fn === 'media' && c.id === 'drive-1').range).toBe('bytes=2-4');
  });

  it('copy is fetched from Drive once, then served from the cache', async () => {
    // its own entry: the Worker cache outlives a test, so e1's copy may already be in it
    google.files.set('copy-c', { name: 'c.jpg', bytes: new Uint8Array([255, 216, 255, 217]), trashed: false });
    await createEntry(env.DB, { id: 'ec', device: 'dc', guest: 'Cy', kind: 'photo', mime: 'image/jpeg', drive_id: 'drive-1', copy_id: 'copy-c', created_at: NOW });
    const link = await mediaUrl(ORIGIN, KEY, 'ec', 'copy', NOW);
    await call(getLink(link), svc);
    const again = await mediaUrl(ORIGIN, KEY, 'ec', 'copy', NOW + 60000);
    const res = await call(getLink(again), svc);
    expect(res.status).toBe(200);
    expect(google.calls.filter((c) => c.fn === 'media' && c.id === 'copy-c')).toHaveLength(1);
  });
});
