/**
 * Frontend helpers: escape, format, debounce, clipboard, colour hashing.
 */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clsx(...args) {
  const out = [];
  for (const arg of args) {
    if (!arg) continue;
    if (typeof arg === 'string') out.push(arg);
    else if (Array.isArray(arg)) out.push(clsx(...arg));
    else if (typeof arg === 'object') {
      for (const [k, v] of Object.entries(arg)) if (v) out.push(k);
    }
  }
  return out.join(' ');
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 2 : 1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function formatNumber(n) {
  return new Intl.NumberFormat().format(Number(n) || 0);
}

export function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(iso);
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeUntil(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diff = t - Date.now();
  if (diff <= 0) return 'expired';
  const hrs = Math.floor(diff / 3600000);
  if (hrs >= 1) return `${hrs}h`;
  return `${Math.max(1, Math.floor(diff / 60000))}m`;
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function throttle(fn, wait = 300) {
  let last = 0;
  let timer = null;
  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

export async function copyToClipboard(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Deterministic pastel gradient per project id (stable avatar colours). */
export function colorFor(seed) {
  const palettes = [
    ['#5aa9ff', '#007aff'],
    ['#8b8cf0', '#5856d6'],
    ['#5fd97f', '#2fbf53'],
    ['#ffb340', '#ff8a00'],
    ['#ff8f8a', '#f0473c'],
    ['#7bd0e8', '#0a9fc4'],
    ['#c98cf0', '#9b4fd6'],
    ['#f0a3c8', '#d6558f'],
  ];
  let h = 0;
  const s = String(seed || 'x');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000;
  const [a, b] = palettes[h % palettes.length];
  return `linear-gradient(150deg, ${a}, ${b})`;
}

export function initials(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'P';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function truncateMiddle(str, head = 10, tail = 6) {
  const s = String(str ?? '');
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function fileKind(mime = '', name = '') {
  const m = String(mime).toLowerCase();
  const ext = String(name).toLowerCase().split('.').pop();
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (m.includes('zip') || ['zip', 'rar', '7z'].includes(ext)) return 'archive';
  if (['txt', 'csv', 'json', 'md'].includes(ext)) return 'text';
  return 'file';
}

export function on(el, event, selectorOrHandler, handler) {
  if (typeof selectorOrHandler === 'function') {
    el.addEventListener(event, selectorOrHandler);
    return;
  }
  el.addEventListener(event, (e) => {
    const target = e.target.closest(selectorOrHandler);
    if (target && el.contains(target)) handler(e, target);
  });
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function safeParse(json, fallback = null) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function prettifyJsonSafe(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(value ?? '');
  }
}

export function prettyJson(value) {
  try {
    return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

export function isMobile() {
  return window.matchMedia('(max-width: 860px)').matches;
}
