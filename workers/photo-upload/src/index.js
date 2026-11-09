/**
 * Photo upload — upload.tomyjeyan.com
 *
 * Guests shoot a photo or video on tomyjeyan.com/photos and it lands in a
 * folder in the couple's Google Drive, with no Google sign-in for the guest.
 * The page talks only to this Worker; the Worker holds the couple's Google
 * permission and passes each file on to Drive in pieces.
 *
 *   GET  /ping                       → {ok, drive}          password + config check
 *   POST /start  {name,type,size,guest} → {session}         opens a Drive upload
 *   PUT  /chunk  Content-Range, bytes → {next} | {done,file} one piece of it
 *   GET  /status?size=N  (X-Upload-Session) → {next} | {done,file}  where it got to
 *
 * Every call carries the guests' password in X-Photo-Password, checked against
 * the secret PHOTO_PASSWORD with the same forgiving match as the page
 * (capitals, spaces and a leading # don't matter).
 *
 * Google access is a refresh token for the couple's account with the
 * drive.file scope: the Worker can create files, and see only the files it
 * created. It cannot read anything else in their Drive. Secrets, all set by
 * tools/photo_drive_setup.py (or by hand with `npx wrangler secret put NAME`):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   DRIVE_FOLDER_ID   the folder uploads go into (kept out of the public repo)
 *   PHOTO_PASSWORD    what guests type, e.g. ToMyJeyan
 *
 * Drive's resumable upload: /start asks Drive for an upload session and hands
 * the session address back to the page. The page sends the file in 8 MB
 * pieces through /chunk; Drive answers 308 with how much it has, or 200 with
 * the finished file. A dropped connection resumes from /status instead of
 * starting the file over. Sessions stay open for about a week.
 */

const ALLOWED_ORIGINS = [
  'https://tomyjeyan.com',
  'https://www.tomyjeyan.com',
];
// Local previews of docs/ (python -m http.server, the preview pane).
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MAX_FILE = 4 * 1024 ** 3;   // 4 GB: a long 4K video, not a whole phone backup
const MAX_CHUNK = 64 * 1024 ** 2; // the page sends 8 MB; Workers accept up to 100 MB
const TYPES = /^(image|video)\//;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_UPLOAD_BASE = 'https://www.googleapis.com/upload';

function originOk(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': originOk(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Content-Range, X-Photo-Password, X-Upload-Session',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

class Fail extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/* Same as norm() in docs/photos/index.html and normalize() in
   tools/set_photo_album.py. Keep the three in step. */
function norm(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/^#+/, '');
}

// Constant-time compare: hash both sides so the lengths always match.
async function passwordOk(request, env) {
  if (!env.PHOTO_PASSWORD) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(norm(request.headers.get('X-Photo-Password')))),
    crypto.subtle.digest('SHA-256', enc.encode(norm(env.PHOTO_PASSWORD))),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function configured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN && env.DRIVE_FOLDER_ID);
}

// One access token per isolate, reused until a minute before it expires.
let cachedToken = null;

async function accessToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const r = await fetch(env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) {
    // invalid_grant here means the permission was revoked or expired: rerun
    // tools/photo_drive_setup.py --push.
    throw new Fail(502, 'drive-auth', (await r.text()).slice(0, 300));
  }
  const j = await r.json();
  cachedToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

function uploadBase(env) {
  return (env.GOOGLE_UPLOAD_BASE || GOOGLE_UPLOAD_BASE) + '/drive/v3/files';
}

/* The page hands the session address back on every piece. Only ever send
   bytes to a Drive upload session, never to an address someone made up. */
function sessionUrl(request, env) {
  const raw = request.headers.get('X-Upload-Session') || '';
  let u;
  try { u = new URL(raw); } catch (e) { throw new Fail(400, 'bad-session'); }
  const base = new URL(uploadBase(env));
  if (u.origin !== base.origin || u.pathname !== base.pathname || !u.searchParams.get('upload_id')) {
    throw new Fail(400, 'bad-session');
  }
  return u.toString();
}

function clean(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// "2026-12-27 18.42.10" in Philippine time, so files sort in the order of the day.
function stamp(now) {
  const ph = new Date(now.getTime() + 8 * 3600 * 1000).toISOString();
  return ph.slice(0, 10) + ' ' + ph.slice(11, 19).replace(/:/g, '.');
}

async function start(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { throw new Fail(400, 'bad-request'); }
  const type = clean(body.type, 100).toLowerCase() || 'application/octet-stream';
  const size = Number(body.size);
  if (!TYPES.test(type)) throw new Fail(415, 'not-photo-or-video');
  if (!Number.isInteger(size) || size <= 0) throw new Fail(400, 'bad-size');
  if (size > MAX_FILE) throw new Fail(413, 'too-big');

  const guest = clean(body.guest, 60);
  const original = clean(body.name, 120) || (type.startsWith('video/') ? 'video' : 'photo');
  const name = [stamp(new Date()), guest || 'Guest', original].join(' · ');

  const token = await accessToken(env);
  const r = await fetch(uploadBase(env) + '?uploadType=resumable&supportsAllDrives=true&fields=id,name', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': type,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({
      name,
      parents: [env.DRIVE_FOLDER_ID],
      description: (guest ? 'From ' + guest : 'From a guest') + ', shared on tomyjeyan.com/photos',
      appProperties: { guest: guest.slice(0, 60), source: 'tomyjeyan-photos' },
    }),
  });
  const session = r.headers.get('Location');
  if (!r.ok || !session) {
    if (r.status === 401) cachedToken = null;
    // 403 storageQuotaExceeded lands here when the Drive is full.
    throw new Fail(502, r.status === 403 ? 'drive-refused' : 'drive-start', (await r.text()).slice(0, 300));
  }
  return { session, name };
}

/* Drive's answer to a piece (or a status check): 308 = keep going, with how
   many bytes it has in Range; 200/201 = the file is complete. */
async function interpret(r) {
  if (r.status === 308) {
    const range = r.headers.get('Range');
    const m = range && range.match(/bytes=0-(\d+)/);
    return { next: m ? Number(m[1]) + 1 : 0 };
  }
  if (r.status === 200 || r.status === 201) {
    let file = {};
    try { file = await r.json(); } catch (e) {}
    return { done: true, file: { id: file.id, name: file.name } };
  }
  if (r.status === 404 || r.status === 410) throw new Fail(410, 'session-expired');
  throw new Fail(502, 'drive-chunk', String(r.status) + ' ' + (await r.text()).slice(0, 300));
}

/* A connection to Drive that drops mid-piece is retryable: the page asks
   /status how much Drive kept and carries on from there. */
async function toDrive(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new Fail(502, 'drive-unreachable', String(e && e.message));
  }
}

async function chunk(request, env) {
  const session = sessionUrl(request, env);
  const range = request.headers.get('Content-Range') || '';
  const m = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!m) throw new Fail(400, 'bad-range');
  const [from, to, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (to < from || to >= total || total > MAX_FILE || to - from + 1 > MAX_CHUNK) throw new Fail(400, 'bad-range');

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== to - from + 1) throw new Fail(400, 'short-chunk');

  const r = await toDrive(session, {
    method: 'PUT',
    headers: { 'Content-Range': range },
    body: bytes,
    redirect: 'manual', // Drive's 308 means "resume incomplete", not a redirect
  });
  return interpret(r);
}

async function status(request, env) {
  const session = sessionUrl(request, env);
  const total = Number(new URL(request.url).searchParams.get('size'));
  if (!Number.isInteger(total) || total <= 0 || total > MAX_FILE) throw new Fail(400, 'bad-size');
  const r = await toDrive(session, {
    method: 'PUT',
    headers: { 'Content-Range': 'bytes */' + total },
    redirect: 'manual',
  });
  return interpret(r);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const path = new URL(request.url).pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (!(await passwordOk(request, env))) throw new Fail(403, 'password');

      if (path === '/ping' && request.method === 'GET') {
        if (!configured(env)) return json({ ok: true, drive: false }, 200, origin);
        await accessToken(env); // proves the Google permission still works
        return json({ ok: true, drive: true }, 200, origin);
      }

      if (!configured(env)) throw new Fail(503, 'not-configured');

      if (path === '/start' && request.method === 'POST') return json(await start(request, env), 200, origin);
      if (path === '/chunk' && request.method === 'PUT') return json(await chunk(request, env), 200, origin);
      if (path === '/status' && request.method === 'GET') return json(await status(request, env), 200, origin);

      throw new Fail(404, 'not-found');
    } catch (err) {
      if (err instanceof Fail) {
        if (err.detail) console.log(err.code, err.detail);
        return json({ ok: false, error: err.code }, err.status, origin);
      }
      console.log('unexpected', err && err.stack);
      return json({ ok: false, error: 'unexpected' }, 502, origin);
    }
  },
};
