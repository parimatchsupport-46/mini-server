/**
 * Central API router.
 *
 * Every request goes through:
 *   1. OPTIONS preflight
 *   2. route match
 *   3. authentication (unless the route is public)
 *   4. permission assertion
 *   5. project resolution + ownership check
 *   6. handler
 *
 * `services` is provided by the runtime entrypoint and contains:
 *   { kv, blob, env, runtime: 'edgeone' | 'preview' }
 */

import { K, LIMITS, ValidationError, validateProjectId } from './core.js';
import {
  ApiError,
  clientIp,
  errors,
  fail,
  intParam,
  json,
  matchPath,
  ok,
  parseQuery,
  preflight,
  readJson,
  segmentsOf,
} from './http.js';
import {
  authenticate,
  assertProjectAccess,
  can,
  resolveProject,
} from './permission-manager.js';
import {
  buildConnectionConfig,
  buildEnvSnippet,
  createProject,
  deleteProject,
  findOrphanedData,
  listProjects,
  purgeOrphanedData,
  publicProjectView,
  rotateCredentials,
  updateProject,
} from './project-manager.js';
import {
  createRecord,
  deleteRecord,
  exportRecords,
  getRecord,
  importRecords,
  listRecords,
  recountUsage,
  updateRecord,
} from './kv-manager.js';
import {
  createUploadTicket,
  confirmUpload,
  deleteFile,
  downloadFile,
  listFiles,
  uploadFile,
} from './blob-manager.js';
import { addActivity, clearActivity, listActivity } from './activity.js';
import { rateLimit } from './ratelimit.js';
import {
  changeEmail,
  changePassword,
  isInitialised,
  login,
  readAdminRecord,
  setupAdmin,
  verifySessionToken,
} from './auth.js';

/* ------------------------------------------------------------------ */
/* Small in-isolate cache so we do not re-read the admin record        */
/* on every single request.                                            */
/* ------------------------------------------------------------------ */
const adminCache = { value: null, at: 0 };
const ADMIN_CACHE_MS = 30_000;

async function getAdmin(kv) {
  if (adminCache.value && Date.now() - adminCache.at < ADMIN_CACHE_MS) return adminCache.value;
  const rec = await readAdminRecord(kv);
  adminCache.value = rec;
  adminCache.at = Date.now();
  return rec;
}

export function invalidateAdminCache() {
  adminCache.value = null;
  adminCache.at = 0;
}

/* ------------------------------------------------------------------ */
/* Routes                                                             */
/* ------------------------------------------------------------------ */
/**
 * Each route: { method, path, auth: 'public'|'admin'|'any', action, handler }
 * `action` is the permission checked for non-admin scopes.
 */
const ROUTES = [
  { method: 'GET', path: 'api/health', auth: 'public', handler: health },

  // --- auth ---------------------------------------------------------
  { method: 'POST', path: 'api/auth/setup', auth: 'public', handler: authSetup },
  { method: 'POST', path: 'api/auth/login', auth: 'public', handler: authLogin },
  { method: 'GET', path: 'api/auth/status', auth: 'public', handler: authStatus },
  { method: 'GET', path: 'api/auth/me', auth: 'admin', handler: authMe },
  { method: 'POST', path: 'api/auth/password', auth: 'admin', handler: authPassword },
  { method: 'POST', path: 'api/auth/email', auth: 'admin', handler: authEmail },

  // --- dashboard ----------------------------------------------------
  { method: 'GET', path: 'api/stats', auth: 'admin', handler: stats },
  { method: 'GET', path: 'api/activity', auth: 'admin', handler: activityList },
  { method: 'DELETE', path: 'api/activity', auth: 'admin', handler: activityClear },

  // --- projects -----------------------------------------------------
  { method: 'GET', path: 'api/projects', auth: 'admin', handler: projectsList },
  { method: 'POST', path: 'api/projects', auth: 'admin', handler: projectsCreate },
  { method: 'GET', path: 'api/projects/:id', auth: 'any', action: 'project.read', handler: projectGet },
  { method: 'PATCH', path: 'api/projects/:id', auth: 'admin', handler: projectUpdate },
  { method: 'PUT', path: 'api/projects/:id', auth: 'admin', handler: projectUpdate },
  { method: 'DELETE', path: 'api/projects/:id', auth: 'admin', handler: projectDelete },
  { method: 'POST', path: 'api/projects/:id/rotate', auth: 'admin', handler: projectRotate },

  // --- config -------------------------------------------------------
  { method: 'GET', path: 'api/config/:projectId', auth: 'any', action: 'config.read', handler: configGet },

  // --- data ---------------------------------------------------------
  { method: 'POST', path: 'api/data', auth: 'any', action: 'data.create', handler: dataCreate },
  { method: 'GET', path: 'api/data', auth: 'any', action: 'data.read', handler: dataList },
  { method: 'GET', path: 'api/data/:id', auth: 'any', action: 'data.read', handler: dataGet },
  { method: 'PUT', path: 'api/data/:id', auth: 'any', action: 'data.update', handler: dataUpdate },
  { method: 'PATCH', path: 'api/data/:id', auth: 'any', action: 'data.update', handler: dataUpdate },
  { method: 'DELETE', path: 'api/data/:id', auth: 'any', action: 'data.delete', handler: dataDelete },
  { method: 'POST', path: 'api/data/import', auth: 'admin', handler: dataImport },
  { method: 'GET', path: 'api/export', auth: 'admin', handler: exportProject },

  // --- files --------------------------------------------------------
  { method: 'POST', path: 'api/files', auth: 'any', action: 'files.upload', handler: fileUpload },
  { method: 'GET', path: 'api/files', auth: 'any', action: 'files.read', handler: filesList },
  { method: 'POST', path: 'api/files/ticket', auth: 'any', action: 'files.upload', handler: fileTicket },
  { method: 'POST', path: 'api/files/confirm', auth: 'any', action: 'files.upload', handler: fileConfirm },
  { method: 'GET', path: 'api/files/:id', auth: 'any', action: 'files.read', handler: fileDownload },
  { method: 'DELETE', path: 'api/files/:id', auth: 'any', action: 'files.delete', handler: fileDelete },

  // --- settings + maintenance ---------------------------------------
  { method: 'GET', path: 'api/settings', auth: 'admin', handler: settingsGet },
  { method: 'PUT', path: 'api/settings', auth: 'admin', handler: settingsPut },
  { method: 'GET', path: 'api/maintenance/orphans', auth: 'admin', handler: orphansList },
  { method: 'POST', path: 'api/maintenance/purge', auth: 'admin', handler: orphansPurge },
  { method: 'POST', path: 'api/maintenance/recount', auth: 'admin', handler: recount },
];

/* ------------------------------------------------------------------ */
/* Entry                                                              */
/* ------------------------------------------------------------------ */

export async function handleApi(request, services) {
  if (request.method === 'OPTIONS') return preflight(request);

  const url = new URL(request.url);
  const segments = segmentsOf(url.pathname.replace(/^\/functions/, ''));

  let matched = null;
  let params = null;
  for (const route of ROUTES) {
    if (route.method !== request.method) continue;
    const m = matchPath(`/${route.path}`, segments);
    if (m) {
      matched = route;
      params = m;
      break;
    }
  }

  if (!matched) {
    return fail(errors.notFound(`No route for ${request.method} ${url.pathname}`), { request });
  }

  const ctx = {
    request,
    url,
    params,
    services,
    kv: services.kv,
    blob: services.blob,
    env: services.env || {},
    query: parseQuery(url),
    ip: clientIp(request),
  };

  try {
    if (matched.auth !== 'public') {
      ctx.principal = await authenticateAdminOrToken(request, ctx, matched);
    }
    const result = await matched.handler(ctx);
    return result instanceof Response ? result : ok(result, { request });
  } catch (error) {
    if (error instanceof ApiError || error?.status) {
      return fail(error, { request });
    }
    if (error instanceof ValidationError) {
      return fail(new ApiError(422, 'validation_error', error.message, { field: error.field }), { request });
    }
    console.error('[api] unhandled', error);
    return fail(errors.server(error?.message), { request });
  }
}

/* ------------------------------------------------------------------ */
/* Auth adapter                                                       */
/* ------------------------------------------------------------------ */

async function authenticateAdminOrToken(request, ctx, route) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim() || ctx.query.token || '';

  // Dashboard session token
  if (token.startsWith('das_')) {
    const admin = await getAdmin(ctx.kv);
    if (!admin?.sessionSecret) throw errors.unauthorized('Server not initialised.');
    const payload = await verifySessionToken(token, admin.sessionSecret);
    if (!payload) throw errors.unauthorized('Session expired. Please sign in again.');
    return { scope: 'admin', kind: 'session', projectId: null, label: payload.sub || 'admin' };
  }

  // Project-scoped credentials (user token / admin secret)
  const principal = await authenticate(request, {
    kv: ctx.kv,
    setupKey: ctx.env.ADMIN_SETUP_KEY,
    getProjectIdFromRequest: () =>
      ctx.query.projectId || request.headers.get('x-project-id') || ctx.params.projectId || null,
  });

  if (route.action) {
    if (!can(principal, route.action)) {
      throw errors.forbidden(`The "${principal.scope}" credential cannot perform "${route.action}".`);
    }
  } else if (principal.scope !== 'admin') {
    throw errors.forbidden('This endpoint requires dashboard admin access.');
  }

  return principal;
}

/* ------------------------------------------------------------------ */
/* Handlers - health + auth                                           */
/* ------------------------------------------------------------------ */

async function health({ kv, services }) {
  const initialised = await isInitialised(kv);
  return {
    status: 'ok',
    runtime: services.runtime || 'unknown',
    kvBackend: kv.label || kv.kind,
    kvBackendKind: kv.kind,
    blobBackend: services.blob?.label || services.blob?.kind || 'unknown',
    blobBackendKind: services.blob?.kind || 'unknown',
    persistent: kv.kind !== 'memory',
    initialised,
    limits: {
      maxProjects: LIMITS.MAX_PROJECTS,
      recordMaxBytes: LIMITS.RECORD_MAX_BYTES,
      fileMaxBytes: LIMITS.FILE_MAX_BYTES,
    },
    time: new Date().toISOString(),
  };
}

async function authStatus({ kv, env }) {
  const initialised = await isInitialised(kv);
  const admin = initialised ? await getAdmin(kv) : null;
  return {
    initialised,
    email: admin?.email || env.ADMIN_EMAIL || null,
    setupKeyRequired: Boolean(env.ADMIN_SETUP_KEY),
  };
}

async function authSetup({ request, kv, env }) {
  const body = await readJson(request);
  const rl = await rateLimit(kv, { scope: 'setup', id: clientIp(request), limit: 5, windowSeconds: 300 });
  if (!rl.allowed) {
    throw new ApiError(429, 'rate_limited', 'Too many setup attempts. Try again shortly.', { retryAfter: rl.retryAfter });
  }
  const result = await setupAdmin(kv, body, { env });
  invalidateAdminCache();
  await addActivity(kv, { action: 'auth.setup', message: 'Admin account created' });
  const session = await login(kv, { email: result.email, password: body.password });
  return session;
}

async function authLogin({ request, kv }) {
  const body = await readJson(request);
  const rl = await rateLimit(kv, { scope: 'login', id: clientIp(request), limit: 10, windowSeconds: 300 });
  if (!rl.allowed) {
    throw new ApiError(429, 'rate_limited', 'Too many login attempts. Try again shortly.', {
      retryAfter: rl.retryAfter,
    });
  }
  const session = await login(kv, body);
  await addActivity(kv, { action: 'auth.login', message: `Signed in as ${session.email}` });
  return session;
}

async function authMe({ principal, kv }) {
  const admin = await getAdmin(kv);
  return {
    email: admin?.email || principal.label,
    createdAt: admin?.createdAt,
    passwordChangedAt: admin?.passwordChangedAt,
  };
}

async function authPassword({ request, kv }) {
  const body = await readJson(request);
  const result = await changePassword(kv, body);
  invalidateAdminCache();
  await addActivity(kv, { action: 'auth.password', message: 'Admin password changed' });
  return result;
}

async function authEmail({ request, kv }) {
  const body = await readJson(request);
  const result = await changeEmail(kv, body);
  invalidateAdminCache();
  await addActivity(kv, { action: 'auth.email', message: 'Admin email changed' });
  return result;
}

/* ------------------------------------------------------------------ */
/* Handlers - dashboard                                               */
/* ------------------------------------------------------------------ */

async function stats({ kv }) {
  const projects = await listProjects(kv);
  const activity = await listActivity(kv, { limit: 8 });
  const totals = projects.reduce(
    (acc, p) => {
      acc.records += p.usage?.records || 0;
      acc.files += p.usage?.files || 0;
      acc.kvBytes += p.usage?.kvBytes || 0;
      acc.blobBytes += p.usage?.blobBytes || 0;
      if (p.status === 'active') acc.active += 1;
      return acc;
    },
    { records: 0, files: 0, kvBytes: 0, blobBytes: 0, active: 0 },
  );

  return {
    projects: projects.map(publicProjectView),
    totalProjects: projects.length,
    activeProjects: totals.active,
    maxProjects: LIMITS.MAX_PROJECTS,
    kv: { usedBytes: totals.kvBytes, records: totals.records },
    blob: { usedBytes: totals.blobBytes, files: totals.files },
    recentActivity: activity,
  };
}

async function activityList({ kv, query }) {
  return { items: await listActivity(kv, { limit: intParam(query.limit, 25, { max: 100 }), projectId: query.projectId || null }) };
}

async function activityClear({ kv }) {
  await clearActivity(kv);
  return { cleared: true };
}

/* ------------------------------------------------------------------ */
/* Handlers - projects                                                */
/* ------------------------------------------------------------------ */

async function projectsList({ kv }) {
  const projects = await listProjects(kv);
  return {
    projects: projects.map((p) => ({
      ...publicProjectView(p),
      keyId: p.config.user.keyId,
      adminKeyId: `ak_live_${p.config.admin.rotationId}`,
    })),
    limit: LIMITS.MAX_PROJECTS,
    canCreate: projects.length < LIMITS.MAX_PROJECTS,
  };
}

async function projectsCreate({ request, kv }) {
  const body = await readJson(request);
  const { project, credentials } = await createProject(kv, body);
  await addActivity(kv, {
    action: 'project.create',
    projectId: project.id,
    projectName: project.name,
    message: `Project "${project.name}" created`,
  });
  return {
    project: publicProjectView(project),
    credentials,
    connection: buildConnectionConfig(project, originOf(request)),
  };
}

async function projectGet({ request, kv, params, principal }) {
  const id = validateProjectId(params.id);
  assertProjectAccess(principal, id);
  const project = await kv.get(K.project(id), 'json');
  if (!project) throw errors.notFound('Project not found.');
  return {
    project: publicProjectView(project),
    connection:
      principal.scope === 'admin' ? buildConnectionConfig(project, originOf(request)) : null,
  };
}

async function projectUpdate({ request, kv, params }) {
  const body = await readJson(request);
  const project = await updateProject(kv, params.id, body);
  await addActivity(kv, {
    action: 'project.update',
    projectId: project.id,
    projectName: project.name,
    message: `Project "${project.name}" updated`,
  });
  return { project: publicProjectView(project) };
}

async function projectDelete({ request, kv, blob, params, url }) {
  const body = request.method === 'DELETE' && request.headers.get('content-length') !== '0'
    ? await readJson(request).catch(() => ({}))
    : {};
  const confirmName = body.confirmName ?? url.searchParams.get('confirm') ?? '';
  const purgeData = body.purgeData ?? url.searchParams.get('purge') !== '0';
  const result = await deleteProject(kv, blob, params.id, { purgeData, confirmName });
  await addActivity(kv, {
    action: 'project.delete',
    projectId: params.id,
    message: `Project deleted${purgeData ? ' with all data' : ''}`,
  });
  return result;
}

async function projectRotate({ request, kv, params, url }) {
  const body = request.method === 'POST' ? await readJson(request).catch(() => ({})) : {};
  const kind = body.kind || url.searchParams.get('kind') || 'user';
  const { project, credentials } = await rotateCredentials(kv, params.id, kind);
  await addActivity(kv, {
    action: 'project.rotate',
    projectId: project.id,
    projectName: project.name,
    message: `Rotated ${kind} credentials for "${project.name}"`,
  });
  return { credentials, connection: buildConnectionConfig(project, originOf(request)) };
}

/* ------------------------------------------------------------------ */
/* Handlers - config                                                  */
/* ------------------------------------------------------------------ */

async function configGet({ request, kv, blob, params, principal }) {
  const projectId = validateProjectId(params.projectId);
  assertProjectAccess(principal, projectId);
  const project = await kv.get(K.project(projectId), 'json');
  if (!project) throw errors.notFound('Project not found.');

  const origin = originOf(request);

  if (principal.scope === 'admin') {
    const recordIds = (await kv.get(K.recordsIndex(projectId), 'json'))?.length || 0;
    const fileList = (await kv.get(K.filesIndex(projectId), 'json')) || [];
    return {
      mode: 'full',
      connection: buildConnectionConfig(project, origin),
      envSnippet: buildEnvSnippet(project, origin),
      storage: {
        records: recordIds,
        files: fileList.length,
        blobBytes: fileList.reduce((s, f) => s + (f.size || 0), 0),
      },
      endpoints: [
        { method: 'POST', path: '/api/data', scope: 'user', desc: 'Create a TXT/JSON record' },
        { method: 'POST', path: '/api/files', scope: 'user', desc: 'Upload a file (multipart)' },
        { method: 'GET', path: `/api/data?projectId=${projectId}`, scope: 'admin', desc: 'List records' },
        { method: 'GET', path: `/api/data/:id?projectId=${projectId}`, scope: 'admin', desc: 'Read record' },
        { method: 'PUT', path: `/api/data/:id?projectId=${projectId}`, scope: 'admin', desc: 'Update record' },
        { method: 'DELETE', path: `/api/data/:id?projectId=${projectId}`, scope: 'admin', desc: 'Delete record' },
        { method: 'GET', path: `/api/files?projectId=${projectId}`, scope: 'admin', desc: 'List files' },
        { method: 'GET', path: `/api/files/:id?projectId=${projectId}`, scope: 'admin', desc: 'Download file' },
        { method: 'DELETE', path: `/api/files/:id?projectId=${projectId}`, scope: 'admin', desc: 'Delete file' },
      ],
    };
  }

  if (principal.scope === 'projectAdmin') {
    return { mode: 'admin-scoped', connection: { projectId, admin: buildConnectionConfig(project, origin).admin } };
  }

  // user credential -> public metadata only, never another credential
  return {
    mode: 'public',
    project: publicProjectView(project),
    endpoints: {
      createRecord: '/api/data',
      uploadFile: '/api/files',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Handlers - data                                                    */
/* ------------------------------------------------------------------ */

function projectIdFor(ctx) {
  const { principal, query, request, params, services } = ctx;
  const fromToken = principal?.projectId || null;
  const fromRequest =
    query.projectId ||
    request.headers.get('x-project-id') ||
    params?.projectId ||
    null;

  if (!fromRequest && !fromToken) throw errors.badRequest('projectId is required.');
  if (fromRequest && fromToken && fromRequest !== fromToken) {
    throw errors.forbidden('Credential belongs to a different project.');
  }
  return fromToken || fromRequest;
}

async function loadScopedProject(ctx) {
  const projectId = projectIdFor(ctx);
  const project = await resolveProject(ctx.request, ctx.principal, ctx.kv);
  return { project, projectId: project.id };
}

async function dataCreate(ctx) {
  const { request, kv, principal } = ctx;
  const body = await readJson(request, { maxBytes: 3 * 1024 * 1024 });
  const { project } = await loadScopedProject(ctx);

  // ---- rate limiting: this is the public write path -----------------
  const limit = principal.scope === 'user'
    ? project.settings.userWritesPerMinute || LIMITS.RATE_LIMIT_USER_PER_MIN
    : 600;
  const rl = await rateLimit(kv, {
    scope: `data_${project.id}`,
    id: principal.kind === 'user-token' ? `${principal.label}_${ctx.ip}` : 'admin',
    limit,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    throw new ApiError(429, 'rate_limited', 'Too many writes for this project. Slow down and retry.', {
      retryAfter: rl.retryAfter,
    });
  }

  // ---- user-panel restrictions -------------------------------------
  if (principal.scope === 'user') {
    if (body.id) throw errors.forbidden('User credentials cannot choose record ids.');
    if (body.type && !['json', 'txt'].includes(String(body.type))) {
      throw errors.badRequest('User credentials may only create "json" or "txt" records.');
    }
    if (project.settings.requireJsonForUser && body.type !== 'json') {
      throw errors.forbidden('This project only accepts JSON records from user credentials.');
    }
    if (body.meta && JSON.stringify(body.meta).length > 4000) {
      throw errors.badRequest('meta is too large (max 4 KB).');
    }
  }

  const { record, size } = await createRecord(kv, project.id, body, {
    actor: principal.kind,
    maxBytes: project.settings.maxRecordBytes || LIMITS.RECORD_MAX_BYTES,
  });

  await addActivity(kv, {
    action: 'data.create',
    projectId: project.id,
    projectName: project.name,
    scope: principal.scope,
    message: `${record.type.toUpperCase()} record "${record.key || record.id}" received`,
  });

  return {
    record: principal.scope === 'user'
      ? { id: record.id, key: record.key, type: record.type, createdAt: record.createdAt }
      : record,
    size,
  };
}

async function dataList(ctx) {
  const { kv, query, principal } = ctx;
  const projectId = projectIdFor(ctx);
  assertProjectAccess(principal, projectId);
  if (principal.scope === 'user') throw errors.forbidden('User credentials cannot list records.');

  return listRecords(kv, projectId, {
    search: query.q || '',
    type: query.type || '',
    kind: query.kind || '',
    sort: query.sort || 'newest',
    limit: intParam(query.limit, 25, { max: 200 }),
    offset: intParam(query.offset, 0, { min: 0, max: 100000 }),
  });
}

async function dataGet(ctx) {
  const { kv, params, principal } = ctx;
  const projectId = projectIdFor(ctx);
  assertProjectAccess(principal, projectId);
  if (principal.scope === 'user') throw errors.forbidden('User credentials cannot read records.');
  const record = await getRecord(kv, projectId, params.id);
  return { record };
}

async function dataUpdate(ctx) {
  const { request, kv, params, principal } = ctx;
  const projectId = projectIdFor(ctx);
  assertProjectAccess(principal, projectId);
  if (principal.scope === 'user') throw errors.forbidden('User credentials cannot update records.');
  const body = await readJson(request);
  const { record } = await updateRecord(kv, projectId, params.id, body);
  await addActivity(kv, {
    action: 'data.update',
    projectId,
    scope: principal.scope,
    message: `Record "${record.key || record.id}" updated`,
  });
  return { record };
}

async function dataDelete(ctx) {
  const { kv, params, principal } = ctx;
  const projectId = projectIdFor(ctx);
  assertProjectAccess(principal, projectId);
  if (principal.scope === 'user') throw errors.forbidden('User credentials cannot delete records.');
  const result = await deleteRecord(kv, projectId, params.id);
  await addActivity(kv, {
    action: 'data.delete',
    projectId,
    scope: principal.scope,
    message: `Record ${params.id} deleted`,
  });
  return result;
}

async function dataImport(ctx) {
  const { request, kv } = ctx;
  const body = await readJson(request, { maxBytes: 8 * 1024 * 1024 });
  const projectId = validateProjectId(body.projectId);
  const records = Array.isArray(body.records) ? body.records : [];
  const result = await importRecords(kv, projectId, records);
  await addActivity(kv, {
    action: 'data.import',
    projectId,
    message: `Imported ${result.imported} records`,
  });
  return result;
}

async function exportProject({ request, kv, query, url }) {
  const projectId = validateProjectId(query.projectId);
  const project = await kv.get(K.project(projectId), 'json');
  if (!project) throw errors.notFound('Project not found.');
  const records = await exportRecords(kv, projectId);
  const files = (await kv.get(K.filesIndex(projectId), 'json')) || [];
  return {
    exportedAt: new Date().toISOString(),
    project: publicProjectView(project),
    records,
    files: files.map((f) => ({
      ...f,
      downloadUrl: `${originOf(request) || originFromUrl(url)}/api/files/${f.id}?projectId=${projectId}`,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Handlers - files                                                   */
/* ------------------------------------------------------------------ */

async function fileUpload(ctx) {
  const { request, kv, blob, principal } = ctx;
  const { project } = await loadScopedProject(ctx);

  const rl = await rateLimit(kv, {
    scope: `files_${project.id}`,
    id: principal.kind === 'user-token' ? `${principal.label}_${ctx.ip}` : 'admin',
    limit: principal.scope === 'user' ? Math.max(5, Math.floor((project.settings.userWritesPerMinute || 60) / 3)) : 200,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    throw new ApiError(429, 'rate_limited', 'Too many uploads. Try again shortly.', { retryAfter: rl.retryAfter });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    throw errors.unsupported('Upload files as multipart/form-data with a "file" field.');
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw errors.badRequest('Missing "file" field.');

  const meta = await uploadFile(kv, blob, project.id, {
    name: form.get('name') || file.name || 'upload.bin',
    type: file.type || 'application/octet-stream',
    bytes: await file.arrayBuffer(),
    uploadedBy: principal.kind,
    note: form.get('note') || '',
  });

  await addActivity(kv, {
    action: 'files.upload',
    projectId: project.id,
    projectName: project.name,
    scope: principal.scope,
    message: `Uploaded "${meta.name}" (${meta.size} bytes)`,
  });

  return principal.scope === 'user'
    ? { file: { id: meta.id, name: meta.name, size: meta.size, uploadedAt: meta.uploadedAt } }
    : { file: meta };
}

async function filesList(ctx) {
  const { kv, query, principal } = ctx;
  const projectId = projectIdFor(ctx);
  assertProjectAccess(principal, projectId);
  if (principal.scope === 'user') throw errors.forbidden('User credentials cannot list files.');
  return listFiles(kv, projectId, {
    search: query.q || '',
    type: query.type || '',
    limit: intParam(query.limit, 25, { max: 200 }),
    offset: intParam(query.offset, 0, { min: 0, max: 100000 }),
  });
}

async function fileDownload(ctx) {
  const { kv, blob, params, principal, query, request } = ctx;
  const projectId = projectIdFor(ctx);
  assertProjectAccess(principal, projectId);
  if (principal.scope === 'user') throw errors.forbidden('User credentials cannot download files.');

  const { meta, bytes } = await downloadFile(kv, blob, projectId, params.id);

  const inlineSafe =
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'video/mp4', 'video/webm']
      .includes(meta.type);

  const disposition =
    query.inline === '1' && inlineSafe
      ? `inline; filename="${encodeURIComponent(meta.name)}"`
      : `attachment; filename="${encodeURIComponent(meta.name)}"`;

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': meta.type || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength ?? bytes.length ?? 0),
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
      Vary: 'Origin',
    },
  });
}

async function fileDelete(ctx) {
  const { kv, blob, params, principal } = ctx;
  const projectId = projectIdFor(ctx);
  assertProjectAccess(principal, projectId);
  if (principal.scope === 'user') throw errors.forbidden('User credentials cannot delete files.');
  const result = await deleteFile(kv, blob, projectId, params.id);
  await addActivity(kv, {
    action: 'files.delete',
    projectId,
    scope: principal.scope,
    message: `File ${params.id} deleted`,
  });
  return result;
}

async function fileTicket(ctx) {
  const { request, blob, principal } = ctx;
  const { project } = await loadScopedProject(ctx);
  if (principal.scope === 'user') throw errors.forbidden('Direct upload tickets are admin-only.');
  const body = await readJson(request);
  // Optional flow - only works when the Blob SDK exposes createUploadUrl.
  const ticket = await createUploadTicket(blob, project.id, body);
  if (!ticket) {
    return { supported: false, hint: 'This runtime does not expose createUploadUrl. Use multipart POST /api/files.' };
  }
  return { supported: true, ...ticket };
}

async function fileConfirm(ctx) {
  const { request, kv, blob, principal } = ctx;
  const { project } = await loadScopedProject(ctx);
  if (principal.scope === 'user') throw errors.forbidden('Direct upload confirmation is admin-only.');
  const body = await readJson(request);
  const meta = await confirmUpload(kv, blob, project.id, { ...body, uploadedBy: principal.kind });
  return { file: meta };
}

/* ------------------------------------------------------------------ */
/* Handlers - settings + maintenance                                  */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  siteName: 'Storage Server',
  timezone: 'Asia/Kolkata',
  defaultRecordLimit: LIMITS.RECORD_MAX_BYTES,
  defaultUploadMaxMb: 20,
  allowUserApiByDefault: true,
  activityRetentionDays: 90,
};

async function settingsGet({ kv }) {
  const stored = (await kv.get(K.settings(), 'json')) || {};
  return {
    settings: { ...DEFAULT_SETTINGS, ...stored },
    storage: {
      kvNamespace: 'STORAGE_KV',
      blobStore: 'storage-server',
      maxProjects: LIMITS.MAX_PROJECTS,
      recordMaxBytes: LIMITS.RECORD_MAX_BYTES,
      fileMaxBytes: LIMITS.FILE_MAX_BYTES,
    },
  };
}

async function settingsPut({ request, kv }) {
  const body = await readJson(request);
  const stored = (await kv.get(K.settings(), 'json')) || {};
  const next = { ...DEFAULT_SETTINGS, ...stored };
  if (typeof body.siteName === 'string') next.siteName = body.siteName.slice(0, 60);
  if (typeof body.timezone === 'string') next.timezone = body.timezone.slice(0, 60);
  if (Number.isFinite(body.defaultUploadMaxMb)) {
    next.defaultUploadMaxMb = Math.min(20, Math.max(1, body.defaultUploadMaxMb));
  }
  if (typeof body.allowUserApiByDefault === 'boolean') next.allowUserApiByDefault = body.allowUserApiByDefault;
  await kv.put(K.settings(), JSON.stringify(next));
  await addActivity(kv, { action: 'settings.update', message: 'Server settings updated' });
  return { settings: next };
}

async function orphansList({ kv }) {
  const orphans = await findOrphanedData(kv);
  return { orphans };
}

async function orphansPurge({ request, kv, blob }) {
  const body = await readJson(request);
  const projectId = validateProjectId(body.projectId);
  const result = await purgeOrphanedData(kv, blob, projectId);
  await addActivity(kv, { action: 'maintenance.purge', projectId, message: `Purged orphaned data for ${projectId}` });
  return result;
}

async function recount({ request, kv }) {
  const body = await readJson(request);
  const projectId = validateProjectId(body.projectId);
  const usage = await recountUsage(kv, projectId);
  return { projectId, usage };
}

/* ------------------------------------------------------------------ */
/* Utils                                                              */
/* ------------------------------------------------------------------ */

function originOf(request) {
  try {
    const url = new URL(request.url);
    const forwardedHost = request.headers.get('x-forwarded-host');
    const host = forwardedHost || request.headers.get('host') || url.host;
    const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '') || 'https';
    return `${proto}://${host}`;
  } catch {
    return '';
  }
}

function originFromUrl(url) {
  return `${url.protocol}//${url.host}`;
}

export { DEFAULT_SETTINGS };
