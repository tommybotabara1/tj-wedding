import { describe, it, expect } from 'vitest';
import { contestOpen, acceptingEntries, onWall, rankShortlist, tally, assertPhase } from '../src/contest.js';
import { Fail } from '../src/http.js';

const OPENS = '2026-12-26T16:00:00Z';
const base = { contest: 'auto', skipCheck: false, practice: false };

describe('contestOpen boundaries', () => {
  it('auto opens exactly at the opening instant', () => {
    expect(contestOpen(base, Date.parse('2026-12-26T15:59:59Z'), OPENS)).toBe(false);
    expect(contestOpen(base, Date.parse('2026-12-26T16:00:00Z'), OPENS)).toBe(true);
  });
  it('open and closed override the clock', () => {
    expect(contestOpen({ ...base, contest: 'open' }, Date.parse('2026-11-09T00:00:00Z'), OPENS)).toBe(true);
    expect(contestOpen({ ...base, contest: 'closed' }, Date.parse('2026-12-27T05:00:00Z'), OPENS)).toBe(false);
  });
  it('practice counts as open', () => {
    expect(contestOpen({ ...base, contest: 'closed', practice: true }, Date.parse('2026-11-09T00:00:00Z'), OPENS)).toBe(true);
  });
});

describe('acceptingEntries', () => {
  it('needs the contest open and the moment in the entries phase', () => {
    expect(acceptingEntries({ phase: 'entries' }, true)).toBe(true);
    expect(acceptingEntries({ phase: 'voting' }, true)).toBe(false);
    expect(acceptingEntries({ phase: 'entries' }, false)).toBe(false);
  });
});

describe('onWall rules', () => {
  const e = (o = {}) => ({ drive_id: 'd', copy_id: 'c', check_state: 'pending', operator: null, removed_at: null, ...o });
  it('rejects removed, or missing drive/copy ids', () => {
    expect(onWall(e({ removed_at: 5, check_state: 'shown' }), base)).toBe(false);
    expect(onWall(e({ copy_id: null, check_state: 'shown' }), base)).toBe(false);
    expect(onWall(e({ drive_id: null, check_state: 'shown' }), base)).toBe(false);
  });
  it('operator hidden beats a shown check', () => {
    expect(onWall(e({ operator: 'hidden', check_state: 'shown' }), base)).toBe(false);
  });
  it('operator shown beats a held check', () => {
    expect(onWall(e({ operator: 'shown', check_state: 'held' }), base)).toBe(true);
  });
  it('shown state is on the wall', () => {
    expect(onWall(e({ check_state: 'shown' }), base)).toBe(true);
    expect(onWall(e({ check_state: 'pending' }), base)).toBe(false);
  });
  it('skipCheck lets pending and error through but never held', () => {
    const s = { ...base, skipCheck: true };
    expect(onWall(e({ check_state: 'pending' }), s)).toBe(true);
    expect(onWall(e({ check_state: 'error' }), s)).toBe(true);
    expect(onWall(e({ check_state: 'held' }), s)).toBe(false);
  });
});

describe('rankShortlist', () => {
  const mk = (id, device, fit, quality, created_at, o = {}) =>
    ({ id, device, fit, quality, created_at, check_state: 'shown', operator: null, removed_at: null, ...o });
  it('returns 5 ids ordered by fit + quality, then created_at', () => {
    const list = [
      mk('a', 'd1', 5, 5, 10), mk('b', 'd2', 9, 9, 20), mk('c', 'd3', 7, 7, 30), mk('d', 'd4', 7, 7, 25),
      mk('e', 'd5', 6, 5, 40), mk('f', 'd6', 5, 6, 50), mk('g', 'd7', 5, 5, 60), mk('h', 'd8', 10, 10, 70),
    ];
    expect(rankShortlist(list)).toEqual(['h', 'b', 'd', 'c', 'e']);
  });
  it('drops low fit, removed, hidden and held entries', () => {
    const list = [
      mk('low', 'd1', 4, 10, 1), mk('rm', 'd2', 9, 9, 2, { removed_at: 3 }),
      mk('hid', 'd3', 9, 9, 3, { operator: 'hidden' }), mk('held', 'd4', 9, 9, 4, { check_state: 'held' }),
      mk('ok', 'd5', 5, 5, 5),
    ];
    expect(rankShortlist(list)).toEqual(['ok']);
  });
  it('keeps an operator-shown entry with fit >= 5', () => {
    const list = [
      mk('s', 'd1', 6, 6, 1, { check_state: 'held', operator: 'shown' }),
      mk('s4', 'd2', 4, 9, 2, { check_state: 'held', operator: 'shown' }),
    ];
    expect(rankShortlist(list)).toEqual(['s']);
  });
  it('takes only the best entry per device', () => {
    const list = [mk('x1', 'dev', 6, 6, 1), mk('x2', 'dev', 9, 9, 2), mk('x3', 'dev', 7, 7, 3), mk('y', 'other', 5, 5, 4)];
    expect(rankShortlist(list)).toEqual(['x2', 'y']);
  });
});

describe('tally', () => {
  it('counts only shortlist ids not gone, and finds all leaders', () => {
    const t = tally(['a', 'b', 'c'], [{ entry: 'a', n: 3 }, { entry: 'b', n: 3 }, { entry: 'c', n: 9 }, { entry: 'z', n: 4 }], new Set(['c']));
    expect(t.counts).toEqual({ a: 3, b: 3 });
    expect(t.total).toBe(6);
    expect(t.leaders).toEqual(['a', 'b']);
  });
  it('has no leaders when nobody voted', () => {
    expect(tally(['a'], [], new Set())).toEqual({ counts: { a: 0 }, total: 0, leaders: [] });
  });
});

describe('assertPhase', () => {
  it('passes for an allowed phase', () => {
    expect(() => assertPhase({ phase: 'voting' }, ['voting', 'closed'])).not.toThrow();
  });
  it('throws Fail 409 wrong-phase otherwise', () => {
    let caught;
    try {
      assertPhase({ phase: 'entries' }, ['voting']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Fail);
    expect(caught.status).toBe(409);
    expect(caught.code).toBe('wrong-phase');
  });
});
