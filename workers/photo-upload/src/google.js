/* Everything that talks to Google Drive. makeGoogle(env, fetchImpl) returns
   an object the handlers call; tests hand it a fake fetchImpl or replace the
   whole object with fakeGoogle().

   Google access is a refresh token for the couple's account with the
   drive.file scope: the Worker can create files, and see only the files it
   created. It cannot read anything else in their Drive.

   Drive's resumable upload: startUpload asks Drive for an upload session and
   hands the session address back to the page. The page sends the file in 8 MB
   pieces; Drive answers 308 with how much it has, or 200 with the finished
   file. Sessions stay open for about a week. */

import { Fail } from './http.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_UPLOAD_BASE = 'https://www.googleapis.com/upload';
const GOOGLE_API_BASE = 'https://www.googleapis.com';

// One access token per isolate, reused until a minute before it expires.
let cachedToken = null;

export function resetTokenCache() {
  cachedToken = null;
}

export function configured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN && env.DRIVE_FOLDER_ID);
}

export function makeGoogle(env, fetchImpl = fetch) {
  const uploadBase = () => (env.GOOGLE_UPLOAD_BASE || GOOGLE_UPLOAD_BASE) + '/drive/v3/files';
  const apiBase = () => (env.GOOGLE_API_BASE || GOOGLE_API_BASE) + '/drive/v3/files';

  async function token() {
    if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
    const r = await fetchImpl(env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL, {
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

  /* A connection to Drive that drops mid-piece is retryable: the page asks
     /status how much Drive kept and carries on from there. */
  async function toDrive(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch (e) {
      throw new Fail(502, 'drive-unreachable', String(e && e.message));
    }
  }

  async function startUpload({ name, parents, description, appProperties, type, size }) {
    const t = await token();
    const r = await fetchImpl(uploadBase() + '?uploadType=resumable&supportsAllDrives=true&fields=id,name', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + t,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': type,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({ name, parents, description, appProperties }),
    });
    const session = r.headers.get('Location');
    if (!r.ok || !session) {
      if (r.status === 401) cachedToken = null;
      // 403 storageQuotaExceeded lands here when the Drive is full.
      throw new Fail(502, r.status === 403 ? 'drive-refused' : 'drive-start', (await r.text()).slice(0, 300));
    }
    return session;
  }

  /* The page hands the session address back on every piece. Only ever send
     bytes to a Drive upload session, never to an address someone made up. */
  function sessionUrl(raw) {
    let u;
    try { u = new URL(raw || ''); } catch (e) { throw new Fail(400, 'bad-session'); }
    const base = new URL(uploadBase());
    if (u.origin !== base.origin || u.pathname !== base.pathname || !u.searchParams.get('upload_id')) {
      throw new Fail(400, 'bad-session');
    }
    return u.toString();
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

  async function putPiece(session, range, bytes) {
    const r = await toDrive(session, {
      method: 'PUT',
      headers: { 'Content-Range': range },
      body: bytes,
      redirect: 'manual', // Drive's 308 means "resume incomplete", not a redirect
    });
    return interpret(r);
  }

  async function pieceStatus(session, total) {
    const r = await toDrive(session, {
      method: 'PUT',
      headers: { 'Content-Range': 'bytes */' + total },
      redirect: 'manual',
    });
    return interpret(r);
  }

  // A small file in one request: Drive's multipart upload (metadata + bytes).
  async function createSmall({ name, parents, type, bytes }) {
    const t = await token();
    const boundary = 'tjphoto' + crypto.randomUUID().replace(/-/g, '');
    const enc = new TextEncoder();
    const head = enc.encode(
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name, parents }) +
      '\r\n--' + boundary + '\r\nContent-Type: ' + type + '\r\n\r\n');
    const tail = enc.encode('\r\n--' + boundary + '--');
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const body = new Uint8Array(head.length + data.length + tail.length);
    body.set(head, 0);
    body.set(data, head.length);
    body.set(tail, head.length + data.length);
    const r = await toDrive(uploadBase() + '?uploadType=multipart&supportsAllDrives=true&fields=id', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + t,
        'Content-Type': 'multipart/related; boundary=' + boundary,
      },
      body,
    });
    if (!r.ok) {
      if (r.status === 401) cachedToken = null;
      throw new Fail(502, 'drive-create', String(r.status) + ' ' + (await r.text()).slice(0, 300));
    }
    const j = await r.json();
    return { id: j.id };
  }

  // Moves a file to Drive's bin (recoverable), never a hard delete.
  async function trash(id) {
    const t = await token();
    const r = await toDrive(apiBase() + '/' + encodeURIComponent(id) + '?supportsAllDrives=true', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    // Already gone is as good as trashed.
    if (!r.ok && r.status !== 404) {
      throw new Fail(502, 'drive-trash', String(r.status) + ' ' + (await r.text()).slice(0, 300));
    }
  }

  // The file's bytes, with the caller's Range passed through so video can seek.
  async function media(id, range) {
    const t = await token();
    const headers = { 'Authorization': 'Bearer ' + t };
    if (range) headers.Range = range;
    return toDrive(apiBase() + '/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers });
  }

  // Drive's own thumbnail; null while Drive hasn't made one yet.
  async function thumbnail(id) {
    const t = await token();
    const meta = await toDrive(apiBase() + '/' + encodeURIComponent(id) + '?fields=thumbnailLink&supportsAllDrives=true', {
      headers: { 'Authorization': 'Bearer ' + t },
    });
    if (!meta.ok) return null;
    const { thumbnailLink } = await meta.json();
    if (!thumbnailLink) return null;
    const img = await toDrive(thumbnailLink, { headers: { 'Authorization': 'Bearer ' + t } });
    if (!img.ok) return null;
    return new Uint8Array(await img.arrayBuffer());
  }

  return { token, startUpload, sessionUrl, putPiece, pieceStatus, createSmall, trash, media, thumbnail };
}
