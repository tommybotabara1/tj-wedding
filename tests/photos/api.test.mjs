import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiBase, norm, mediaUrl, DEFAULT_API } from '../../docs/photos/lib/api.js';

test('apiBase defaults to the live Worker', () => {
  assert.equal(apiBase({ hostname: 'tomyjeyan.com', search: '' }), DEFAULT_API);
});
test('apiBase ignores ?api= off localhost', () => {
  assert.equal(apiBase({ hostname: 'tomyjeyan.com', search: '?api=http://evil.example' }), DEFAULT_API);
});
test('apiBase honours ?api= on localhost', () => {
  assert.equal(apiBase({ hostname: 'localhost', search: '?api=http://127.0.0.1:8787' }), 'http://127.0.0.1:8787');
});
test('norm mirrors the Worker: case, spaces and a leading #', () => {
  assert.equal(norm(' #To My Jeyan '), 'tomyjeyan');
});
test('mediaUrl re-points /m/ links at the base and leaves others alone', () => {
  assert.equal(mediaUrl('http://127.0.0.1:8787', 'http://upload.tomyjeyan.com/m/abc/copy?e=1&s=2'), 'http://127.0.0.1:8787/m/abc/copy?e=1&s=2');
  assert.equal(mediaUrl('https://upload.tomyjeyan.com', 'https://upload.tomyjeyan.com/m/abc/orig?e=1&s=2'), 'https://upload.tomyjeyan.com/m/abc/orig?e=1&s=2');
  assert.equal(mediaUrl('http://x', 'https://other.example/pic.jpg'), 'https://other.example/pic.jpg');
});
