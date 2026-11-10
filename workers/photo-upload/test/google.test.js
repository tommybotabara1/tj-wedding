import { describe, it, expect, beforeEach } from 'vitest';
import { makeGoogle, resetTokenCache } from '../src/google.js';

const ENV = {
  GOOGLE_CLIENT_ID: 'x',
  GOOGLE_CLIENT_SECRET: 'x',
  GOOGLE_REFRESH_TOKEN: 'x',
  DRIVE_FOLDER_ID: 'guest-folder',
};
const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc';

const tokenReply = (expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: 'tok', expires_in: expiresIn }), { status: 200 });

/* A fetchImpl that answers the token endpoint itself and hands everything else
   to `handler`, recording every call. */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return tokenReply();
    return handler(String(url), init);
  };
  impl.calls = calls;
  return impl;
}

describe('google', () => {
  beforeEach(() => resetTokenCache());

  it('putPiece maps 308 Range bytes=0-8388607 to next 8388608', async () => {
    const f = fakeFetch(() => new Response(null, { status: 308, headers: { Range: 'bytes=0-8388607' } }));
    const g = makeGoogle(ENV, f);
    expect(await g.putPiece(SESSION, 'bytes 0-8388607/20000000', new ArrayBuffer(1))).toEqual({ next: 8388608 });
  });

  it('maps 404 to Fail 410 session-expired', async () => {
    const f = fakeFetch(() => new Response('gone', { status: 404 }));
    const g = makeGoogle(ENV, f);
    await expect(g.putPiece(SESSION, 'bytes 0-0/1', new ArrayBuffer(1)))
      .rejects.toMatchObject({ status: 410, code: 'session-expired' });
  });

  it('sessionUrl rejects a non-Drive address with bad-session', () => {
    const g = makeGoogle(ENV, fakeFetch(() => new Response('')));
    expect(() => g.sessionUrl('https://evil.example/upload/drive/v3/files?upload_id=1'))
      .toThrowError(expect.objectContaining({ status: 400, code: 'bad-session' }));
    expect(() => g.sessionUrl('')).toThrowError(expect.objectContaining({ code: 'bad-session' }));
    expect(g.sessionUrl(SESSION)).toBe(SESSION);
  });

  it('token is cached until a minute before expiry', async () => {
    const f = fakeFetch(() => new Response(''));
    const g = makeGoogle(ENV, f);
    const tokenCalls = () => f.calls.filter((c) => c.url.includes('oauth2')).length;
    expect(await g.token()).toBe('tok');
    expect(await g.token()).toBe('tok');
    expect(tokenCalls()).toBe(1);

    // Jump the clock to 59 minutes in: inside the last minute, so it refreshes.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 59 * 60_000 + 1;
      await g.token();
    } finally {
      Date.now = realNow;
    }
    expect(tokenCalls()).toBe(2);
  });

  it('createSmall sends multipart with parents', async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({ id: 'new-id' }), { status: 200 }));
    const g = makeGoogle(ENV, f);
    const out = await g.createSmall({
      name: 'small.jpg', parents: ['copies-folder'], type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]),
    });
    expect(out).toEqual({ id: 'new-id' });
    const call = f.calls.find((c) => c.url.includes('uploadType=multipart'));
    expect(call.init.headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    expect(call.init.headers.Authorization).toBe('Bearer tok');
    const text = new TextDecoder().decode(call.init.body);
    expect(text).toContain('"parents":["copies-folder"]');
    expect(text).toContain('"name":"small.jpg"');
    expect(text).toContain('Content-Type: image/jpeg');
  });

  it('media forwards Range', async () => {
    const f = fakeFetch(() => new Response('xx', { status: 206 }));
    const g = makeGoogle(ENV, f);
    const res = await g.media('abc', 'bytes=0-1');
    expect(res.status).toBe(206);
    const call = f.calls.find((c) => c.url.includes('alt=media'));
    expect(call.url).toContain('/drive/v3/files/abc');
    expect(call.init.headers.Range).toBe('bytes=0-1');
  });

  it('thumbnail asks Drive for 1600 px, replacing or adding the size', async () => {
    for (const [link, want] of [
      ['https://lh3.test/abc=s220', 'https://lh3.test/abc=s1600'],
      ['https://lh3.test/abc=s1600', 'https://lh3.test/abc=s1600'],
      ['https://lh3.test/abc', 'https://lh3.test/abc=s1600'],
    ]) {
      const f = fakeFetch((url) => (url.includes('fields=thumbnailLink')
        ? new Response(JSON.stringify({ thumbnailLink: link }), { status: 200 })
        : new Response(new Uint8Array([1, 2]), { status: 200 })));
      const out = await makeGoogle(ENV, f).thumbnail('abc');
      expect(Array.from(out)).toEqual([1, 2]);
      expect(f.calls.at(-1).url).toBe(want);
    }
  });

  it('thumbnail returns null when thumbnailLink is missing', async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    const g = makeGoogle(ENV, f);
    expect(await g.thumbnail('abc')).toBeNull();
  });
});
