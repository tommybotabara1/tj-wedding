import { test } from 'node:test';
import assert from 'node:assert/strict';

// common.js reads the page's location once, at load.
globalThis.location = { hostname: 'tomyjeyan.com', search: '' };
const { proposal, eligible, flag, directAward, revealControl } = await import('../../docs/photos/control/common.js');
const { picksFor, renderRunSheet } = await import('../../docs/photos/control/runsheet.js');

const cand = (id, o = {}) => ({ id, state: 'shown', hidden: false, shown: false, fit: 8, quality: 7, moment: 'Here comes the bride', guest: 'G' + id, copy: 'x', ...o });
const moment = (o = {}) => ({
  id: 'aisle', title: 'Here comes the bride', phase: 'entries', entryCount: 3, shortlist: [], tally: { total: 0, leaders: [], counts: {} },
  candidates: [], proposed: [], winner: null, ...o,
});

test('the default picks are the Worker\'s proposed list, never recomputed from fit', () => {
  const m = moment({ candidates: [cand('a'), cand('b'), cand('held', { state: 'held', fit: 9 })], proposed: ['a', 'b'] });
  assert.deepEqual(proposal(m).map((c) => c.id), ['a', 'b']);
  const ui = { picks: {} };
  assert.deepEqual(picksFor(ui, m), ['a', 'b']);
});

test('one proposed entry is not a contest: no default picks', () => {
  const m = moment({ candidates: [cand('a'), cand('held', { state: 'held', fit: 9 })], proposed: ['a'] });
  assert.deepEqual(picksFor({ picks: {} }, m), []);
});

test('eligible and the Add list flags', () => {
  assert.equal(eligible(cand('a')), true);
  assert.equal(eligible(cand('h', { state: 'held' })), false);
  assert.equal(eligible(cand('h', { state: 'held', shown: true })), true);
  assert.equal(eligible(cand('x', { hidden: true })), false);
  assert.match(flag(cand('h', { state: 'held' })), />held</);
  assert.match(flag(cand('p', { state: 'pending' })), />not checked yet</);
  assert.match(flag(cand('x', { hidden: true })), />hidden</);
  assert.equal(flag(cand('a')), '');
});

test('award directly shows the entry and its state, is off for a held one, and No winner is always there', () => {
  const held = directAward(moment({ entryCount: 1, candidates: [cand('h', { state: 'held' })] }), 'k-');
  assert.match(held, /Held back by the check/);
  assert.match(held, /<img class="th"/);
  assert.match(held, /data-do="win" data-arg="aisle\|h"[^>]* disabled>Award directly/);
  assert.match(held, /No winner/);
  const fine = directAward(moment({ entryCount: 1, candidates: [cand('a')] }), 'k-');
  assert.doesNotMatch(fine, /disabled/);
  const hidden = directAward(moment({ entryCount: 1, candidates: [cand('x', { hidden: true })] }), 'k-');
  assert.match(hidden, /No winner/);
  assert.match(hidden, /disabled/);
});

test('reveal asks first, then offers Reveal and Cancel', () => {
  const m = moment({ phase: 'closed' });
  const first = revealControl({ confirm: null }, m, 'rv:aisle');
  assert.match(first, /data-do="confirm" data-arg="rv:aisle"[^>]*>Reveal winner/);
  assert.doesNotMatch(first, /reveal-go/);
  const asking = revealControl({ confirm: 'rv:aisle' }, m, 'rv:aisle');
  assert.match(asking, /Put the winner on the big screen\?/);
  assert.match(asking, /data-do="reveal-go" data-arg="aisle"[^>]*>Reveal</);
  assert.match(asking, />Cancel</);
});

test('the Run sheet header shows the contest switch and skip-check', () => {
  const s = {
    settings: { contest: 'closed', open: false, skipCheck: true, practice: false },
    screen: { mode: 'wall', moment: null }, moments: [moment()], waiting: [], wall: [], log: [], counts: {},
  };
  const ui = { picks: {}, open: {}, tie: {}, review: null, addFor: null, confirm: null };
  const odd = renderRunSheet(s, ui);
  assert.match(odd, /class="switches odd"[^>]*>.*Contest: <b>Closed<\/b>.*Show new photos without checking: <b>On<\/b>/);
  s.settings = { contest: 'auto', open: true, skipCheck: false, practice: false };
  const ok = renderRunSheet(s, ui);
  assert.match(ok, /class="switches"[^>]*>.*Contest: <b>Auto<\/b>.*without checking: <b>Off<\/b>/);
});
