/**
 * Admin authentication for the dashboard.
 *
 * Design goals
 *  - Password hash lives in KV (`ss_admin_v1`), never in the frontend.
 *  - Sessions are *stateless* HMAC tokens -> no KV read on every request, so
 *    EdgeOne KV's eventual consistency can never log you out randomly.
 *  - Token format: `das_<base64url(payload)>.<hmac>` where payload = {sub,exp,jti}
 *
 * Environment variables (all optional, recommended for production):
 *   ADMIN_SETUP_KEY   - if set, POST /api/auth/setup requires X-Setup-Key
 *   ADMIN_EMAIL       - default admin email used in the UI
 */

import {
  K,
  LIMITS,
  generateSessionId,
  hmacSign,
  pbkdf2Hash,
  pbkdf2Verify,
  timingSafeEqualHex,
  toBase64Url,
  fromBase64Url,
  validateEmail,
  validatePassword,
} from './core.js';

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours
const enc = new TextEncoder();
const dec = new TextDecoder();

export async function readAdminRecord(kv) {
  const raw = await kv.get(K.admin(), 'json');
  return raw && typeof raw === 'object' ? raw : null;
}

export async function isInitialised(kv) {
  const rec = await readAdminRecord(kv);
  return Boolean(rec?.passwordHash);
}

export async function setupAdmin(kv, { email, password, setupKey }, { env = {} } = {}) {
  if (await isInitialised(kv)) {
    throw Object.assign(new Error('This server is already initialised. Sign in instead.'), {
      status: 409,
      code: 'already_initialised',
    });
  }

  const requiredKey = env.ADMIN_SETUP_KEY;
  if (requiredKey && String(setupKey || '') !== String(requiredKey)) {
    throw Object.assign(new Error('Invalid setup key.'), { status: 403, code: 'bad_setup_key' });
  }

  const cleanEmail = validateEmail(email || env.ADMIN_EMAIL || 'admin@localhost');
  const cleanPassword = validatePassword(password);
  const passwordHash = await pbkdf2Hash(cleanPassword, { iterations: LIMITS.PBKDF2_ITERATIONS });

  const sessionSecret = toBase64Url(
    crypto.getRandomValues(new Uint8Array(32)),
  );

  const record = {
    email: cleanEmail,
    passwordHash,
    sessionSecret,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    passwordChangedAt: new Date().toISOString(),
    version: 1,
  };
  await kv.put(K.admin(), JSON.stringify(record));
  await kv.put(K.meta(), JSON.stringify({
    createdAt: record.createdAt,
    version: 1,
    initialized: true,
  }));

  return { email: cleanEmail };
}

export async function login(kv, { email, password }) {
  const admin = await readAdminRecord(kv);
  if (!admin?.passwordHash) {
    throw Object.assign(new Error('Server is not initialised yet. Complete setup first.'), {
      status: 409,
      code: 'not_initialised',
    });
  }
  if (email && String(email).toLowerCase() !== String(admin.email).toLowerCase()) {
    // Same generic message: do not reveal which field was wrong.
    throw Object.assign(new Error('Invalid email or password.'), { status: 401, code: 'bad_credentials' });
  }
  const valid = await pbkdf2Verify(password, admin.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Invalid email or password.'), { status: 401, code: 'bad_credentials' });
  }
  const token = await issueSessionToken(admin.sessionSecret, { sub: admin.email });
  return {
    token,
    email: admin.email,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function issueSessionToken(secret, { sub = 'admin', ttl = SESSION_TTL_SECONDS } = {}) {
  const payload = {
    sub,
    jti: generateSessionId(),
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, body);
  return `das_${body}.${sig}`;
}

export async function verifySessionToken(token, secret) {
  try {
    const raw = String(token);
    if (!raw.startsWith('das_')) return null;
    // Token shape: das_<base64url(payload)>.<signature>
    const [body, sig] = raw.slice(4).split('.');
    if (!body || !sig) return null;
    const expected = await hmacSign(secret, body);
    if (!timingSafeEqualHex(sig, expected)) return null;
    const payload = JSON.parse(dec.decode(fromBase64Url(body)));
    if (!payload?.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function changePassword(kv, { currentPassword, newPassword }) {
  const admin = await readAdminRecord(kv);
  if (!admin?.passwordHash) {
    throw Object.assign(new Error('Server is not initialised.'), { status: 409, code: 'not_initialised' });
  }
  const valid = await pbkdf2Verify(currentPassword, admin.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Current password is incorrect.'), { status: 401, code: 'bad_credentials' });
  }
  const cleanPassword = validatePassword(newPassword);
  const passwordHash = await pbkdf2Hash(cleanPassword, { iterations: LIMITS.PBKDF2_ITERATIONS });

  // Rotating the session secret invalidates every existing dashboard session.
  const sessionSecret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

  const next = {
    ...admin,
    passwordHash,
    sessionSecret,
    passwordChangedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: (admin.version || 1) + 1,
  };
  await kv.put(K.admin(), JSON.stringify(next));
  return { token: await issueSessionToken(sessionSecret, { sub: next.email }), email: next.email };
}

export async function changeEmail(kv, { currentPassword, email }) {
  const admin = await readAdminRecord(kv);
  if (!admin?.passwordHash) throw Object.assign(new Error('Server is not initialised.'), { status: 409 });
  const valid = await pbkdf2Verify(currentPassword, admin.passwordHash);
  if (!valid) throw Object.assign(new Error('Current password is incorrect.'), { status: 401, code: 'bad_credentials' });
  const cleanEmail = validateEmail(email);
  const next = { ...admin, email: cleanEmail, updatedAt: new Date().toISOString() };
  await kv.put(K.admin(), JSON.stringify(next));
  return { email: cleanEmail };
}

export { SESSION_TTL_SECONDS };
