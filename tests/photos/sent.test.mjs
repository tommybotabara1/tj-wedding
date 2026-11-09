import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENT_KEY, loadSent, saveSent, upsertSent, markRemoved } from '../../docs/photos/lib/sent.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
const item = (n, extra = {}) => ({
  local: 'l' + n, entry: 'e' + n, key: 'k' + n, moment: null, kind: 'photo',
  thumb: 'data:image/jpeg;base64,' + n, at: n, state: 'sent', ...extra,
});

test('SENT_KEY', () => assert.equal(SENT_KEY, 'tj-photos-sent'));

test('round trip through storage', () => {
  const s = fakeStorage();
  const items = [item(3), item(2), item(1)];
  saveSent(s, items);
  assert.deepEqual(loadSent(s), items);
});

test('save caps at 200, newest first', () => {
  const s = fakeStorage();
  const items = [];
  for (let i = 1; i <= 250; i++) items.push(item(i));
  saveSent(s, items);
  const back = loadSent(s);
  assert.equal(back.length, 200);
  assert.equal(back[0].at, 250);
  assert.equal(back[199].at, 51);
});

test('thumbs are dropped past the first 60', () => {
  const s = fakeStorage();
  const items = [];
  for (let i = 1; i <= 80; i++) items.push(item(i));
  saveSent(s, items);
  const back = loadSent(s);
  assert.ok(back[0].thumb);
  assert.ok(back[59].thumb);
  assert.equal(back[60].thumb, null);
  assert.equal(back[79].thumb, null);
});

test('markRemoved sets the state and leaves the others', () => {
  const out = markRemoved([item(1), item(2)], 'e2');
  assert.equal(out[1].state, 'removed');
  assert.equal(out[0].state, 'sent');
});

test('upsertSent adds new items first and replaces by local id', () => {
  let items = upsertSent([], item(1));
  items = upsertSent(items, item(2));
  assert.deepEqual(items.map((x) => x.local), ['l2', 'l1']);
  items = upsertSent(items, item(1, { state: 'failed' }));
  assert.equal(items.length, 2);
  assert.equal(items.find((x) => x.local === 'l1').state, 'failed');
});

test('corrupt or wrong-shaped JSON gives []', () => {
  assert.deepEqual(loadSent(fakeStorage({ [SENT_KEY]: '{nope' })), []);
  assert.deepEqual(loadSent(fakeStorage({ [SENT_KEY]: '{"a":1}' })), []);
  assert.deepEqual(loadSent(fakeStorage()), []);
});

test('a storage that throws gives [] and does not throw on save', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepEqual(loadSent(bad), []);
  assert.doesNotThrow(() => saveSent(bad, [item(1)]));
});
