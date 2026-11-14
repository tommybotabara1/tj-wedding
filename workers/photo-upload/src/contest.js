/* The contest's rules. Pure: no database, no fetch, no clock of its own. */

import { Fail } from './http.js';

// Midnight at the start of Dec 27 in the Philippines; the wrangler.toml var overrides it.
export const OPENS_AT = '2026-12-26T16:00:00Z';
export const opensAt = (env) => env.CONTEST_OPENS_AT || OPENS_AT;

// settings is the camelCase shape from getSettings().
export function contestOpen(settings, nowMs, opensAtIso) {
  if (settings.practice) return true;
  if (settings.contest === 'open') return true;
  if (settings.contest === 'closed') return false;
  return nowMs >= Date.parse(opensAtIso);
}

export function acceptingEntries(moment, open) {
  return open && moment.phase === 'entries';
}

// Whether an entry may appear on the screen wall.
export function onWall(entry, settings) {
  if (entry.removed_at) return false;
  if (!entry.copy_id || !entry.drive_id) return false;
  if (entry.operator === 'hidden') return false;
  if (entry.operator === 'shown') return true;
  if (entry.check_state === 'shown') return true;
  if (settings.skipCheck && entry.check_state !== 'held') return true;
  return false;
}

// Whether the operator may put an entry in front of guests (a shortlist, a
// direct award): checked as fine or shown by the operator, and not hidden.
export function eligible(entry) {
  if (entry.removed_at || entry.operator === 'hidden') return false;
  return entry.check_state === 'shown' || entry.operator === 'shown';
}

/* Up to n entry ids for a vote: fit >= fitMin, not removed, hidden or held
   (unless an operator showed it), best fit + quality first, then whoever sent
   first, and only the best entry from any one phone. */
export function rankShortlist(entries, n = 5, fitMin = 5) {
  const ok = entries.filter((e) =>
    !e.removed_at &&
    e.operator !== 'hidden' &&
    (e.check_state !== 'held' || e.operator === 'shown') &&
    (e.fit ?? 0) >= fitMin);
  const score = (e) => (e.fit || 0) + (e.quality || 0);
  const better = (a, b) =>
    score(b) - score(a) || (a.created_at - b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  ok.sort(better);
  const seen = new Set();
  const out = [];
  for (const e of ok) {
    if (seen.has(e.device)) continue;
    seen.add(e.device);
    out.push(e.id);
    if (out.length === n) break;
  }
  return out;
}

// counts: [{entry, n}] as from voteCounts(); gone: Set of removed or hidden ids.
export function tally(shortlist, counts, gone) {
  const live = shortlist.filter((id) => !gone.has(id));
  const result = {};
  for (const id of live) result[id] = 0;
  for (const { entry, n } of counts) {
    if (entry in result) result[entry] += n;
  }
  let total = 0;
  let max = 0;
  for (const id of live) {
    total += result[id];
    if (result[id] > max) max = result[id];
  }
  const leaders = max > 0 ? live.filter((id) => result[id] === max) : [];
  return { counts: result, total, leaders };
}

export function assertPhase(moment, allowed) {
  if (!allowed.includes(moment.phase)) throw new Fail(409, 'wrong-phase');
}
