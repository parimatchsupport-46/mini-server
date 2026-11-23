/**
 * Shared helpers used by the browser dashboard AND by EdgeOne Functions.
 *
 * This file is runtime-neutral on purpose: no DOM, no Node built-ins, no imports.
 * It is the single source of truth for:
 *   - record / project data shapes
 *   - ID + token generation
 *   - password hashing (PBKDF2-SHA256, WebCrypto)
 *   - the HMAC "user token" format (stateless, signed, capped)
 *   - input validation
 *   - storage key naming
 *
 * Everything exported here is safe for the client bundle: it contains no secrets.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  MAX_PROJECTS: 2,
  KV_MAX_BYTES: 25 * 1024 * 1024,          // EdgeOne KV hard limit per value
  RECORD_MAX_BYTES: 2 * 1024 * 1024,       // our own, smaller, per-record cap
  RECORD_MAX_COUNT_PER_PROJECT: 5000,      // soft cap per project
  FILE_MAX_BYTES: 20 * 1024 * 1024,        // keep below Blob 25 MB/object
  FILES_MAX_COUNT_PER_PROJECT: 2000,
  PBKDF2_ITERATIONS: 100_000,
  RATE_LIMIT_WINDOW_SECONDS: 60,
  RATE_LIMIT_USER_PER_MIN: 60,             // per project, user-panel writes
  RATE_LIMIT_DEMO: 100,
};

export const RECORD_TYPES = ['json', 'txt'];

export const RECORD_KINDS = [
  'note',      // free text
  'contact',   // form submission
  'order',
  'event',
  'feedback',
  'config',
  'other',
];

export const ALLOWED_UPLOAD_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'text/plain',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'application/octet-stream',
];

export const ALLOWED_UPLOAD_EXT = [
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
  'pdf', 'zip',
  'mp3', 'wav', 'ogg', 'm4a',
  'mp4', 'webm',
  'txt', 'csv', 'json', 'md',
  'doc', 'docx', 'xls', 'xlsx',
];

/* ------------------------------------------------------------------ */
/* IDs                                                                */
/* ------------------------------------------------------------------ */

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomBytes(len) {
  const out = new Uint8Array(len);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < len; i += 1) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

export function randomString(len = 16, alphabet = ALPHANUM) {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i += 1) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

/** Human-ish project id: `prj_a1b2c3d4` */
export function generateProjectId() {
  return `prj_${randomString(10)}`;
}

/** Record ids are prefixed so they are self-describing in logs. */
export function generateRecordId() {
  return `rec_${Date.now().toString(36)}${randomString(6)}`;
}

export function generateFileId() {
  return `fil_${Date.now().toString(36)}${randomString(6)}`;
}

export function generateActivityId() {
  return `act_${Date.now().toString(36)}${randomString(4)}`;
}

/** Secret tokens given to external projects. Prefixed to be recognisable. */
export function generateUserToken() {
  return `usr_${randomString(40)}`;
}

export function generateAdminSecret() {
  return `adm_${randomString(44)}`;
}

/** Session id for an admin login (stored server-side in KV). */
export function generateSessionId() {
  return `ses_${randomString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Encoding / hashing                                                 */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64Url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const clean = String(hex);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function byteLength(str) {
  return enc.encode(String(str)).length;
}

/** Wipe a byte array as far as the runtime allows. */
export function wipe(bytes) {
  if (bytes && typeof bytes.fill === 'function') bytes.fill(0);
}

/* ------------------------------------------------------------------ */
/* Password hashing (PBKDF2-SHA256)                                   */
/* ------------------------------------------------------------------ */

export async function pbkdf2Hash(password, { iterations = LIMITS.PBKDF2_ITERATIONS } = {}) {
  const salt = randomBytes(16);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    iterations ? 256 : 256,
  );
  return `pbkdf2$${iterations}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function pbkdf2Verify(password, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const iterations = Number(iterStr);
    const salt = fromBase64Url(saltB64);
    const expected = fromBase64Url(hashB64);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        keyMaterial,
        expected.length * 8,
      ),
    );
    return timingSafeEqualHex(bytesToHex(bits), bytesToHex(expected));
  } catch {
    return false;
  }
}

/** Constant-time-ish string compare. */
export function timingSafeEqualHex(a, b) {
  const sa = String(a);
  const sb = String(b);
  let diff = sa.length ^ sb.length;
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function hmacSign(secret, messageB64) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(messageB64));
  return toBase64Url(new Uint8Array(sig));
}

/* ------------------------------------------------------------------ */
/* Capability tokens (User Panel credentials)                         */
/* ------------------------------------------------------------------ */

const USER_CAPS = ['data.send', 'files.send', 'meta.read'];

/**
 * Build a restricted, publishable credential for an external project's
 * public frontend.
 *
 *   etu1.<base64url(payload)>.<hmac-sha256>
 *
 * payload = { v:1, pid, can, rid, iat }
 *   can : capability list - always a subset of USER_CAPS
 *   rid : rotation id, lets you revoke credentials server-side
 *
 * The token is *not* a storage key and *not* an admin credential. The server
 * still enforces rate limits, size limits, MIME limits and project isolation.
 */
export async function createUserToken({ projectId, rotationId, signingSecret, issuedAt = Date.now() }) {
  const payload = {
    v: 1,
    pid: projectId,
    can: USER_CAPS,
    rid: rotationId,
    iat: issuedAt,
  };
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSign(signingSecret, body);
  return { token: `etu1.${body}.${sig}`, payload };
}

export async function verifyUserToken(token, signingSecret) {
  try {
    const parts = String(token).trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'etu1') return { ok: false, reason: 'malformed' };
    const [, body, sig] = parts;
    const expected = await hmacSign(signingSecret, body);
    if (!timingSafeEqualHex(sig, expected)) return { ok: false, reason: 'bad_signature' };
    const payload = JSON.parse(dec.decode(fromBase64Url(body)));
    if (payload.v !== 1 || !payload.pid) return { ok: false, reason: 'bad_payload' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export const USER_CAPABILITIES = Object.freeze(USER_CAPS.slice());
export const ADMIN_CAPABILITIES = Object.freeze([
  'data.read', 'data.write', 'data.update', 'data.delete',
  'files.read', 'files.write', 'files.delete',
  'project.manage',
]);

/* ------------------------------------------------------------------ */
/* Record helpers                                                     */
/* ------------------------------------------------------------------ */

export function normalizeRecordType(value, fallback = 'json') {
  const t = String(value || '').toLowerCase();
  return RECORD_TYPES.includes(t) ? t : fallback;
}

/**
 * Records are stored as a single JSON object:
 * {
 *   id, projectId, type, kind, key, content (string), tags[], meta{}, createdAt, updatedAt, version
 * }
 * `content` is always a string: JSON is serialised, TXT is stored verbatim.
 */
export function buildRecord(payload = {}, { actor = 'admin' } = {}) {
  const now = new Date().toISOString();
  const type = normalizeRecordType(payload.type);
  let content = payload.content;

  if (type === 'json') {
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed === '') content = '{}';
      else {
        try {
          JSON.parse(trimmed);
        } catch {
          throw new ValidationError('content', 'Record content must be valid JSON for type "json".');
        }
      }
    } else {
      content = JSON.stringify(content, null, 2);
    }
  } else {
    content = content == null ? '' : String(content);
  }

  return {
    id: payload.id || generateRecordId(),
    projectId: payload.projectId,
    type,
    kind: RECORD_KINDS.includes(payload.kind) ? payload.kind : 'other',
    key: sanitizeKey(payload.key || ''),
    content,
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 12).map(String) : [],
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
    source: actor,
    createdAt: payload.createdAt || now,
    updatedAt: now,
    version: Number(payload.version || 1),
  };
}

export function sanitizeKey(key) {
  return String(key || '')
    .normalize('NFKC')
    .replace(/[^\w .:\-/]+/g, '')
    .trim()
    .slice(0, 80);
}

export function recordSizeBytes(record) {
  return byteLength(JSON.stringify(record));
}

/* ------------------------------------------------------------------ */
/* File helpers                                                       */
/* ------------------------------------------------------------------ */

export function fileExt(name) {
  const m = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : '';
}

export function isUploadAllowed({ name, type, size }) {
  const ext = fileExt(name);
  if (!ext || !ALLOWED_UPLOAD_EXT.includes(ext)) {
    return { ok: false, error: `File extension ".${ext || '?'}" is not allowed.` };
  }
  if (size != null && size > LIMITS.FILE_MAX_BYTES) {
    return { ok: false, error: `File is larger than ${Math.round(LIMITS.FILE_MAX_BYTES / 1048576)} MB.` };
  }
  // SVG can carry scripts - allowed only as a download, never inline-served.
  const mime = String(type || '').toLowerCase();
  if (mime && !ALLOWED_UPLOAD_MIME.includes(mime) && !mime.startsWith('image/') && !mime.startsWith('audio/') && !mime.startsWith('video/')) {
    return { ok: false, error: `MIME type "${mime}" is not allowed.` };
  }
  return { ok: true, ext };
}

export function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(2)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!then) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

export class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.status = 422;
  }
}

export function validateProjectName(name) {
  const clean = String(name || '').trim();
  if (clean.length < 2) throw new ValidationError('name', 'Project name must be at least 2 characters.');
  if (clean.length > 60) throw new ValidationError('name', 'Project name must be 60 characters or fewer.');
  if (!/^[\w .()&+'\-]+$/u.test(clean)) {
    throw new ValidationError('name', 'Project name contains unsupported characters.');
  }
  return clean;
}

export function validateProjectId(id) {
  const clean = String(id || '').trim();
  if (!/^prj_[a-z0-9]{6,24}$/.test(clean)) {
    throw new ValidationError('projectId', 'Invalid project id format.');
  }
  return clean;
}

export function validatePassword(password) {
  const clean = String(password || '');
  if (clean.length < 10) throw new ValidationError('password', 'Admin password must be at least 10 characters.');
  if (clean.length > 200) throw new ValidationError('password', 'Admin password is too long.');
  return clean;
}

export function validateEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
    throw new ValidationError('email', 'Enter a valid email address.');
  }
  return clean;
}

export function validateRecoveryCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}(-[A-Z0-9]{4}){2,3}$/.test(clean)) {
    throw new ValidationError('recoveryCode', 'Recovery code should look like XXXX-XXXX-XXXX.');
  }
  return clean;
}

/* ------------------------------------------------------------------ */
/* Storage keys                                                       */
/* ------------------------------------------------------------------ */
/**
 * IMPORTANT: EdgeOne KV keys only allow numbers, letters and underscores
 * (max 512 B). Blob keys allow slashes. These helpers keep both consistent.
 */
export const K = {
  meta: () => 'ss_meta_v1',
  admin: () => 'ss_admin_v1',
  settings: () => 'ss_settings_v1',
  projectsIndex: () => 'ss_projects_index_v1',
  project: (id) => `ss_project_${id}`,
  recordsIndex: (id) => `ss_records_${id}`,
  record: (projectId, recordId) => `ss_record_${projectId}_${recordId}`,
  filesIndex: (id) => `ss_files_${id}`,
  fileMeta: (projectId, fileId) => `ss_file_${projectId}_${fileId}`,
  activityIndex: () => 'ss_activity_v1',
  session: (sid) => `ss_session_${sid}`,
  ratelimit: (scope, bucket) => `ss_rl_${scope}_${bucket}`,
  setupLock: () => 'ss_setup_lock_v1',
};

export const BLOB = {
  storeName: 'storage-server',
  fileKey: (projectId, fileId, ext) => `${projectId}/files/${fileId}${ext ? `.${ext}` : ''}`,
};

/* ------------------------------------------------------------------ */
/* Misc                                                               */
/* ------------------------------------------------------------------ */

export function nowIso() {
  return new Date().toISOString();
}

export function dayBucket() {
  return new Date().toISOString().slice(0, 10);
}

export function minuteBucket() {
  return Math.floor(Date.now() / 60000).toString(36);
}

export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function truncate(str, n = 120) {
  const s = String(str ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
