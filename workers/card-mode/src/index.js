/**
 * Card mode — card.tomyjeyan.com
 *
 * Jeyan's NFC tag points at one URL, tomyjeyan.com/jeyan/, which holds two
 * cards: her PAL work card and her personal Real Estate by Jeyan card. This
 * Worker remembers which one that page opens on, for everyone who taps.
 *
 *   GET /jeyan   → {"mode":"pal"}            public, what the page reads
 *   PUT /jeyan   → body {"mode":"personal"}  owner only, what her switch sends
 *
 * The owner proves herself with `Authorization: Bearer <key>`, where the key is
 * the Worker secret OWNER_KEY (set with `npx wrangler secret put OWNER_KEY`,
 * copy kept in the repo's .env as CARD_OWNER_KEY). A GET that carries the
 * header also answers `"owner": true|false`, so her switch page knows the key
 * is good. Her switch lives on its own page, tomyjeyan.com/jeyan/switch/; the
 * key reaches her phone once through tomyjeyan.com/jeyan/switch/#key=<key>,
 * and the page keeps it and strips the hash. The card page never sees it.
 *
 * The choice lives in the KV namespace CARD_MODE. KV is eventually
 * consistent, so a change can take up to a minute to reach every edge.
 *
 * Without her phone, flip it from here:
 *   npx wrangler kv key put --binding CARD_MODE jeyan personal --remote
 * To lock out a lost phone, put a new OWNER_KEY secret, update .env, and send
 * her the new link; the old key stops working at once.
 */

const CARDS = {
  jeyan: { modes: ['pal', 'personal'], fallback: 'pal' },
};

const ALLOWED_ORIGINS = [
  'https://tomyjeyan.com',
  'https://www.tomyjeyan.com',
];
// Local previews of docs/ (python -m http.server, the preview pane).
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originOk(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': originOk(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

// Constant-time key check: hash both sides so the lengths always match.
async function isOwner(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/);
  if (!match || !env.OWNER_KEY) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(match[1].trim())),
    crypto.subtle.digest('SHA-256', enc.encode(env.OWNER_KEY)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function readMode(env, name, card) {
  const stored = await env.CARD_MODE.get(name);
  return card.modes.includes(stored) ? stored : card.fallback;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const name = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
    const card = CARDS[name];

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (!card) {
      return json({ error: 'Unknown card.' }, 404, origin);
    }

    if (request.method === 'GET') {
      const mode = await readMode(env, name, card);
      if (!request.headers.has('Authorization')) return json({ mode }, 200, origin);
      return json({ mode, owner: await isOwner(request, env) }, 200, origin);
    }

    if (request.method === 'PUT') {
      // Origin can be forged by a script; the key is the real lock.
      if (!originOk(origin)) return json({ error: 'Forbidden.' }, 403, origin);
      if (!(await isOwner(request, env))) return json({ error: 'Not the owner.' }, 401, origin);

      let body;
      try {
        body = JSON.parse(await request.text());
      } catch (err) {
        return json({ error: 'Send JSON like {"mode":"pal"}.' }, 400, origin);
      }
      if (!body || !card.modes.includes(body.mode)) {
        return json({ error: 'mode must be one of: ' + card.modes.join(', ') }, 400, origin);
      }
      await env.CARD_MODE.put(name, body.mode);
      return json({ mode: body.mode, owner: true }, 200, origin);
    }

    return json({ error: 'Method not allowed.' }, 405, origin);
  },
};
