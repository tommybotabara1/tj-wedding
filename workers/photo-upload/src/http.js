/* Shared plumbing: CORS, JSON replies, the Fail error, text helpers and the
   password compare. Nothing here talks to Google or the database. */

const ALLOWED_ORIGINS = [
  'https://tomyjeyan.com',
  'https://www.tomyjeyan.com',
];
// Local previews of docs/ (python -m http.server, the preview pane).
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originOk(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': originOk(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Content-Range, X-Photo-Password, X-Upload-Session, X-Admin-Password, X-Entry, X-Entry-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

export class Fail extends Error {
  constructor(status, code, detail, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.extra = extra; // more fields for the JSON body, e.g. {leaders}
  }
}

/* Same as norm() in docs/photos/index.html and normalize() in
   tools/set_photo_album.py. Keep the three in step. */
export function norm(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/^#+/, '');
}

// Constant-time compare: hash both sides so the lengths always match.
// An empty expected secret never matches, so an unset secret lets nobody in.
export async function secretMatches(given, expected) {
  if (!expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(norm(given))),
    crypto.subtle.digest('SHA-256', enc.encode(norm(expected))),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export function clean(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// "2026-12-27 18.42.10" in Philippine time, so files sort in the order of the day.
export function stamp(now) {
  const ph = new Date(now.getTime() + 8 * 3600 * 1000).toISOString();
  return ph.slice(0, 10) + ' ' + ph.slice(11, 19).replace(/:/g, '.');
}

export function randomId(bytes = 9) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = '';
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
