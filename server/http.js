/**
 * HTTP helpers shared by every API module.
 * Runtime-neutral: uses only Web APIs (Request/Response/URL) available both in
 * EdgeOne Edge Functions and in modern browsers.
 */

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const errors = {
  badRequest: (msg = 'Bad request', extra) => new ApiError(400, 'bad_request', msg, extra),
  unauthorized: (msg = 'Authentication required', extra) => new ApiError(401, 'unauthorized', msg, extra),
  forbidden: (msg = 'You do not have permission to perform this action', extra) => new ApiError(403, 'forbidden', msg, extra),
  notFound: (msg = 'Not found', extra) => new ApiError(404, 'not_found', msg, extra),
  conflict: (msg = 'Conflict', extra) => new ApiError(409, 'conflict', msg, extra),
  limit: (msg = 'Limit reached', extra) => new ApiError(429, 'limit_reached', msg, extra),
  tooLarge: (msg = 'Payload too large', extra) => new ApiError(413, 'too_large', msg, extra),
  unsupported: (msg = 'Unsupported media type', extra) => new ApiError(415, 'unsupported', msg, extra),
  server: (msg = 'Internal error', extra) => new ApiError(500, 'server_error', msg, extra),
};

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/**
 * Builds CORS headers. The API is token based (never cookie based), so
 * `Access-Control-Allow-Origin` may safely reflect the caller origin.
 */
export function corsHeaders(request, extra = {}) {
  const origin = request?.headers?.get?.('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Project-Key, X-Project-Id, X-Requested-With',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, X-Request-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    ...extra,
  };
}

export function json(data, { status = 200, request, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...corsHeaders(request), ...headers },
  });
}

export function ok(data, opts = {}) {
  return json({ ok: true, data }, opts);
}

export function fail(error, { request } = {}) {
  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  const body = {
    ok: false,
    error: {
      code: error?.code || 'server_error',
      message: status >= 500 ? 'Server error. Check function logs.' : error?.message || 'Request failed',
      ...(error?.extra || {}),
    },
  };
  if (status >= 500 && error?.message) {
    try {
      console.error('[storage-server]', error.message);
    } catch {
      /* ignore */
    }
  }
  return json(body, { status, request });
}

export function preflight(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** Reads a JSON body with a hard size cap (KV values are expensive). */
export async function readJson(request, { maxBytes = 2 * 1024 * 1024 } = {}) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json') && !type.includes('text/plain') && type !== '') {
    // Allow missing content-type for convenience with curl.
    if (!type.includes('multipart/form-data') && !type.includes('application/octet-stream')) {
      throw errors.unsupported(`Expected application/json, got "${type}".`);
    }
  }
  const text = await request.text();
  if (!text) return {};
  if (text.length > maxBytes) throw errors.tooLarge('Request body is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw errors.badRequest('Request body is not valid JSON.');
  }
}

export function parseQuery(url) {
  const q = {};
  url.searchParams.forEach((value, key) => {
    q[key] = value;
  });
  return q;
}

export function intParam(value, fallback, { min = 1, max = 500 } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clientIp(request) {
  const h = request.headers;
  return (
    h.get('eo-connecting-ip') ||
    h.get('x-real-ip') ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

export function requestId() {
  try {
    return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  } catch {
    return `req_${Date.now().toString(36)}`;
  }
}

/** Path matcher: "/api/data/:id" against ["api","data","prj_x"] */
export function matchPath(pattern, segments) {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(segments[i]);
    } else if (p !== segments[i]) {
      return null;
    }
  }
  return params;
}

export function segmentsOf(pathname) {
  return pathname.split('/').filter(Boolean);
}
