/**
 * Rate limiting - fixed-window counters kept in KV.
 *
 * KV has no atomic increment, so a tiny race is possible under heavy parallel
 * load. For a personal storage server with a 2-project cap that trade-off is
 * acceptable and much cheaper than a Durable Object.
 */

import { K } from './core.js';

export async function rateLimit(kv, { scope, id, limit, windowSeconds = 60 }) {
  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = K.ratelimit(scope, `${sanitise(id)}_${windowId}`);

  let count = 0;
  try {
    const raw = await kv.get(key);
    count = Number(raw || 0);
  } catch {
    count = 0;
  }

  if (count >= limit) {
    const resetAt = (windowId + 1) * windowSeconds * 1000;
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfter: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  }

  try {
    await kv.put(key, String(count + 1));
  } catch {
    /* never fail a request because the counter could not be written */
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - count - 1),
    limit,
    resetAt: (windowId + 1) * windowSeconds * 1000,
  };
}

function sanitise(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 48) || 'unknown';
}
