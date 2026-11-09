import { describe, it, expect } from 'vitest';
import { makeGemini, buildPrompt, parseVerdict } from '../src/gemini.js';

const ENV = { GEMINI_API_KEY: 'secret-key-123', GEMINI_MODEL: 'gemini-test-model' };
const MOMENT = { id: 'aisle', title: 'Here comes the bride', hint: "Jeyan's walk", brief: 'The bride walking down the aisle' };
const JPEG = new Uint8Array([1, 2, 3, 4]);

function answer(obj) {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }] };
}

function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

describe('gemini', () => {
  it('sends the key in x-goog-api-key and the model in the path', async () => {
    const f = fakeFetch(200, answer({ wedding: true, screen_ok: true, fit: 7, quality: 8, note: 'nice' }));
    await makeGemini(ENV, f).check({ jpeg: JPEG, moment: MOMENT });
    const { url, init } = f.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent');
    expect(url).not.toContain('secret-key-123');
    expect(init.headers['x-goog-api-key']).toBe('secret-key-123');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts.some((p) => p.inline_data && p.inline_data.mime_type === 'image/jpeg' && p.inline_data.data === 'AQIDBA==')).toBe(true);
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.required).toHaveLength(5);
  });

  it('parses a good verdict', async () => {
    const f = fakeFetch(200, answer({ wedding: true, screen_ok: true, fit: 7, quality: 8, note: 'lovely light' }));
    expect(await makeGemini(ENV, f).check({ jpeg: JPEG, moment: MOMENT })).toEqual({
      wallOk: true, fit: 7, quality: 8, note: 'lovely light',
    });
    expect(buildPrompt(MOMENT)).toContain('The bride walking down the aisle');
  });

  it('blocked prompt becomes wallOk false without throwing', async () => {
    const f = fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } });
    expect(await makeGemini(ENV, f).check({ jpeg: JPEG, moment: MOMENT })).toEqual({
      wallOk: false, fit: 0, quality: 0, note: 'blocked by Gemini',
    });
    expect(parseVerdict({ candidates: [{ finishReason: 'SAFETY' }] }, true).wallOk).toBe(false);
  });

  it('HTTP 429 throws Fail gemini', async () => {
    const f = fakeFetch(429, { error: { message: 'quota' } });
    await expect(makeGemini(ENV, f).check({ jpeg: JPEG, moment: MOMENT })).rejects.toMatchObject({ status: 502, code: 'gemini' });
  });

  it('unparsable text throws Fail gemini', async () => {
    const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'not json' }] } }] });
    await expect(makeGemini(ENV, f).check({ jpeg: JPEG, moment: null })).rejects.toMatchObject({ code: 'gemini' });
  });

  it('no moment gives fit null', async () => {
    const f = fakeFetch(200, answer({ wedding: true, screen_ok: false, fit: 9, quality: 14, note: 'x' }));
    const v = await makeGemini(ENV, f).check({ jpeg: JPEG, moment: null });
    expect(v.fit).toBeNull();
    expect(v.wallOk).toBe(false);
    expect(v.quality).toBe(10);
  });
});
