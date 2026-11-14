import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tileChip, detailPlace, pollDelay, deviceId } from '../../docs/photos/lib/contest-ui.js';
import { MOMENT_ICONS, momentIcon } from '../../docs/photos/lib/moment-icons.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const mo = (phase) => ({ id: 'x', phase });

test('tileChip: nothing while taking entries, Vote now, Closed', () => {
  assert.equal(tileChip(mo('entries')), '');
  assert.equal(tileChip(mo('voting')), 'Vote now');
  assert.equal(tileChip(mo('closed')), 'Closed');
  assert.equal(tileChip(mo('revealed')), 'Closed');
});

test('detailPlace: after the last tile of the row, arrow under the tile', () => {
  assert.deepEqual(detailPlace(0, 6), { order: 5, caret: 16.67 });
  assert.deepEqual(detailPlace(1, 6), { order: 5, caret: 50 });
  assert.deepEqual(detailPlace(2, 6), { order: 5, caret: 83.33 });
  assert.deepEqual(detailPlace(3, 6), { order: 11, caret: 16.67 });
  assert.deepEqual(detailPlace(5, 6), { order: 11, caret: 83.33 });
});
test('detailPlace: a short last row ends at the last tile', () => {
  assert.equal(detailPlace(3, 5).order, 9);
  assert.equal(detailPlace(4, 5).order, 9);
  assert.equal(detailPlace(0, 2, 3).order, 3);
});

test('every moment in the Worker has its own icon; others get the sparkles', () => {
  const sql = readFileSync(new URL('../../workers/photo-upload/migrations/0001_contest.sql', import.meta.url), 'utf8');
  const ids = [...sql.matchAll(/\('([a-z-]+)',\s*\d+\s*,/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), Object.keys(MOMENT_ICONS).sort());
  for (const id of ids) assert.match(momentIcon(id), /^<svg [^>]*aria-hidden="true"/);
  assert.equal(momentIcon('nope'), MOMENT_ICONS.entrance);
  assert.equal(momentIcon('__proto__'), MOMENT_ICONS.entrance);
});

test('pollDelay: 60 s, 20 s while voting, null when hidden', () => {
  assert.equal(pollDelay([mo('entries'), mo('closed')], true), 60000);
  assert.equal(pollDelay([mo('entries'), mo('voting')], true), 20000);
  assert.equal(pollDelay([], true), 60000);
  assert.equal(pollDelay([mo('voting')], false), null);
});

test('deviceId is 16 hex chars and stable', () => {
  const s = fakeStorage();
  const a = deviceId(s);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(deviceId(s), a);
  assert.equal(s.getItem('tj-photos-device'), a);
});
test('deviceId reuses a stored good value, replaces a bad one', () => {
  const s = fakeStorage();
  s.setItem('tj-photos-device', '0123456789abcdef');
  assert.equal(deviceId(s), '0123456789abcdef');
  s.setItem('tj-photos-device', 'junk');
  assert.match(deviceId(s), /^[0-9a-f]{16}$/);
});
test('deviceId works with an injected rand', () => {
  const rand = (a) => { a.fill(255); return a; };
  assert.equal(deviceId(fakeStorage(), rand), 'ffffffffffffffff');
});
