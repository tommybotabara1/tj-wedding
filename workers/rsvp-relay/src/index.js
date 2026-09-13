/**
 * RSVP relay — rsvp.tomyjeyan.com
 *
 * The invitation posts here instead of straight to Google Apps Script, so the
 * script.google.com address never appears in the page source or in a guest's
 * Network tab. The real /exec URL lives only in this Worker's secret GAS_URL
 * (set with `npx wrangler secret put GAS_URL`), never in the repo.
 *
 * It passes the request body through untouched and hands back Apps Script's
 * JSON. Apps Script answers a POST with a 302 to script.googleusercontent.com;
 * fetch follows it the same way the browser used to.
 */

const ALLOWED_ORIGINS = [
  'https://tomyjeyan.com',
  'https://www.tomyjeyan.com',
];
// Local previews of docs/ (python -m http.server, the preview pane).
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MAX_BODY = 20000; // bytes — a full reply is well under 2 KB

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method === 'GET') {
      return json({ status: 'ok' }, 200, origin);
    }
    if (request.method !== 'POST') {
      return json({ status: 'error', message: 'Method not allowed.' }, 405, origin);
    }

    // Only the invitation may use this. A script can forge Origin, so this is a
    // speed bump for casual poking, not a lock — the Apps Script keeps its own
    // honeypot and lookup limits.
    if (!(ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin))) {
      return json({ status: 'error', message: 'Forbidden.' }, 403, origin);
    }

    const body = await request.text();
    if (body.length > MAX_BODY) {
      return json({ status: 'error', message: 'Request too large.' }, 413, origin);
    }

    try {
      const upstream = await fetch(env.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        redirect: 'follow',
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.ok ? 200 : 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    } catch (err) {
      return json({ status: 'error', message: 'RSVP service unreachable.' }, 502, origin);
    }
  },
};
