/* Contest entries as they arrive: one row per upload, the small copy that goes
   with it, and removal. Everything here is tolerant of the database being
   down: the guest's upload must never fail because the contest side did. */

import { Fail, clean, randomId, sha256hex } from './http.js';
import { createEntry, attachOriginal, getEntry, setCopy, markRemoved, getSettings, getMoment } from './store.js';
import { contestOpen, acceptingEntries } from './contest.js';
import { runCheck } from './checks.js';

const MAX_COPY = 1.5 * 1024 ** 2;

const empty = () => ({ entry: null, key: null, moment: null });

function keyHex() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A row for this upload, or {entry:null,...} when the database is unavailable.
export async function startEntry(env, svc, body, sessionUrl) {
  try {
    const type = clean(body.type, 100).toLowerCase();
    const id = randomId();
    const key = keyHex();
    const now = svc.now();
    const settings = await getSettings(svc.db);

    let moment = null;
    const asked = clean(body.moment, 40);
    if (asked) {
      const m = await getMoment(svc.db, asked);
      if (m && acceptingEntries(m, contestOpen(settings, now, env.CONTEST_OPENS_AT))) moment = m.id;
    }
    const device = String(body.device || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'anon-' + id;

    await createEntry(svc.db, {
      id,
      device,
      guest: clean(body.guest, 60),
      moment,
      kind: type.startsWith('video/') ? 'video' : 'photo',
      mime: type,
      size: Number(body.size),
      session_key: await sha256hex(sessionUrl),
      token_hash: await sha256hex(key),
      practice: settings.practice ? 1 : 0,
      created_at: now,
    });
    return { entry: id, key, moment };
  } catch (e) {
    console.log('contest-store');
    return empty();
  }
}

// Bin the files of an entry and mark it removed (which also drops its votes).
export async function trashEntry(svc, entry, now) {
  if (entry.drive_id) await svc.google.trash(entry.drive_id);
  if (entry.copy_id) await svc.google.trash(entry.copy_id);
  await markRemoved(svc.db, entry.id, now);
}

// The last piece of an original has landed. Never throws.
export async function onOriginalDone(svc, sessionUrl, fileId) {
  try {
    const entry = await attachOriginal(svc.db, await sha256hex(sessionUrl), fileId);
    if (entry && entry.removed_at) await svc.google.trash(fileId);
  } catch (e) {
    console.log('contest-store');
  }
}

async function ownEntry(svc, id, key) {
  const entry = id ? await getEntry(svc.db, id) : null;
  if (!entry) throw new Fail(404, 'no-entry');
  if (!key || (await sha256hex(key)) !== entry.token_hash) throw new Fail(403, 'entry-key');
  return entry;
}

export async function saveCopy(request, env, ctx, svc) {
  const entry = await ownEntry(svc, request.headers.get('X-Entry'), request.headers.get('X-Entry-Key'));
  if (Number(request.headers.get('Content-Length')) > MAX_COPY) throw new Fail(413, 'too-big');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_COPY) throw new Fail(413, 'too-big');
  if (entry.removed_at) return { ok: true }; // removed while the copy was on its way

  const file = await svc.google.createSmall({
    name: entry.id + '.jpg',
    parents: [env.COPIES_FOLDER_ID],
    type: 'image/jpeg',
    bytes,
  });
  await setCopy(svc.db, entry.id, file.id);
  ctx.waitUntil(runCheck(env, svc, entry.id, bytes));
  return { ok: true };
}

export async function removeEntry(request, env, svc) {
  let body;
  try { body = await request.json(); } catch (e) { throw new Fail(400, 'bad-request'); }
  const entry = await ownEntry(svc, clean(body.entry, 40), String(body.key || ''));
  if (!entry.removed_at) await trashEntry(svc, entry, svc.now());
  return { ok: true };
}
