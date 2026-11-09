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
 * Secrets, all set by tools/photo_drive_setup.py (or by hand with
 * `npx wrangler secret put NAME`):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   DRIVE_FOLDER_ID   the folder uploads go into (kept out of the public repo)
 *   PHOTO_PASSWORD    what guests type, e.g. ToMyJeyan
 *
 * The code is split by job: http.js (CORS, errors, helpers), google.js (all
 * Drive calls), upload.js (the three upload endpoints). This file is the
 * router. Handlers reach the outside world only through `svc`, so tests can
 * swap Google in memory.
 */

import { Fail, corsHeaders, json, secretMatches } from './http.js';
import { makeGoogle, configured } from './google.js';
import * as upload from './upload.js';

export function makeSvc(env) {
  return {
    db: env.DB,
    google: makeGoogle(env),
    gemini: null, // Task 4
    now: () => Date.now(),
  };
}

export async function handle(request, env, ctx, svc) {
  const origin = request.headers.get('Origin') || '';
  const path = new URL(request.url).pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (!(await secretMatches(request.headers.get('X-Photo-Password'), env.PHOTO_PASSWORD))) {
      throw new Fail(403, 'password');
    }

    if (path === '/ping' && request.method === 'GET') {
      if (!configured(env)) return json({ ok: true, drive: false }, 200, origin);
      await svc.google.token(); // proves the Google permission still works
      return json({ ok: true, drive: true }, 200, origin);
    }

    if (!configured(env)) throw new Fail(503, 'not-configured');

    if (path === '/start' && request.method === 'POST') return json(await upload.start(request, env, svc), 200, origin);
    if (path === '/chunk' && request.method === 'PUT') return json(await upload.chunk(request, env, svc), 200, origin);
    if (path === '/status' && request.method === 'GET') return json(await upload.status(request, env, svc), 200, origin);

    throw new Fail(404, 'not-found');
  } catch (err) {
    if (err instanceof Fail) {
      if (err.detail) console.log(err.code, err.detail);
      return json({ ok: false, error: err.code }, err.status, origin);
    }
    console.log('unexpected', err && err.stack);
    return json({ ok: false, error: 'unexpected' }, 502, origin);
  }
}

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx, makeSvc(env));
  },
};
