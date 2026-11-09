/* The guest upload endpoints: /start, /chunk, /status. Each takes the request,
   env and the injected svc (svc.google), and returns a plain object for json(). */

import { Fail, clean, stamp } from './http.js';
import { startEntry, onOriginalDone } from './entries.js';

const MAX_FILE = 4 * 1024 ** 3;   // 4 GB: a long 4K video, not a whole phone backup
const MAX_CHUNK = 64 * 1024 ** 2; // the page sends 8 MB; Workers accept up to 100 MB
const TYPES = /^(image|video)\//;

// When the last piece has landed, tell the contest which Drive file it is.
async function finished(svc, session, result) {
  if (result && result.done && result.file) await onOriginalDone(svc, session, result.file.id);
  return result;
}

export async function start(request, env, svc) {
  let body;
  try { body = await request.json(); } catch (e) { throw new Fail(400, 'bad-request'); }
  const type = clean(body.type, 100).toLowerCase() || 'application/octet-stream';
  const size = Number(body.size);
  if (!TYPES.test(type)) throw new Fail(415, 'not-photo-or-video');
  if (!Number.isInteger(size) || size <= 0) throw new Fail(400, 'bad-size');
  if (size > MAX_FILE) throw new Fail(413, 'too-big');

  const guest = clean(body.guest, 60);
  const original = clean(body.name, 120) || (type.startsWith('video/') ? 'video' : 'photo');
  const name = [stamp(new Date(svc.now())), guest || 'Guest', original].join(' · ');

  const session = await svc.google.startUpload({
    name,
    parents: [env.DRIVE_FOLDER_ID],
    description: (guest ? 'From ' + guest : 'From a guest') + ', shared on tomyjeyan.com/photos',
    appProperties: { guest: guest.slice(0, 60), source: 'tomyjeyan-photos' },
    type,
    size,
  });
  return { session, name, ...(await startEntry(env, svc, body, session)) };
}

export async function chunk(request, env, svc) {
  const session = svc.google.sessionUrl(request.headers.get('X-Upload-Session'));
  const range = request.headers.get('Content-Range') || '';
  const m = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!m) throw new Fail(400, 'bad-range');
  const [from, to, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (to < from || to >= total || total > MAX_FILE || to - from + 1 > MAX_CHUNK) throw new Fail(400, 'bad-range');

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== to - from + 1) throw new Fail(400, 'short-chunk');

  return finished(svc, session, await svc.google.putPiece(session, range, bytes));
}

export async function status(request, env, svc) {
  const session = svc.google.sessionUrl(request.headers.get('X-Upload-Session'));
  const total = Number(new URL(request.url).searchParams.get('size'));
  if (!Number.isInteger(total) || total <= 0 || total > MAX_FILE) throw new Fail(400, 'bad-size');
  return finished(svc, session, await svc.google.pieceStatus(session, total));
}
