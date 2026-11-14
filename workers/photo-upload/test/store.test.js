import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { resetDb } from './helpers.js';
import {
  DEFAULT_SETTINGS, getSettings, putSetting, listMoments, getMoment, updateMoment,
  createEntry, getEntry, attachOriginal, setCopy, bumpTries, castVote, voteCounts, myVotes,
  markRemoved, recentEntries, pendingChecks, missingCopies, deletePractice, addLog, recentLog, momentEntries,
} from '../src/store.js';

const db = env.DB;
const entry = (o = {}) => ({
  id: 'e1', device: 'dev1', guest: 'Ann', moment: 'aisle', kind: 'photo', mime: 'image/jpeg', size: 10,
  session_key: 'sk1', token_hash: 'th', created_at: 1000, ...o,
});

beforeEach(async () => { await resetDb(); });

describe('momentEntries', () => {
  it('gives the best-scored sent entries first and honours the limit', async () => {
    const rows = [['lo', 1, 1, 'dl'], ['hi', 9, 9, 'dh'], ['mid', 5, 5, 'dm'], ['nodrive', 10, 10, null], ['gone', 10, 10, 'dg']];
    let t = 1;
    for (const [id, fit, quality, drive_id] of rows) {
      await createEntry(db, entry({ id, session_key: id, fit, quality, drive_id, created_at: t++, removed_at: id === 'gone' ? 5 : undefined }));
    }
    expect((await momentEntries(db, 'aisle')).map((e) => e.id)).toEqual(['hi', 'mid', 'lo']);
    expect((await momentEntries(db, 'aisle', 2)).map((e) => e.id)).toEqual(['hi', 'mid']);
  });
});

describe('missingCopies backoff', () => {
  it('waits 2, 6 then 15 minutes by copy_tries', async () => {
    const MIN = 60_000;
    await createEntry(db, entry({ id: 'a', session_key: 'a', created_at: 1_000_000 }));
    await attachOriginal(db, 'a', 'da');
    const ids = async (now) => (await missingCopies(db, now, 10)).map((e) => e.id);
    expect(await ids(1_000_000 + 2 * MIN - 1)).toEqual([]);
    expect(await ids(1_000_000 + 2 * MIN + 1)).toEqual(['a']);
    await bumpTries(db, 'a', 'copy_tries');
    expect(await ids(1_000_000 + 6 * MIN - 1)).toEqual([]);
    expect(await ids(1_000_000 + 6 * MIN + 1)).toEqual(['a']);
    await bumpTries(db, 'a', 'copy_tries');
    expect(await ids(1_000_000 + 15 * MIN - 1)).toEqual([]);
    expect(await ids(1_000_000 + 15 * MIN + 1)).toEqual(['a']);
    await bumpTries(db, 'a', 'copy_tries');
    expect(await ids(1_000_000 + 60 * MIN)).toEqual([]);
  });
});

describe('migrations', () => {
  it('seed exactly the six moments, in order', async () => {
    const m = await listMoments(db);
    expect(m.map((x) => x.id)).toEqual(['aisle', 'entrance', 'first-dance', 'happy-tears', 'showstopper', 'groufie']);
    expect(m[0].title).toBe('Here comes the bride');
    expect(m[0].shortlist).toEqual([]);
    expect(m[0].phase).toBe('entries');
  });
});

describe('settings', () => {
  it('returns defaults on an empty table', async () => {
    expect(DEFAULT_SETTINGS.contest).toBe('auto');
    expect(await getSettings(db)).toEqual({
      contest: 'auto', screen: { mode: 'wall' }, skipCheck: false, practice: false,
      snapshot: '', geminiOk: null, geminiErr: null,
    });
  });
  it('reads back what was put', async () => {
    await putSetting(db, 'practice', '1');
    await putSetting(db, 'gemini_ok', '123');
    await putSetting(db, 'screen', '{"mode":"moment","moment":"aisle"}');
    const s = await getSettings(db);
    expect(s.practice).toBe(true);
    expect(s.geminiOk).toBe(123);
    expect(s.screen).toEqual({ mode: 'moment', moment: 'aisle' });
  });
});

describe('moments', () => {
  it('updateMoment stores a shortlist and winner', async () => {
    await updateMoment(db, 'aisle', { phase: 'voting', shortlist: ['a', 'b'] });
    let m = await getMoment(db, 'aisle');
    expect(m.phase).toBe('voting');
    expect(m.shortlist).toEqual(['a', 'b']);
    await updateMoment(db, 'aisle', { winner: 'none' });
    m = await getMoment(db, 'aisle');
    expect(m.winner).toBe('none');
    expect(m.shortlist).toEqual(['a', 'b']);
  });
});

describe('entries', () => {
  it('attachOriginal finds the entry by session_key', async () => {
    await createEntry(db, entry());
    expect(await attachOriginal(db, 'nope', 'drv')).toBeNull();
    const got = await attachOriginal(db, 'sk1', 'drv');
    expect(got.id).toBe('e1');
    expect(got.drive_id).toBe('drv');
    expect((await getEntry(db, 'e1')).drive_id).toBe('drv');
  });
  it('recentEntries, pendingChecks and missingCopies filter as specified', async () => {
    await createEntry(db, entry({ id: 'a', session_key: 'a', created_at: 1 }));
    await createEntry(db, entry({ id: 'b', session_key: 'b', created_at: 2 }));
    await attachOriginal(db, 'a', 'da');
    await attachOriginal(db, 'b', 'db');
    expect((await missingCopies(db, 999999, 10)).map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect((await recentEntries(db, 10)).map((e) => e.id)).toEqual(['b', 'a']);
    expect(await pendingChecks(db, 99, 10)).toEqual([]);
    await setCopy(db, 'a', 'ca');
    expect((await pendingChecks(db, 99, 10)).map((e) => e.id)).toEqual(['a']);
    expect(await pendingChecks(db, 1, 10)).toEqual([]);
    for (let i = 0; i < 3; i++) await bumpTries(db, 'a', 'check_tries');
    expect(await pendingChecks(db, 99, 10)).toEqual([]);
    expect((await missingCopies(db, 999999, 10)).map((e) => e.id)).toEqual(['b']);
  });
});

describe('votes', () => {
  it('castVote twice for the same (moment, device) keeps one row with the second entry', async () => {
    await castVote(db, { moment: 'aisle', device: 'd', entry: 'e1', practice: 0, now: 1 });
    await castVote(db, { moment: 'aisle', device: 'd', entry: 'e2', practice: 0, now: 2 });
    expect(await voteCounts(db, 'aisle')).toEqual([{ entry: 'e2', n: 1 }]);
    expect(await myVotes(db, 'd')).toEqual({ aisle: 'e2' });
  });
  it('markRemoved deletes the entry votes', async () => {
    await createEntry(db, entry());
    await castVote(db, { moment: 'aisle', device: 'd', entry: 'e1', practice: 0, now: 1 });
    await castVote(db, { moment: 'aisle', device: 'd2', entry: 'other', practice: 0, now: 1 });
    await markRemoved(db, 'e1', 50);
    expect((await getEntry(db, 'e1')).removed_at).toBe(50);
    expect(await voteCounts(db, 'aisle')).toEqual([{ entry: 'other', n: 1 }]);
    expect(await recentEntries(db, 10)).toEqual([]);
  });
  it('deletePractice removes practice entries and votes only', async () => {
    await createEntry(db, entry({ id: 'p', session_key: 'p', practice: 1 }));
    await createEntry(db, entry({ id: 'r', session_key: 'r' }));
    await castVote(db, { moment: 'aisle', device: 'd', entry: 'p', practice: 1, now: 1 });
    await castVote(db, { moment: 'entrance', device: 'd', entry: 'r', practice: 0, now: 1 });
    await deletePractice(db);
    expect(await getEntry(db, 'p')).toBeNull();
    expect(await getEntry(db, 'r')).not.toBeNull();
    expect(await myVotes(db, 'd')).toEqual({ entrance: 'r' });
  });
});

describe('log', () => {
  it('returns newest first', async () => {
    await addLog(db, 'op', 'one', 1);
    await addLog(db, 'op', 'two', 2);
    expect((await recentLog(db, 5)).map((l) => l.what)).toEqual(['two', 'one']);
  });
});
