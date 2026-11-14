/* The small copy: what the contest shows is a 1600 px JPEG, made on the phone
   so the Worker never has to resize. Any failure gives null and the original
   is sent anyway (the cron then falls back to Drive's own thumbnail). */

const COPY_MAX = 1600, COPY_QUALITY = 0.82;
const THUMB_MAX = 96, THUMB_QUALITY = 0.6;
const TIMEOUT_MS = 10000;

export function fitWithin(w, h, max = 1600) {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no-blob'))), 'image/jpeg', quality);
  });
}

function draw(source, sw, sh, max) {
  const { w, h } = fitWithin(sw, sh, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  return canvas;
}

async function frameOfPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { source: bmp, w: bmp.width, h: bmp.height, done: () => { if (bmp.close) bmp.close(); } };
}

function frameOfVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = () => { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); };
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onerror = () => { done(); reject(new Error('video')); };
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) ? v.duration : 3;
      v.currentTime = Math.min(1, d / 3);
    };
    v.onseeked = () => {
      if (!v.videoWidth) { done(); reject(new Error('video-size')); return; }
      resolve({ source: v, w: v.videoWidth, h: v.videoHeight, done });
    };
    v.src = url;
  });
}

async function build(file, kind) {
  const f = kind === 'video' ? await frameOfVideo(file) : await frameOfPhoto(file);
  try {
    const copy = await toBlob(draw(f.source, f.w, f.h, COPY_MAX), COPY_QUALITY);
    const thumb = draw(f.source, f.w, f.h, THUMB_MAX).toDataURL('image/jpeg', THUMB_QUALITY);
    return { copy, thumb };
  } finally {
    f.done();
  }
}

/* → {copy: Blob, thumb: dataURL} or null on any failure, or after 10 s. */
export function makeSmallCopy(file, kind) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    build(file, kind).then(
      (r) => { clearTimeout(timer); resolve(r); },
      () => { clearTimeout(timer); resolve(null); }
    );
  });
}
