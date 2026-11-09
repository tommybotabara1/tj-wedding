/* What phones and the big screen read: contest status, voting, the screen
   feed, and toItem(), the one place an entry becomes the Item shape that
   /contest, /screen and /admin all share. */

import { Fail, clean } from './http.js';
import { mediaUrl } from './media.js';
import { contestOpen, onWall, tally } from './contest.js';
import { listMoments, getMoment, entriesByIds, recentEntries, voteCounts, myVotes, castVote, getSettings } from './store.js';

const WALL_SIZE = 40;
const WALL_SCAN = 400; // newest rows to look through; some will be held or hidden

// Item: {id, n?, kind, guest, moment: title|null, copy, orig}.
// moment may be a moment row, a title string, or null (a plain share).
export async function toItem(entry, moment, origin, env, nowMs, n) {
  const title = moment == null ? null : typeof moment === 'string' ? moment : moment.title;
  const item = { id: entry.id };
  if (n != null) item.n = n;
  item.kind = entry.kind;
  item.guest = entry.guest;
  item.moment = title || null;
  item.copy = await mediaUrl(origin, env.MEDIA_KEY, entry.id, 'copy', nowMs);
  item.orig = await mediaUrl(origin, env.MEDIA_KEY, entry.id, 'orig', nowMs);
  return item;
}

const isLive = (e) => !!e && !e.removed_at && e.operator !== 'hidden';

// The moment's shortlist as live entries with their stored position (1-5),
// plus the ids that dropped out (removed or hidden). Positions never shift, so
// numbers guests already saw on the screen stay true.
async function liveShortlist(svc, moment) {
  const byId = new Map((await entriesByIds(svc.db, moment.shortlist)).map((r) => [r.id, r]));
  const live = [];
  const gone = new Set();
  moment.shortlist.forEach((id, i) => {
    const e = byId.get(id);
    if (isLive(e)) live.push({ entry: e, n: i + 1 });
    else gone.add(id);
  });
  return { live, gone };
}

// A removed or hidden winner reads as no winner, the same as 'none'.
async function winnerItem(env, moment, live, origin, now) {
  if (moment.phase !== 'revealed' || !moment.winner || moment.winner === 'none') return null;
  const hit = live.find((x) => x.entry.id === moment.winner);
  return hit ? toItem(hit.entry, moment, origin, env, now, hit.n) : null;
}

export async function contest(request, env, svc) {
  const url = new URL(request.url);
  const origin = url.origin;
  const device = clean(url.searchParams.get('device'), 64);
  const now = svc.now();
  const settings = await getSettings(svc.db);
  const open = contestOpen(settings, now, env.CONTEST_OPENS_AT);
  const mine = device ? await myVotes(svc.db, device) : {};

  const moments = [];
  for (const m of await listMoments(svc.db)) {
    const { live } = await liveShortlist(svc, m);
    const out = { id: m.id, title: m.title, hint: m.hint, phase: m.phase, accepting: open && m.phase === 'entries' };
    if (m.phase !== 'entries') out.shortlist = await Promise.all(live.map((x) => toItem(x.entry, m, origin, env, now, x.n)));
    out.myVote = live.some((x) => x.entry.id === mine[m.id]) ? mine[m.id] : null;
    out.winner = await winnerItem(env, m, live, origin, now);
    moments.push(out);
  }
  return { open, practice: settings.practice, opensAt: env.CONTEST_OPENS_AT, moments };
}

export async function vote(request, env, svc) {
  let body;
  try { body = await request.json(); } catch { throw new Fail(400, 'bad-request'); }
  const device = clean(body && body.device, 64);
  const entry = clean(body && body.entry, 64);
  if (!device || !entry) throw new Fail(400, 'bad-request');

  const moment = await getMoment(svc.db, clean(body.moment, 40));
  if (!moment) throw new Fail(400, 'bad-request');
  if (moment.phase !== 'voting') throw new Fail(409, 'voting-closed');

  const { live } = await liveShortlist(svc, moment);
  if (!live.some((x) => x.entry.id === entry)) throw new Fail(400, 'not-on-shortlist');

  const settings = await getSettings(svc.db);
  await castVote(svc.db, { moment: moment.id, device, entry, practice: settings.practice, now: svc.now() });
  return { ok: true, myVote: entry };
}

export async function screen(request, env, svc) {
  const origin = new URL(request.url).origin;
  const now = svc.now();
  const settings = await getSettings(svc.db);
  const mode = settings.screen.mode;

  let moment = null;
  const m = mode !== 'wall' && settings.screen.moment ? await getMoment(svc.db, settings.screen.moment) : null;
  if (m) {
    const { live, gone } = await liveShortlist(svc, m);
    const { total } = tally(m.shortlist, await voteCounts(svc.db, m.id), gone);
    moment = {
      id: m.id,
      title: m.title,
      shortlist: await Promise.all(live.map((x) => toItem(x.entry, m, origin, env, now, x.n))),
      votes: total,
      winner: await winnerItem(env, m, live, origin, now),
    };
  }

  const byId = new Map((await listMoments(svc.db)).map((x) => [x.id, x]));
  const rows = (await recentEntries(svc.db, WALL_SCAN)).filter((e) => onWall(e, settings)).slice(0, WALL_SIZE);
  const wall = await Promise.all(rows.map((e) => toItem(e, e.moment ? byId.get(e.moment) : null, origin, env, now)));

  return { mode, moment, wall, at: now };
}
