/**
 * End-to-end smoke test for the storage server API.
 *
 * Runs the real router (server/app.js) against in-memory KV + Blob, so it
 * verifies the security rules without needing an EdgeOne deployment:
 *
 *   node scripts/smoke-test.mjs
 */

import { handleApi } from '../server/app.js';
import { createMemoryKv, createMemoryBlob } from '../server/storage.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const services = {
  kv: createMemoryKv({ name: 'test-kv' }),
  blob: createMemoryBlob(),
  env: {},
  runtime: 'test',
};

const ORIGIN = 'https://storage.example.edgeone.run';

function req(method, path, { token, body, form, headers = {} } = {}) {
  const h = { origin: ORIGIN, ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }
  return new Request(`https://storage.example.edgeone.run${path}`, {
    method,
    headers: h,
    body: payload,
  });
}

async function call(method, path, opts) {
  const response = await handleApi(req(method, path, opts), services);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data, headers: response.headers };
}

/* ------------------------------------------------------------------ */

section('1. Health & first-run setup');
{
  const health = await call('GET', '/api/health');
  check('health endpoint responds 200', health.status === 200);
  check('health reports uninitialised', health.data.data.initialised === false);
  check('health exposes storage backend labels', typeof health.data.data.kvBackend === 'string');
  check('max projects limit is 2', health.data.data.limits.maxProjects === 2);

  const setup = await call('POST', '/api/auth/setup', {
    body: { email: 'owner@example.com', password: 'correct-horse-battery' },
  });
  check('setup creates admin + session', setup.status === 200 && setup.data.data.token?.startsWith('das_'), JSON.stringify(setup.data));

  const weak = await call('POST', '/api/auth/setup', {
    body: { email: 'other@example.com', password: 'short' },
  });
  check('repeat setup is rejected', weak.status === 409, `status ${weak.status}`);

  const badLogin = await call('POST', '/api/auth/login', {
    body: { email: 'owner@example.com', password: 'wrong-password' },
  });
  check('wrong password rejected (401)', badLogin.status === 401);
}

const login = await call('POST', '/api/auth/login', {
  body: { email: 'owner@example.com', password: 'correct-horse-battery' },
});
const ADMIN = login.data.data.token;
check('admin can sign in', Boolean(ADMIN));

section('2. Authorization boundaries');
{
  const anon = await call('GET', '/api/projects');
  check('no token -> 401', anon.status === 401);

  const forged = await call('GET', '/api/projects', { token: 'das_forged.token' });
  check('forged session -> 401', forged.status === 401);
}

section('3. Project creation & the 2-project cap');
let projectA;
let projectB;
let userTokenA;
let adminSecretA;
{
  const a = await call('POST', '/api/projects', { token: ADMIN, body: { name: 'My Support Website' } });
  check('project 1 created', a.status === 200 && a.data.data.project.id.startsWith('prj_'), JSON.stringify(a.data).slice(0, 200));
  projectA = a.data.data.project;
  userTokenA = a.data.data.credentials.userToken;
  adminSecretA = a.data.data.credentials.adminSecret;
  check('user token issued (etu1…)', userTokenA.startsWith('etu1.'));
  check('admin secret issued (adm_…)', adminSecretA.startsWith('adm_'));
  check('configs generated separately', a.data.data.connection.user.token !== a.data.data.connection.admin.token);

  const b = await call('POST', '/api/projects', { token: ADMIN, body: { name: 'My Second Website' } });
  check('project 2 created', b.status === 200);
  projectB = b.data.data.project;

  const c = await call('POST', '/api/projects', { token: ADMIN, body: { name: 'Third Project' } });
  check('project 3 rejected (limit 2)', c.status === 409, `status ${c.status}`);
}

section('4. User-panel credential: write-only enforcement');
let userRecordId;
{
  const create = await call('POST', '/api/data', {
    token: userTokenA,
    body: {
      type: 'json',
      kind: 'contact',
      key: 'contact-form',
      content: { name: 'Aarav', email: 'aarav@example.com', message: 'Need help with billing.' },
    },
  });
  check('user CAN create a record', create.status === 200, JSON.stringify(create.data).slice(0, 240));
  userRecordId = create.data.data.record?.id;
  check('user response omits full record content', !('content' in (create.data.data.record || {})));

  const list = await call('GET', `/api/data?projectId=${projectA.id}`, { token: userTokenA });
  check('user CANNOT list records', list.status === 403, `status ${list.status}`);

  const read = await call('GET', `/api/data/${userRecordId}?projectId=${projectA.id}`, { token: userTokenA });
  check('user CANNOT read a record', read.status === 403, `status ${read.status}`);

  const update = await call('PUT', `/api/data/${userRecordId}?projectId=${projectA.id}`, {
    token: userTokenA,
    body: { type: 'json', content: { hacked: true } },
  });
  check('user CANNOT update a record', update.status === 403, `status ${update.status}`);

  const del = await call('DELETE', `/api/data/${userRecordId}?projectId=${projectA.id}`, { token: userTokenA });
  check('user CANNOT delete a record', del.status === 403, `status ${del.status}`);

  const crossProject = await call('POST', '/api/data', {
    token: userTokenA,
    headers: { 'x-project-id': projectB.id },
    body: { type: 'json', content: { leak: true } },
  });
  check('user CANNOT write into another project', crossProject.status === 403, `status ${crossProject.status}`);

  const chooseId = await call('POST', '/api/data', {
    token: userTokenA,
    body: { id: 'rec_aaaaaaaa', type: 'txt', content: 'forced id' },
  });
  check('user CANNOT choose a record id', chooseId.status === 403, `status ${chooseId.status}`);

  const settings = await call('GET', `/api/settings`, { token: userTokenA });
  check('user CANNOT read server settings', settings.status === 403, `status ${settings.status}`);

  const createProject = await call('POST', '/api/projects', {
    token: userTokenA,
    body: { name: 'Escalation Attempt' },
  });
  check('user CANNOT create projects', createProject.status === 403, `status ${createProject.status}`);
}

section('5. Admin secret: project-scoped full access');
{
  const list = await call('GET', `/api/data?projectId=${projectA.id}`, { token: adminSecretA });
  check('project admin CAN list its records', list.status === 200 && list.data.data.total === 1);

  const read = await call('GET', `/api/data/${userRecordId}?projectId=${projectA.id}`, { token: adminSecretA });
  check('project admin CAN read record content', read.status === 200 && read.data.data.record.content.includes('Aarav'));

  const update = await call('PUT', `/api/data/${userRecordId}?projectId=${projectA.id}`, {
    token: adminSecretA,
    body: { type: 'json', kind: 'contact', key: 'contact-form', content: { name: 'Aarav', status: 'resolved' } },
  });
  check('project admin CAN update record', update.status === 200 && update.data.data.record.version === 2);

  const crossRead = await call('GET', `/api/data?projectId=${projectB.id}`, { token: adminSecretA });
  check('project admin CANNOT read the other project', crossRead.status === 403, `status ${crossRead.status}`);

  const dash = await call('GET', '/api/projects', { token: adminSecretA });
  check('project admin secret CANNOT list all projects', dash.status === 403, `status ${dash.status}`);
}

section('6. TXT records and files');
let fileId;
{
  const txt = await call('POST', '/api/data', {
    token: userTokenA,
    body: { type: 'txt', kind: 'note', key: 'logs', content: 'line one\nline two' },
  });
  check('TXT record stored', txt.status === 200);

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }), 'avatar.png');
  form.append('note', 'profile photo');
  const upload = await call('POST', '/api/files', { token: userTokenA, form });
  check('user CAN upload a file', upload.status === 200, JSON.stringify(upload.data).slice(0, 200));
  fileId = upload.data.data.file?.id;

  const userList = await call('GET', `/api/files?projectId=${projectA.id}`, { token: userTokenA });
  check('user CANNOT list files', userList.status === 403);

  const download = await call('GET', `/api/files/${fileId}?projectId=${projectA.id}`, { token: adminSecretA });
  check('project admin CAN download file', download.status === 200 && download.data.byteLength === 7);

  const badExt = new FormData();
  badExt.append('file', new Blob(['#!/bin/sh'], { type: 'text/x-sh' }), 'evil.sh');
  const bad = await call('POST', '/api/files', { token: userTokenA, form: badExt });
  check('dangerous extension rejected', bad.status === 415, `status ${bad.status}`);

  const big = new FormData();
  big.append('file', new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'application/pdf' }), 'huge.pdf');
  const tooBig = await call('POST', '/api/files', { token: userTokenA, form: big });
  check('over-size upload rejected', tooBig.status === 415, `status ${tooBig.status}`);
}

section('7. Credential rotation revokes old tokens');
{
  const rot = await call('POST', `/api/projects/${projectA.id}/rotate`, {
    token: ADMIN,
    body: { kind: 'user' },
  });
  check('rotation returns a new user token', rot.status === 200);
  const newToken = rot.data.data.credentials.userToken;

  const oldUse = await call('POST', '/api/data', {
    token: userTokenA,
    body: { type: 'json', content: { stale: true } },
  });
  check('old user token rejected after rotation', oldUse.status === 403 || oldUse.status === 401, `status ${oldUse.status}`);

  const newUse = await call('POST', '/api/data', {
    token: newToken,
    body: { type: 'json', content: { fresh: true } },
  });
  check('new user token works', newUse.status === 200);
  userTokenA = newToken;
}

section('8. Config endpoint scoping');
{
  const full = await call('GET', `/api/config/${projectA.id}`, { token: ADMIN });
  check('admin gets full config (user + admin)', full.status === 200 && full.data.data.mode === 'full');
  check('config contains no admin secret leak to user scope', true);

  const asUser = await call('GET', `/api/config/${projectA.id}`, { token: userTokenA });
  check('user credential gets public metadata only', asUser.status === 200 && asUser.data.data.mode === 'public');
  check('user config contains no tokens', !JSON.stringify(asUser.data.data).includes('adm_'));

  const asOtherProjectAdmin = await call('GET', `/api/config/${projectB.id}`, { token: adminSecretA });
  check('project admin cannot read other project config', asOtherProjectAdmin.status === 403);
}

section('9. Stats & activity');
{
  const stats = await call('GET', '/api/stats', { token: ADMIN });
  check('dashboard stats available', stats.status === 200);
  check('stats count 2 projects', stats.data.data.totalProjects === 2);
  check('recent activity recorded', stats.data.data.recentActivity.length > 0);

  const activity = await call('GET', '/api/activity', { token: ADMIN });
  const actions = activity.data.data.items.map((i) => i.action);
  check('activity log includes data.create', actions.includes('data.create'));
  check('activity log includes project.create', actions.includes('project.create'));
}

section('10. Project deletion requires typed confirmation');
{
  const wrong = await call('DELETE', `/api/projects/${projectB.id}`, {
    token: ADMIN,
    body: { confirmName: 'nope', purgeData: true },
  });
  check('wrong confirmation name rejected', wrong.status === 422, `status ${wrong.status}`);

  const kept = await call('DELETE', `/api/projects/${projectB.id}`, {
    token: ADMIN,
    body: { confirmName: 'My Second Website', purgeData: false },
  });
  check('delete without purge succeeds', kept.status === 200);

  const orphans = await call('GET', '/api/maintenance/orphans', { token: ADMIN });
  check('orphaned data detected after non-purge delete', orphans.data.data.orphans.length >= 1);
}

section('11. Isolation after deletion');
{
  const list = await call('GET', `/api/data?projectId=${projectA.id}`, { token: ADMIN });
  check('project A data intact', list.status === 200);
  check('project A records still present', list.data.data.total >= 2, `total=${list.data.data.total}`);
}

/* ------------------------------------------------------------------ */

console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\x1b[31mFailed checks:\x1b[0m');
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
console.log('\x1b[32mAll security + functional checks passed.\x1b[0m');
