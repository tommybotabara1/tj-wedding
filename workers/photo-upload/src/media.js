/* Signed media links. The page and the screen show photos through
   /m/<id>/<kind>?e=<exp>&s=<sig>; the signature is the only credential, so an
   image or video element can load them with no password header. Links last
   between 6 and 7 hours (to the next whole hour, plus 6 h) and a removed entry
   stops serving at once, whatever the link says. */

import { corsHeaders, json } from './http.js';
import { getEntry } from './store.js';

const HOUR = 3600;
const KINDS = ['copy', 'orig'];

function b64url(buf) {
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// One imported key per key string, for the life of the isolate: importing it
// for every link of every poll was a visible share of the CPU budget.
const keys = new Map();
function hmacKey(key) {
  const k = String(key);
  if (!keys.has(k)) {
    keys.set(k, crypto.subtle.importKey('raw', new TextEncoder().encode(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  }
  return keys.get(k);
}

async function sign(key, id, kind, exp) {
  const k = await hmacKey(key);
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${kind}.${exp}`));
  return b64url(mac).slice(0, 22);
}

export async function mediaUrl(origin, key, id, kind, nowMs) {
  const exp = (Math.floor(nowMs / 1000 / HOUR) + 1) * HOUR + 6 * HOUR;
  const sig = await sign(key, id, kind, exp);
  return `${origin}/m/${id}/${kind}?e=${exp}&s=${sig}`;
}

export async function verifyMedia(key, id, kind, exp, sig, nowMs) {
  if (!key || !KINDS.includes(kind) || !/^\d+$/.test(String(exp || '')) || !sig) return false;
  if (Number(exp) * 1000 <= nowMs) return false;
  const want = new TextEncoder().encode(await sign(key, id, kind, exp));
  const got = new TextEncoder().encode(String(sig));
  if (want.byteLength !== got.byteLength) return false;
  return crypto.subtle.timingSafeEqual(want, got);
}

function withCors(res, origin, extra = {}) {
  const h = new Headers(res.headers);
  const add = { ...corsHeaders(origin), 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length', ...extra };
  for (const [k, v] of Object.entries(add)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export async function serveMedia(request, env, svc, ctx) {
  const origin = request.headers.get('Origin') || '';
  const url = new URL(request.url);
  const notFound = () => json({ ok: false, error: 'not-found' }, 404, origin);

  const m = url.pathname.match(/^\/m\/([^/]+)\/(copy|orig)$/);
  if (!m) return notFound();
  const [, id, kind] = m;

  const ok = await verifyMedia(env.MEDIA_KEY, id, kind, url.searchParams.get('e'), url.searchParams.get('s'), svc.now());
  if (!ok) return notFound();

  const entry = await getEntry(svc.db, id);
  if (!entry || entry.removed_at) return notFound();

  if (kind === 'copy') {
    if (!entry.copy_id) return notFound();
    const cacheKey = new Request(`${url.origin}/m/${id}/copy`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return withCors(cached, origin);

    const up = await svc.google.media(entry.copy_id);
    if (!up.ok) return notFound();
    const stored = new Response(await up.arrayBuffer(), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    });
    ctx.waitUntil(caches.default.put(cacheKey, stored.clone()));
    return withCors(stored, origin);
  }

  if (!entry.drive_id) return notFound();
  const up = await svc.google.media(entry.drive_id, request.headers.get('Range') || undefined);
  if (up.status !== 200 && up.status !== 206) return notFound();
  const extra = {
    'Content-Type': entry.mime || up.headers.get('Content-Type') || 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
  };
  const range = up.headers.get('Content-Range');
  if (range) extra['Content-Range'] = range;
  const len = up.headers.get('Content-Length');
  if (len) extra['Content-Length'] = len;
  return withCors(up, origin, extra);
}
