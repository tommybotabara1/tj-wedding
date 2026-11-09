/* Test doubles. Nothing in the suite touches the real Google or Gemini: handler
   tests inject fakeGoogle()/fakeGemini() through svcFor(), and google.test.js
   hands makeGoogle() a fake fetchImpl. */

import { env } from 'cloudflare:workers';
import { Fail } from '../src/http.js';

const FAKE_UPLOAD = 'https://fake-google.test/upload/drive/v3/files';

/* An in-memory Google with the same surface as makeGoogle().
   files: id -> {name, parents, bytes (Uint8Array), trashed}
   calls: every call, in order, as {fn, ...args}
   finishOn(session): completes that upload now (as if the last piece landed)
   and returns the new file's id. */
export function fakeGoogle() {
  const files = new Map();
  const calls = [];
  const sessions = new Map(); // session url -> {meta, received, fileId}
  let seq = 0;

  function addFile(meta, bytes) {
    const id = 'file-' + (++seq);
    files.set(id, {
      name: meta.name,
      parents: meta.parents,
      bytes: bytes || new Uint8Array(0),
      trashed: false,
    });
    return id;
  }

  function finish(session) {
    const s = sessions.get(session);
    if (!s.fileId) s.fileId = addFile(s.meta, new Uint8Array(s.received));
    return s.fileId;
  }

  function reply(session) {
    const s = sessions.get(session);
    if (s.fileId) return { done: true, file: { id: s.fileId, name: files.get(s.fileId).name } };
    return { next: s.received };
  }

  return {
    files,
    calls,
    finishOn: finish,

    async token() { return 'fake-token'; },

    async startUpload(meta) {
      calls.push({ fn: 'startUpload', ...meta });
      const session = FAKE_UPLOAD + '?uploadType=resumable&upload_id=' + (++seq);
      sessions.set(session, { meta, received: 0, fileId: null });
      return session;
    },

    sessionUrl(raw) {
      if (!sessions.has(raw)) throw new Fail(400, 'bad-session');
      return raw;
    },

    async putPiece(session, range, bytes) {
      calls.push({ fn: 'putPiece', session, range, size: bytes.byteLength });
      const s = sessions.get(session);
      const m = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      s.received = Number(m[2]) + 1;
      if (s.received === Number(m[3])) finish(session);
      return reply(session);
    },

    async pieceStatus(session, total) {
      calls.push({ fn: 'pieceStatus', session, total });
      return reply(session);
    },

    async createSmall({ name, parents, type, bytes }) {
      calls.push({ fn: 'createSmall', name, parents, type, size: bytes.byteLength });
      return { id: addFile({ name, parents }, new Uint8Array(bytes)) };
    },

    async trash(id) {
      calls.push({ fn: 'trash', id });
      const f = files.get(id);
      if (f) f.trashed = true;
    },

    // 206 + Content-Range for a "bytes=a-b" range, 200 otherwise.
    async media(id, range) {
      calls.push({ fn: 'media', id, range });
      const f = files.get(id);
      if (!f) return new Response('not found', { status: 404 });
      const m = range && range.match(/^bytes=(\d+)-(\d*)$/);
      if (!m) return new Response(f.bytes, { status: 200 });
      const a = Number(m[1]);
      const b = m[2] === '' ? f.bytes.length - 1 : Math.min(Number(m[2]), f.bytes.length - 1);
      return new Response(f.bytes.slice(a, b + 1), {
        status: 206,
        headers: { 'Content-Range': 'bytes ' + a + '-' + b + '/' + f.bytes.length },
      });
    },

    // Set files.get(id).thumbnail to a Uint8Array to make one "available".
    async thumbnail(id) {
      calls.push({ fn: 'thumbnail', id });
      const f = files.get(id);
      return (f && f.thumbnail) || null;
    },
  };
}

/* A stand-in Gemini: verdictFn receives whatever the caller asks to judge and
   returns the verdict. Every request is kept in calls. */
export function fakeGemini(verdictFn) {
  const calls = [];
  return {
    calls,
    async judge(input) {
      calls.push(input);
      return verdictFn(input);
    },
  };
}

// now may be a function or a millisecond number.
export function svcFor({ google = fakeGoogle(), gemini = fakeGemini(() => ({})), now } = {}) {
  const clock = typeof now === 'function' ? now : now === undefined ? () => Date.now() : () => now;
  return { db: env.DB, google, gemini, now: clock };
}

/* A request as the guest page sends it. Pass password: null to send none. */
export function req(method, path, { json, body, headers = {}, password = 'ToMyJeyan', admin } = {}) {
  const h = new Headers({ Origin: 'https://tomyjeyan.com', ...headers });
  if (password !== null && password !== undefined) h.set('X-Photo-Password', password);
  if (admin !== undefined) h.set('X-Admin-Password', admin);
  let payload = body;
  if (json !== undefined) {
    payload = JSON.stringify(json);
    h.set('Content-Type', 'application/json');
  }
  return new Request('https://upload.test' + path, { method, headers: h, body: payload });
}

// Back to a freshly migrated database: no entries, votes, log or settings,
// and every moment in the entries phase.
export async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM votes'),
    env.DB.prepare('DELETE FROM entries'),
    env.DB.prepare('DELETE FROM log'),
    env.DB.prepare('DELETE FROM settings'),
    env.DB.prepare("UPDATE moments SET phase = 'entries', shortlist = '[]', winner = NULL"),
  ]);
}
