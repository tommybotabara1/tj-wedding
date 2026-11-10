/* Asks Gemini whether a guest's small copy belongs on the wedding screen and
   how well it shows its moment. The API key travels only in the
   x-goog-api-key header: never in the URL, a log line or an error detail. */

import { Buffer } from 'node:buffer';
import { Fail, clean } from './http.js';

const BASE = 'https://generativelanguage.googleapis.com';

export function buildPrompt(moment) {
  const brief = moment
    ? `The moment brief is "${moment.title}": ${moment.brief || moment.hint}`
    : 'No moment brief was given.';
  return [
    "This is a guest's photo from Tommy and Jeyan's Catholic wedding and reception in the Philippines.",
    'Answer with JSON fields:',
    '- wedding: true if it was taken at the wedding or reception.',
    '- screen_ok: false for screenshots, documents, memes, accidental shots (pocket, floor, ceiling, nearly black, blurred beyond recognition), nudity, rude gestures, or anything a couple would be embarrassed to see on their wedding screen; otherwise true.',
    '- quality: 0 to 10 for sharpness, light, framing and emotion.',
    '- fit: 0 to 10 for how well it shows the moment brief; 0 when no moment is given.',
    '- note: at most 12 words, for the operator.',
    brief,
  ].join('\n');
}

const clamp = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

const BLOCKED = { wallOk: false, fit: 0, quality: 0, note: 'blocked by Gemini' };

const parseJson = (text) => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch (e) { return null; }
};

/* A photo Gemini won't judge (SAFETY, IMAGE_SAFETY, PROHIBITED_CONTENT, OTHER,
   a prompt block, an answer with nothing in it) is held, not retried: asking
   again only gets the same refusal. Only a normal finish with text that is
   not JSON is an error worth a retry. */
export function parseVerdict(api, hasMoment) {
  if (api && api.promptFeedback && api.promptFeedback.blockReason) return BLOCKED;
  const cand = api && api.candidates && api.candidates[0];
  if (!cand) return BLOCKED;
  const parts = (cand.content && cand.content.parts) || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  const reason = cand.finishReason;
  let v;
  if (reason && reason !== 'STOP') {
    // Cut off at the token limit is fine if what came before is a whole answer.
    v = reason === 'MAX_TOKENS' ? parseJson(text) : null;
    if (!v) return BLOCKED;
  } else {
    if (!text) return BLOCKED;
    v = parseJson(text);
    if (!v) throw new Fail(502, 'gemini', 'unparsable answer');
  }
  return {
    wallOk: v.wedding === true && v.screen_ok === true,
    fit: hasMoment ? clamp(v.fit) : null,
    quality: clamp(v.quality),
    note: clean(v.note, 120),
  };
}

export function makeGemini(env, fetchImpl = fetch) {
  async function check({ jpeg, moment }) {
    const url = (env.GEMINI_BASE || BASE) + '/v1beta/models/' + (env.GEMINI_MODEL || 'gemini-3.1-flash-lite') + ':generateContent';
    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: Buffer.from(jpeg).toString('base64') } },
          { text: buildPrompt(moment) },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            wedding: { type: 'BOOLEAN' },
            screen_ok: { type: 'BOOLEAN' },
            fit: { type: 'INTEGER' },
            quality: { type: 'INTEGER' },
            note: { type: 'STRING' },
          },
          required: ['wedding', 'screen_ok', 'fit', 'quality', 'note'],
        },
      },
    };
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Fail(502, 'gemini', 'network');
    }
    if (!res.ok) throw new Fail(502, 'gemini', 'HTTP ' + res.status);
    let api;
    try { api = await res.json(); } catch (e) { throw new Fail(502, 'gemini', 'unparsable answer'); }
    return parseVerdict(api, !!moment);
  }
  return { check };
}
