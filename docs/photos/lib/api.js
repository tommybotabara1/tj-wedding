/* Talking to the Worker (workers/photo-upload). Plain XHR, so uploads report
   progress and can be aborted. */

export const DEFAULT_API = 'https://upload.tomyjeyan.com';

/* The Worker's address. ?api=... is honoured on localhost only, for testing. */
export function apiBase(loc) {
  const q = new URLSearchParams(loc.search || '').get('api');
  if (q && /^(localhost|127\.0\.0\.1)$/.test(loc.hostname) && /^https?:\/\//.test(q)) return q.replace(/\/+$/, '');
  return DEFAULT_API;
}

/* Forgiving match: capitals, spaces and a leading # don't matter.
   Mirror of norm() in workers/photo-upload/src/http.js and normalize() in
   tools/set_photo_album.py. */
export function norm(s) {
  const t = String(s == null ? '' : s);
  return (t.normalize ? t.normalize('NFKC') : t).toLowerCase().replace(/\s+/g, '').replace(/^#+/, '');
}

/* opts: {json, body, headers, progress(loaded), password, admin, handle}
   `handle` is an object that gets an abort() method while the request is in
   flight; an aborted call resolves with {ok:false, status:0, aborted:true}. */
export function call(base, method, path, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, base + path);
    if (opts.password) xhr.setRequestHeader('X-Photo-Password', opts.password);
    if (opts.admin) xhr.setRequestHeader('X-Admin-Password', opts.admin);
    const h = opts.headers || {};
    Object.keys(h).forEach((k) => xhr.setRequestHeader(k, h[k]));
    if (opts.progress && xhr.upload) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.progress(e.loaded); };
    }
    let aborted = false;
    if (opts.handle) opts.handle.abort = () => { aborted = true; xhr.abort(); };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (x) { /* not JSON */ }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    };
    xhr.onabort = () => resolve({ ok: false, status: 0, body: {}, aborted });
    xhr.onerror = xhr.ontimeout = () => resolve({ ok: false, status: 0, body: {} });
    xhr.timeout = 120000; // one 8 MB piece on a slow connection
    if (opts.json) {
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(opts.json));
    } else {
      xhr.send(opts.body || null);
    }
  });
}

/* The Worker signs /m/ links with the address it was reached at. Re-point them
   at the base this page is using, so they load the same way in production (no
   change) and through a local dev server (which reports a different host). */
export function mediaUrl(base, url) {
  try {
    const u = new URL(url);
    return u.pathname.startsWith('/m/') ? base + u.pathname + u.search : url;
  } catch (e) {
    return url;
  }
}
