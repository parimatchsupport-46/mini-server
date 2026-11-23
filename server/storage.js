/**
 * Storage adapters.
 *
 * The server logic talks to a tiny interface:
 *
 *   kv.get(key, type)  -> string | object | ArrayBuffer | null
 *   kv.put(key, value) -> void
 *   kv.delete(key)     -> void
 *   kv.list({prefix, limit, cursor}) -> { keys: [{ name }], complete, cursor }
 *
 *   blob.set(key, value, opts) / blob.get(key, { type }) / blob.delete(key)
 *   blob.list(prefix) / blob.createUploadUrl(key, opts)
 *
 * Two implementations:
 *   - wrapKvBinding(context.env.STORAGE_KV)  (EdgeOne KV, Edge Functions only)
 *   - wrapBlobStore(getStore("storage-server")) (EdgeOne Blob, @edgeone/pages-blob)
 *
 * Plus in-memory fallbacks used by `npm run dev`, the smoke tests and the
 * admin console preview. Falling back keeps the dashboard usable (in demo
 * mode) when a KV namespace has not been bound yet.
 */

/* ------------------------------------------------------------------ */
/* KV                                                                 */
/* ------------------------------------------------------------------ */

export function wrapKvBinding(binding, { name = 'STORAGE_KV' } = {}) {
  const usable = binding && typeof binding.get === 'function' && typeof binding.put === 'function';
  if (!usable) return createMemoryKv({ name: `${name} (unbound)`, label: `${name} (unbound)` });

  return {
    kind: 'kv',
    name,
    // label is what /api/health reports, so operators can see whether the real
    // namespace is bound or the server fell back to non-persistent memory.
    label: `${name} (bound)`,
    async get(key, type = 'text') {
      if (type === 'json') return binding.get(key, { type: 'json' });
      return binding.get(key, { type });
    },
    async put(key, value) {
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      await binding.put(key, payload);
    },
    async delete(key) {
      await binding.delete(key);
    },
    async list({ prefix = '', limit = 256, cursor = null } = {}) {
      const res = await binding.list({ prefix, limit, cursor });
      const keys = (res?.keys || []).map((k) => ({ name: k.name ?? k.key }));
      return { keys, complete: res?.complete !== false, cursor: res?.cursor || null };
    },
    async listAll(prefix) {
      let cursor = null;
      const out = [];
      for (let guard = 0; guard < 50; guard += 1) {
        // eslint-disable-next-line no-await-in-loop
        const page = await this.list({ prefix, limit: 256, cursor });
        out.push(...page.keys.map((k) => k.name));
        if (page.complete || !page.cursor) break;
        cursor = page.cursor;
      }
      return out;
    },
  };
}

export function createMemoryKv({ name = 'memory', seed = null, label = null } = {}) {
  const map = new Map(seed && typeof seed === 'object' ? Object.entries(seed) : []);
  return {
    kind: 'memory',
    name,
    label: label || 'memory (non-persistent)',
    _map: map,
    async get(key, type = 'text') {
      const v = map.get(key);
      if (v == null) return null;
      const str = typeof v === 'string' ? v : JSON.stringify(v);
      if (type === 'json') {
        try {
          return JSON.parse(str);
        } catch {
          return null;
        }
      }
      if (type === 'arrayBuffer') {
        const bytes = new TextEncoder().encode(str);
        return bytes.buffer;
      }
      return str;
    },
    async put(key, value) {
      map.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async list({ prefix = '', limit = 256, cursor = null } = {}) {
      const all = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? all.indexOf(cursor) : 0;
      const slice = all.slice(start, start + limit);
      const next = start + limit < all.length ? all[start + limit] : null;
      return { keys: slice.map((k) => ({ name: k })), complete: !next, cursor: next };
    },
    async listAll(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Blob                                                               */
/* ------------------------------------------------------------------ */

export function wrapBlobStore(store) {
  if (!store || typeof store.set !== 'function') {
    const fallback = createMemoryBlob();
    fallback.label = 'blob (unavailable - using memory)';
    return fallback;
  }

  return {
    kind: 'blob',
    label: 'blob (bound)',
    async set(key, value, opts = {}) {
      await store.set(key, value, opts);
    },
    async get(key, { type = 'arrayBuffer' } = {}) {
      const res = await store.get(key, { type, consistency: 'strong' });
      return res;
    },
    async delete(key) {
      await store.delete(key);
    },
    async list(prefix) {
      const res = await store.list({ prefix, consistency: 'strong' });
      return (res?.blobs || []).map((b) => b.key);
    },
    async createUploadUrl(key, opts) {
      if (typeof store.createUploadUrl !== 'function') return null;
      return store.createUploadUrl(key, opts);
    },
  };
}

export function createMemoryBlob() {
  const map = new Map();
  return {
    kind: 'memory',
    label: 'memory (non-persistent)',
    async set(key, value) {
      if (value instanceof ArrayBuffer) map.set(key, value);
      else if (typeof Blob !== 'undefined' && value instanceof Blob) map.set(key, await value.arrayBuffer());
      else if (value instanceof Uint8Array) map.set(key, value.buffer.slice(0));
      else map.set(key, new TextEncoder().encode(String(value)).buffer);
    },
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async delete(key) {
      map.delete(key);
    },
    async list(prefix = '') {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async createUploadUrl() {
      return null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Persistence for the browser demo (localStorage)                    */
/* ------------------------------------------------------------------ */

export function createPersistentMemoryKv({ name, storage, prefix }) {
  const key = `${prefix}:kv`;
  let seed = null;
  try {
    const raw = storage?.getItem(key);
    if (raw) seed = JSON.parse(raw);
  } catch {
    seed = null;
  }
  const kv = createMemoryKv({ name, seed });
  kv.label = label || 'memory (non-persistent)';
  kv._persist = () => {
    try {
      storage?.setItem(key, JSON.stringify(Object.fromEntries(kv._map)));
    } catch {
      /* quota - ignore in demo mode */
    }
  };
  kv.put = (async (orig) => async (k, v) => {
    await orig(k, v);
    kv._persist();
  })(kv.put.bind(kv));
  kv.delete = (async (orig) => async (k) => {
    await orig(k);
    kv._persist();
  })(kv.delete.bind(kv));
  return kv;
}
