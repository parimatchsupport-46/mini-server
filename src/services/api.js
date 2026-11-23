/**
 * API client.
 *
 * Two modes:
 *  - production: talks to the real EdgeOne Functions API at /api/*
 *  - preview:    the dashboard is served by plain Vite (no functions), so
 *                requests are routed to an in-browser mock backend that
 *                implements the same contracts and persists to localStorage.
 *
 * Mode detection: Vite injects `import.meta.env.DEV`. On a deployed build we
 * always hit the network. In dev we probe /api/health once and fall back to
 * the mock when it is unavailable.
 */

import { createMockBackend } from './mock-backend.js';

const TOKEN_KEY = 'ss.session.v1';

let mode = null; // 'live' | 'preview'
let mock = null;
let memToken = null;

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || memToken || '';
  } catch {
    return memToken || '';
  }
}

export function setToken(token) {
  memToken = token || '';
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export function clearToken() {
  setToken('');
}

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota */
  }
}

function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Detects whether the real API is available. Cached for the session. */
export async function detectMode() {
  if (mode) return mode;
  if (import.meta.env.DEV) {
    try {
      const res = await fetch('/api/health', { headers: { accept: 'application/json' } });
      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('json')) {
        const body = await res.json();
        if (body?.data?.preview === true) {
          mode = 'preview';
          return mode;
        }
        if (body?.data?.runtime) {
          mode = 'live';
          return mode;
        }
      }
    } catch {
      /* fall through */
    }
    mode = 'preview';
    return mode;
  }
  mode = 'live';
  return mode;
}

export function getMode() {
  return mode || 'live';
}

async function ensureMock() {
  if (!mock) {
    mock = createMockBackend({
      getToken,
      storage: {
        get: lsGet,
        set: lsSet,
        remove: lsRemove,
      },
    });
  }
  return mock;
}

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Core request function.
 * @param {string} method
 * @param {string} path  e.g. '/api/projects'
 * @param {object} [options] { body, form, headers, signal, raw }
 */
export async function request(method, path, options = {}) {
  const current = await detectMode();

  if (current === 'preview') {
    const backend = await ensureMock();
    return backend.handle(method, path, options);
  }

  const headers = { accept: 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token && !options.noAuth) headers.authorization = `Bearer ${token}`;

  let body;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let res;
  try {
    res = await fetch(path, { method, headers, body, signal: options.signal });
  } catch (networkError) {
    if (networkError.name === 'AbortError') throw networkError;
    throw new ApiError(0, 'network_error', 'Cannot reach the API. Check your connection and try again.');
  }

  if (options.raw) {
    if (!res.ok) {
      const err = await safeError(res);
      throw err;
    }
    return res;
  }

  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new ApiError(res.status, 'bad_response', 'Unexpected response from the server.');
  }

  const payload = await res.json();
  if (!res.ok || payload.ok === false) {
    const err = payload.error || {};
    throw new ApiError(res.status, err.code || 'error', err.message || 'Request failed.', err);
  }
  return payload.data;
}

async function safeError(res) {
  try {
    const payload = await res.json();
    const err = payload.error || {};
    return new ApiError(res.status, err.code || 'error', err.message || 'Request failed.');
  } catch {
    return new ApiError(res.status, 'error', `Request failed (${res.status}).`);
  }
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  del: (path, options) => request('DELETE', path, options),
  raw: (method, path, options) => request(method, path, { ...options, raw: true }),
};

/** Resets the cached mode (used by tests + the preview banner). */
export function resetMode() {
  mode = null;
  mock = null;
}
