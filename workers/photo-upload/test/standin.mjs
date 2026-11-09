/* A stand-in for Google Drive and Gemini, for running the Worker locally
   (`npm run standin`, then `npm run dev` with .dev.vars pointing here).
   Everything is in memory on 127.0.0.1:8788. It answers exactly the calls
   src/google.js and src/gemini.js make, and nothing more. */

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const files = new Map();    // id -> {name, mime, bytes, trashed}
const sessions = new Map(); // upload_id -> {name, mime, total, chunks: Buffer[], got, fileId}

const send = (res, status, body, headers = {}) => {
  const isObj = body !== undefined && body !== null && !Buffer.isBuffer(body) && typeof body !== 'string';
  res.writeHead(status, { ...(isObj ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
};

async function readBody(req) {
  const parts = [];
  for await (const c of req) parts.push(c);
  return Buffer.concat(parts);
}

// multipart/related: a JSON part, then the file bytes.
function parseMultipart(buf, contentType) {
  const m = /boundary=([^;]+)/.exec(contentType || '');
  if (!m) return null;
  const delim = Buffer.from('--' + m[1].trim());
  const segs = [];
  let at = buf.indexOf(delim);
  while (at !== -1) {
    const next = buf.indexOf(delim, at + delim.length);
    if (next === -1) break;
    // skip the CRLF after the boundary and the CRLF before the next one
    segs.push(buf.subarray(at + delim.length + 2, next - 2));
    at = next;
  }
  const parsed = segs.map((s) => {
    const cut = s.indexOf('\r\n\r\n');
    return { head: s.subarray(0, cut).toString('latin1'), body: s.subarray(cut + 4) };
  });
  if (parsed.length < 2) return null;
  const mime = /content-type:\s*([^\r\n;]+)/i.exec(parsed[1].head);
  return { meta: JSON.parse(parsed[0].body.toString('utf8')), bytes: parsed[1].body, mime: mime ? mime[1] : 'application/octet-stream' };
}

function serveBytes(req, res, f) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const headers = { 'Content-Type': f.mime, 'Accept-Ranges': 'bytes' };
  if (!range) return send(res, 200, f.bytes, { ...headers, 'Content-Length': f.bytes.length });
  const from = Number(range[1]);
  const to = Math.min(range[2] === '' ? f.bytes.length - 1 : Number(range[2]), f.bytes.length - 1);
  const slice = f.bytes.subarray(from, to + 1);
  send(res, 206, slice, { ...headers, 'Content-Range': `bytes ${from}-${to}/${f.bytes.length}`, 'Content-Length': slice.length });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE);
    const p = url.pathname;
    const q = url.searchParams;

    if (req.method === 'POST' && p === '/token') {
      await readBody(req);
      return send(res, 200, { access_token: 'standin', expires_in: 3600 });
    }

    if (p === '/upload/drive/v3/files') {
      if (req.method === 'POST' && q.get('uploadType') === 'resumable') {
        const meta = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const id = randomUUID();
        sessions.set(id, {
          name: meta.name || 'untitled',
          mime: req.headers['x-upload-content-type'] || 'application/octet-stream',
          total: Number(req.headers['x-upload-content-length']) || 0,
          chunks: [],
          got: 0,
        });
        return send(res, 200, {}, { Location: `${BASE}/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` });
      }
      if (req.method === 'POST' && q.get('uploadType') === 'multipart') {
        const mp = parseMultipart(await readBody(req), req.headers['content-type']);
        if (!mp) return send(res, 400, { error: 'bad multipart' });
        const id = randomUUID();
        files.set(id, { name: mp.meta.name, mime: mp.mime, bytes: mp.bytes, trashed: false });
        return send(res, 200, { id });
      }
      if (req.method === 'PUT') {
        const s = sessions.get(q.get('upload_id'));
        if (!s) return send(res, 404, { error: 'no session' });
        const body = await readBody(req);
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers['content-range'] || '');
        if (m) {
          if (Number(m[1]) === s.got) { s.chunks.push(body); s.got += body.length; }
          s.total = Number(m[3]);
        } // "bytes */total" is a status check
        if (s.total && s.got >= s.total) {
          if (!s.fileId) {
            s.fileId = randomUUID();
            files.set(s.fileId, { name: s.name, mime: s.mime, bytes: Buffer.concat(s.chunks), trashed: false });
          }
          return send(res, 200, { id: s.fileId, name: s.name });
        }
        return send(res, 308, undefined, s.got ? { Range: `bytes=0-${s.got - 1}` } : {});
      }
    }

    let m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (m) {
      const f = files.get(decodeURIComponent(m[1]));
      if (req.method === 'GET' && q.get('alt') === 'media') return f ? serveBytes(req, res, f) : send(res, 404, { error: 'not found' });
      if (req.method === 'GET' && q.get('fields') === 'thumbnailLink') {
        return f ? send(res, 200, { thumbnailLink: `${BASE}/thumb/${m[1]}` }) : send(res, 404, { error: 'not found' });
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!f) return send(res, 404, { error: 'not found' });
        if (body.trashed === true) f.trashed = true;
        return send(res, 200, { id: m[1], trashed: f.trashed });
      }
    }

    m = /^\/thumb\/([^/]+)$/.exec(p);
    if (m && req.method === 'GET') {
      const f = files.get(decodeURIComponent(m[1]));
      return f ? serveBytes(req, res, f) : send(res, 404, { error: 'not found' });
    }

    m = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(p);
    if (m && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const part = body.contents[0].parts.find((x) => x.inline_data);
      const size = Buffer.from(part ? part.inline_data.data : '', 'base64').length;
      // A black frame compresses to almost nothing.
      const verdict = size < 20 * 1024
        ? { wedding: true, screen_ok: false, fit: 0, quality: 0, note: 'stand-in: too small' }
        : { wedding: true, screen_ok: true, fit: 7, quality: 6, note: 'stand-in' };
      return send(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] }, finishReason: 'STOP' }] });
    }

    if (req.method === 'GET' && p === '/_files') {
      return send(res, 200, [...files].map(([id, f]) => ({ id, name: f.name, mime: f.mime, size: f.bytes.length, trashed: f.trashed })));
    }

    send(res, 404, { error: 'stand-in: not handled', method: req.method, path: p });
  } catch (e) {
    console.log('standin error', e && e.message);
    send(res, 500, { error: String(e && e.message) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`stand-in listening on ${BASE}`));
