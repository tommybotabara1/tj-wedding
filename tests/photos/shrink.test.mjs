import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin } from '../../docs/photos/lib/shrink.js';

test('fitWithin scales the long edge down to 1600', () => {
  assert.deepEqual(fitWithin(4000, 3000), { w: 1600, h: 1200 });
});
test('fitWithin handles portrait', () => {
  assert.deepEqual(fitWithin(1080, 1920), { w: 900, h: 1600 });
});
test('fitWithin never upscales', () => {
  assert.deepEqual(fitWithin(800, 600), { w: 800, h: 600 });
});
test('fitWithin takes a custom max', () => {
  assert.deepEqual(fitWithin(400, 200, 96), { w: 96, h: 48 });
});
