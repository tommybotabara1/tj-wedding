/* The Gemini check of a small copy, and the once-a-minute job that catches up
   on checks and small copies that didn't happen the first time. */

import { Fail } from './http.js';
import {
  getEntry, getMoment, setCheck, bumpTries, putSetting, pendingChecks, missingCopies, setCopy, takeGeminiSlot,
} from './store.js';

/* A hard ceiling on paid Gemini checks per UTC day (the wedding night falls in
   one). Past it, photos wait in the control page's "Waiting for a check" list
   for a person to Show them, and checking resumes the next day. About
   US$0.002 a check, so 3000 caps a day at roughly US$6. */
const DAILY_CAP = 3000;
export function dailyCap(env) {
  const n = Number(env.GEMINI_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 ? n : DAILY_CAP;
}

// Checks one entry. jpeg is the copy's bytes when the caller already has them.
export async function runCheck(env, svc, entryId, jpeg) {
  const entry = await getEntry(svc.db, entryId);
  if (!entry || entry.removed_at || !entry.copy_id) return 'skipped';
  const day = new Date(svc.now()).toISOString().slice(0, 10);
  if (!(await takeGeminiSlot(svc.db, day, dailyCap(env)))) {
    // Over the day's cap: leave it pending (no try used) for a person, or tomorrow.
    console.log('check-capped');
    await putSetting(svc.db, 'gemini_err', String(svc.now()));
    return 'capped';
  }
  try {
    let bytes;
    if (jpeg) {
      bytes = new Uint8Array(jpeg);
    } else {
      const res = await svc.google.media(entry.copy_id);
      if (!res.ok) throw new Fail(502, 'gemini', 'copy fetch ' + res.status);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    const moment = entry.moment ? await getMoment(svc.db, entry.moment) : null;
    const v = await svc.gemini.check({ jpeg: bytes, moment });
    const state = v.wallOk ? 'shown' : 'held';
    await setCheck(svc.db, entry.id, { state, fit: v.fit, quality: v.quality, note: v.note });
    await putSetting(svc.db, 'gemini_ok', String(svc.now()));
    return state;
  } catch (e) {
    if (e instanceof Fail) {
      console.log('check-failed', e.code);
      await bumpTries(svc.db, entry.id, 'check_tries');
      await setCheck(svc.db, entry.id, { state: 'error', fit: entry.fit, quality: entry.quality, note: entry.note });
      await putSetting(svc.db, 'gemini_err', String(svc.now()));
      return 'error';
    }
    throw e;
  }
}

async function safely(fn) {
  try { return await fn(); } catch (e) { console.log('cron-step-failed'); return null; }
}

export async function runCron(env, svc) {
  const now = svc.now();
  let checked = 0;
  let thumbs = 0;

  for (const e of await pendingChecks(svc.db, now - 60_000, 5)) {
    await safely(() => runCheck(env, svc, e.id));
    checked++;
  }

  for (const e of await missingCopies(svc.db, now, 2)) {
    const done = await safely(async () => {
      const bytes = await svc.google.thumbnail(e.drive_id);
      if (!bytes) return false;
      const file = await svc.google.createSmall({
        name: e.id + '.jpg',
        parents: [env.COPIES_FOLDER_ID],
        type: 'image/jpeg',
        bytes,
      });
      await setCopy(svc.db, e.id, file.id);
      thumbs++;
      await runCheck(env, svc, e.id, bytes);
      return true;
    });
    if (!done) await safely(() => bumpTries(svc.db, e.id, 'copy_tries'));
  }
  return { checked, thumbs };
}
