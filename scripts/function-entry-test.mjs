/**
 * Verifies the real EdgeOne Function entrypoints load and dispatch.
 * Stubs the platform context (env + KV binding) and the Blob SDK.
 *   node scripts/function-entry-test.mjs
 */
import { createMemoryKv } from '../server/storage.js';

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ''}`); } };

// Minimal stand-in for the EdgeOne KV binding surface (get/put/delete/list).
const memory = createMemoryKv({ name: 'stub-binding' });
const kvBinding = {
  async get(key, opts) { return memory.get(key, opts?.type === 'json' ? 'json' : 'text'); },
  async put(key, value) { return memory.put(key, value); },
  async delete(key) { return memory.delete(key); },
  async list({ prefix = '', limit = 256, cursor = null } = {}) { return memory.list({ prefix, limit, cursor }); },
};

const env = { STORAGE_KV: kvBinding, ADMIN_SETUP_KEY: '' };

const mod = await import('../functions/api/[[default]].js').catch(() => null);
check('catch-all function module loads', Boolean(mod && typeof mod.onRequest === 'function'));

const call = async (method, path, { body, headers = {} } = {}) => {
  const request = new Request(`https://demo.edgeone.run${path}`, {
    method,
    headers: { origin: 'https://demo.edgeone.run', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const response = await mod.onRequest({ request, env, params: {} });
  const contentType = response.headers.get('content-type') || '';
  return { status: response.status, data: contentType.includes('json') ? await response.json() : null, headers: response.headers };
};

console.log('\n\x1b[1mEdgeOne entrypoint dispatch\x1b[0m');
const health = await call('GET', '/api/health');
check('GET /api/health → 200', health.status === 200, `status ${health.status}`);
check('health reports edgeone runtime', health.data?.data?.runtime === 'edgeone', JSON.stringify(health.data?.data?.runtime));
check('KV binding detected (not unbound)', /^STORAGE_KV \(bound\)$/.test(String(health.data?.data?.kvBackend)), health.data?.data?.kvBackend);
check('health flags persistent storage', health.data?.data?.persistent === true);
check('blob backend wired', Boolean(health.data?.data?.blobBackend));

const setup = await call('POST', '/api/auth/setup', { body: { email: 'admin@demo.test', password: 'a-very-long-password' } });
check('POST /api/auth/setup creates session', setup.status === 200 && String(setup.data?.data?.token).startsWith('das_'), JSON.stringify(setup.data).slice(0, 160));

const session = setup.data?.data?.token;
const proj = await call('POST', '/api/projects', { body: { name: 'Entry Test Project' }, headers: { authorization: `Bearer ${session}` } });
check('POST /api/projects works through the function', proj.status === 200 && String(proj.data?.data?.project?.id).startsWith('prj_'), JSON.stringify(proj.data).slice(0, 160));

const projectId = proj.data?.data?.project?.id;
const userToken = proj.data?.data?.credentials?.userToken;

const write = await call('POST', '/api/data', {
  body: { projectId, type: 'json', content: { from: 'entry-test' } },
  headers: { authorization: `Bearer ${userToken}` },
});
check('user token can write through the function', write.status === 200, JSON.stringify(write.data).slice(0, 140));

const readAttempt = await call('GET', `/api/data?projectId=${projectId}`, { headers: { authorization: `Bearer ${userToken}` } });
check('user token still cannot read (403)', readAttempt.status === 403, `status ${readAttempt.status}`);

const cors = await call('OPTIONS', '/api/data');
check('OPTIONS preflight returns 204', cors.status === 204);
check('CORS allow-origin reflected', cors.headers.get('access-control-allow-origin') === 'https://demo.edgeone.run');

const unknown = await call('GET', '/api/nope');
check('unknown route → 404 JSON', unknown.status === 404 && unknown.data?.ok === false);

// Every route file should expose onRequest and share the router.
const files = ['projects.js', 'data.js', 'files.js', 'configs.js', 'auth.js'];
for (const file of files) {
  const m = await import(`../functions/api/${file}`).catch(() => null);
  check(`functions/api/${file} exposes onRequest`, Boolean(m?.onRequest));
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
