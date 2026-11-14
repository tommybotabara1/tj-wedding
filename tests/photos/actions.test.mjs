import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsKey } from '../../docs/photos/lib/actions.js';

const base = { local: 'l1', entry: 'e1', key: 'k1', moment: 'groufie', kind: 'photo', thumb: null, at: 1, state: 'sending' };

test('progress-only changes keep the same key', () => {
  const a = actionsKey(base, false);
  assert.equal(actionsKey({ ...base, thumb: 'data:x', size: 5, at: 99 }, false), a);
  assert.equal(actionsKey({ ...base, moment: 'aisle' }, false), a);
});
test('state, entry, key or retryable changes give a different key', () => {
  const a = actionsKey(base, false);
  assert.notEqual(actionsKey({ ...base, state: 'sent' }, false), a);
  assert.notEqual(actionsKey({ ...base, entry: 'e2' }, false), a);
  assert.notEqual(actionsKey({ ...base, key: 'k2' }, false), a);
  assert.notEqual(actionsKey(base, true), a);
  assert.notEqual(actionsKey({ ...base, entry: null, key: null }, false), a);
});
