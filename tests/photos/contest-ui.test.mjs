import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentLabel, pollDelay, deviceId } from '../../docs/photos/lib/contest-ui.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const mo = (phase) => ({ id: 'x', phase });

test('momentLabel when the contest is not open', () => {
  assert.equal(momentLabel(mo('entries'), false), 'Opens December 27');
});
test('momentLabel when open', () => {
  assert.equal(momentLabel(mo('entries'), true), 'Open');
});
test('momentLabel in voting, open or not', () => {
  assert.equal(momentLabel(mo('voting'), true), 'Voting now');
  assert.equal(momentLabel(mo('voting'), false), 'Voting now');
});
test('closed and revealed both read Closed', () => {
  for (const open of [true, false]) {
    assert.equal(momentLabel(mo('closed'), open), 'Closed');
    assert.equal(momentLabel(mo('revealed'), open), 'Closed');
  }
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
