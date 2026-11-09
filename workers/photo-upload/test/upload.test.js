import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { handle } from '../src/index.js';
import { fakeGoogle, svcFor, req, resetDb } from './helpers.js';

async function call(request, svc) {
  const ctx = createExecutionContext();
  const res = await handle(request, env, ctx, svc);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('guest upload endpoints', () => {
  let google, svc;
  beforeEach(async () => {
    await resetDb();
    google = fakeGoogle();
    svc = svcFor({ google, now: Date.UTC(2026, 11, 27, 10, 42, 10) });
  });

  it('rejects a wrong password with 403 password', async () => {
    const res = await call(req('GET', '/ping', { password: 'nope' }), svc);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'password' });
  });

  it('ping reports drive:true when configured', async () => {
    const res = await call(req('GET', '/ping'), svc);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, drive: true });
  });

  it('start names the file "<stamp> · <guest> · <original>" in the guest folder', async () => {
    const res = await call(req('POST', '/start', {
      json: { name: 'IMG_1.jpg', type: 'image/jpeg', size: 1234, guest: 'Auntie Mae' },
    }), svc);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('2026-12-27 18.42.10 · Auntie Mae · IMG_1.jpg');
    expect(body.session).toMatch(/upload_id=/);
    const started = google.calls.find((c) => c.fn === 'startUpload');
    expect(started.parents).toEqual(['guest-folder']);
    expect(started.appProperties.source).toBe('tomyjeyan-photos');
    expect(started.name).toBe(body.name);
  });

  it('start refuses non-photo/video with 415', async () => {
    const res = await call(req('POST', '/start', {
      json: { name: 'notes.pdf', type: 'application/pdf', size: 10, guest: 'X' },
    }), svc);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ ok: false, error: 'not-photo-or-video' });
  });

  it('chunk passes Content-Range through and returns {next}', async () => {
    const { session } = await (await call(req('POST', '/start', {
      json: { name: 'a.jpg', type: 'image/jpeg', size: 10, guest: 'X' },
    }), svc)).json();
    const res = await call(req('PUT', '/chunk', {
      body: new Uint8Array(4),
      headers: { 'X-Upload-Session': session, 'Content-Range': 'bytes 0-3/10' },
    }), svc);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ next: 4 });
    expect(google.calls.find((c) => c.fn === 'putPiece').range).toBe('bytes 0-3/10');
  });

  it('status returns {done, file}', async () => {
    const { session } = await (await call(req('POST', '/start', {
      json: { name: 'a.jpg', type: 'image/jpeg', size: 4, guest: 'X' },
    }), svc)).json();
    await call(req('PUT', '/chunk', {
      body: new Uint8Array(4),
      headers: { 'X-Upload-Session': session, 'Content-Range': 'bytes 0-3/4' },
    }), svc);
    const res = await call(req('GET', '/status?size=4', { headers: { 'X-Upload-Session': session } }), svc);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.done).toBe(true);
    expect(body.file.id).toMatch(/^file-/);
  });
});
