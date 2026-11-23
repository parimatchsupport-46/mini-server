/**
 * Permission manager.
 *
 * Three principals can talk to the API:
 *
 *   1. admin  - the dashboard owner. Credentials: admin access token
 *               (issued by POST /api/auth/login) or an admin-setup key.
 *               Full read/write across every project.
 *
 *   2. admin-secret - a per-project secret handed to an external project's
 *               server-side code. Scoped to that one project. Cannot create
 *               or delete projects, cannot manage users, cannot read other
 *               projects.
 *
 *   3. user   - a per-project *publishable* credential for a public frontend.
 *               Write-only: create records + upload files + read its own
 *               project metadata. Can never read, update, delete or list.
 *
 * Every request must also resolve a project and prove ownership of it.
 */

import { errors } from './http.js';
import { verifyUserToken } from './core.js';

export const POLICY = Object.freeze({
  admin: new Set([
    'data.read', 'data.create', 'data.update', 'data.delete',
    'files.read', 'files.upload', 'files.delete',
    'project.read', 'project.create', 'project.update', 'project.delete',
    'config.read', 'config.rotate',
    'settings.read', 'settings.write',
    'activity.read', 'stats.read',
  ]),
  projectAdmin: new Set([
    'data.read', 'data.create', 'data.update', 'data.delete',
    'files.read', 'files.upload', 'files.delete',
    'project.read', 'config.read',
    'stats.read',
  ]),
  // The whole point of the user credential: writes only.
  user: new Set(['data.create', 'files.upload', 'project.read', 'config.read', 'stats.read']),
});

export const SCOPE_RANK = { admin: 3, projectAdmin: 2, user: 1 };

function bearerToken(request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  // Allow ?token= for curl/quick tests, but prefer headers.
  const url = new URL(request.url);
  return url.searchParams.get('token') || '';
}

/**
 * Resolves the caller into { scope, projectId, label }.
 * `services` = { kv, sessions, adminKey } supplied by the function entrypoint.
 */
export async function authenticate(request, services) {
  const { kv, sessions = {}, getProjectIdFromRequest } = services;
  const token = bearerToken(request);
  if (!token) throw errors.unauthorized('Missing Authorization: Bearer <token>.');

  // 1) Dashboard admin session
  const adminToken = sessions.adminToken;
  if (adminToken && token === adminToken) {
    return { scope: 'admin', kind: 'admin', projectId: null, label: 'dashboard-admin' };
  }

  // 2) Admin APIs also accept the setup key (for curl / CI / first-run bootstrap)
  const setupKey = services.setupKey;
  if (setupKey && token === setupKey) {
    return { scope: 'admin', kind: 'setup', projectId: null, label: 'setup-key' };
  }

  // 3) User-panel capability token (HMAC signed, embeds project id)
  if (token.startsWith('etu1.')) {
    const projectId = getProjectIdFromRequest ? getProjectIdFromRequest() : null;
    // The signing secret is per project, so try the requested project first and
    // then every other project. This lets us identify which project a token
    // actually belongs to and answer with a proper 403 (not a vague 401) when
    // someone points another project's token at this project's data.
    const candidates = await candidateProjects(kv, projectId);
    for (const pid of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const project = await kv.get(`ss_project_${pid}`, 'json');
      if (!project) continue;
      // eslint-disable-next-line no-await-in-loop
      const result = await verifyUserToken(token, project.config.user.signingSecret);
      if (result.ok && result.payload.pid === pid) {
        if (project.status !== 'active') throw errors.forbidden('Project is paused.');
        if (!project.settings.allowUserApi) throw errors.forbidden('User API is disabled for this project.');
        if (result.payload.rid !== project.config.user.rotationId) {
          throw errors.forbidden('This user credential has been rotated. Update the client config.');
        }
        return { scope: 'user', kind: 'user-token', projectId: pid, label: project.config.user.keyId };
      }
    }
    throw errors.unauthorized('Invalid user credential.');
  }

  // 4) Per-project admin secret (external project server code)
  if (token.startsWith('adm_')) {
    const projectId = getProjectIdFromRequest ? getProjectIdFromRequest() : null;
    const candidates = await candidateProjects(kv, projectId);
    for (const pid of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const project = await kv.get(`ss_project_${pid}`, 'json');
      if (!project) continue;
      if (project.config.admin.secret === token) {
        if (project.status !== 'active') throw errors.forbidden('Project is paused.');
        return { scope: 'projectAdmin', kind: 'admin-secret', projectId: pid, label: `ak_live_${project.config.admin.rotationId}` };
      }
    }
    throw errors.unauthorized('Invalid project admin secret.');
  }

  throw errors.unauthorized('Unrecognised credential.');
}

/** Requested project first, then the rest - lets us resolve a token's owner. */
async function candidateProjects(kv, requestedId) {
  const all = await allProjectIds(kv);
  if (!requestedId) return all;
  return [requestedId, ...all.filter((id) => id !== requestedId)];
}

async function allProjectIds(kv) {
  const raw = await kv.get('ss_projects_index_v1', 'json');
  return Array.isArray(raw) ? raw : [];
}

export function can(principal, action) {
  const set = POLICY[principal?.scope];
  return Boolean(set && set.has(action));
}

export function assert(principal, action) {
  if (!can(principal, action)) {
    throw errors.forbidden(`"${principal?.scope || 'anonymous'}" is not allowed to perform "${action}".`);
  }
}

/**
 * Verifies that the authenticated principal may act on `projectId`.
 * - admin: any project
 * - projectAdmin / user: only their own project
 */
export function assertProjectAccess(principal, projectId) {
  if (!principal) throw errors.unauthorized();
  if (principal.scope === 'admin') return;
  if (!principal.projectId) throw errors.forbidden('Credential is not bound to a project.');
  if (principal.projectId !== projectId) {
    throw errors.forbidden('This credential cannot access another project.');
  }
}

/** Resolves and validates a project id from the request, then checks access. */
export async function resolveProject(request, principal, kv) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('projectId');
  const fromHeader = request.headers.get('x-project-id');
  const fromToken = principal?.projectId || null;
  const projectId = fromQuery || fromHeader || fromToken;

  if (!projectId) throw errors.badRequest('Missing projectId (query, header or credential).');
  if (!/^prj_[a-z0-9]{6,24}$/.test(projectId)) throw errors.badRequest('Invalid projectId format.');
  assertProjectAccess(principal, projectId);

  const project = await kv.get(`ss_project_${projectId}`, 'json');
  if (!project) throw errors.notFound('Project not found.');
  return project;
}
