/**
 * Project manager.
 *
 * Owns everything about projects:
 *   - creation (max 2), naming, status, deletion
 *   - per-project connection configs (user + admin)
 *   - per-project KV / Blob namespaces (via key prefixes + blob folder)
 *   - project-scoped settings (CORS allowlist, upload policy, record limits)
 *
 * All data lives in KV under `ss_*` keys. There is no external database.
 */

import {
  LIMITS,
  K,
  BLOB,
  ValidationError,
  createUserToken,
  generateAdminSecret,
  generateProjectId,
  generateUserToken,
  hmacSign,
  nowIso,
  sanitizeKey,
  validateProjectId,
  validateProjectName,
} from './core.js';

const DEFAULT_PROJECT_SETTINGS = {
  corsOrigins: [],             // extra allowed origins for the user endpoint
  allowUserApi: true,          // master switch for the restricted write API
  maxRecordBytes: 512 * 1024,  // per project record cap (<= RECORD_MAX_BYTES)
  userWritesPerMinute: LIMITS.RATE_LIMIT_USER_PER_MIN,
  retentionDays: 0,            // 0 = keep forever
  requireJsonForUser: false,   // user API may only create `json` records
};

export function freshProjectSettings(overrides = {}) {
  return { ...DEFAULT_PROJECT_SETTINGS, ...overrides };
}

/* ------------------------------------------------------------------ */
/* Index helpers                                                      */
/* ------------------------------------------------------------------ */

async function getProjectsIndex(kv) {
  const raw = await kv.get(K.projectsIndex(), 'json');
  return Array.isArray(raw) ? raw : [];
}

async function putProjectsIndex(kv, ids) {
  await kv.put(K.projectsIndex(), JSON.stringify(ids));
}

export async function listProjects(kv) {
  const ids = await getProjectsIndex(kv);
  const out = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const project = await kv.get(K.project(id), 'json');
    if (project) out.push(project);
  }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getProject(kv, projectId) {
  const id = validateProjectId(projectId);
  const project = await kv.get(K.project(id), 'json');
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404, code: 'not_found' });
  return project;
}

export async function projectExists(kv, projectId) {
  try {
    const p = await kv.get(K.project(projectId), 'json');
    return Boolean(p);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Creation                                                           */
/* ------------------------------------------------------------------ */

/**
 * Creates a project plus both connection configs.
 * The returned `credentials` object contains the *plaintext* tokens and is the
 * only time they can be shown in full (only the admin secret is kept in KV so
 * the dashboard can reveal it again after an admin login).
 */
export async function createProject(kv, { name, description = '', createdBy = 'admin', settings = {} }) {
  const projectName = validateProjectName(name);
  const index = await getProjectsIndex(kv);
  if (index.length >= LIMITS.MAX_PROJECTS) {
    throw Object.assign(
      new Error(`Project limit reached (${LIMITS.MAX_PROJECTS}). Delete a project before creating a new one.`),
      { status: 409, code: 'project_limit' },
    );
  }

  const id = generateProjectId();
  const now = nowIso();
  const rotationId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const userTokenSecret = generateUserToken();
  const adminSecret = generateAdminSecret();
  const signingSecret = await hmacSign(userTokenSecret, `signing:${id}`);

  const { token: userToken } = await createUserToken({
    projectId: id,
    rotationId,
    signingSecret,
    issuedAt: Date.now(),
  });

  const project = {
    id,
    name: projectName,
    description: String(description || '').slice(0, 200),
    status: 'active',                 // active | paused
    createdAt: now,
    updatedAt: now,
    createdBy,
    namespace: `kv_${id}`,            // logical namespace label (keys are prefixed)
    blobFolder: id,                   // blob prefix: <projectId>/files/...
    usage: { records: 0, files: 0, kvBytes: 0, blobBytes: 0 },
    settings: freshProjectSettings(settings),
    // --- connection configs -------------------------------------------
    config: {
      user: {
        token: userToken,
        signingSecret,
        rotationId,
        keyId: `pk_live_${rotationId}`,
        capabilities: ['data.send', 'files.send', 'meta.read'],
        createdAt: now,
      },
      admin: {
        secret: adminSecret,
        rotationId,
        createdAt: now,
        capabilities: [
          'data.receive', 'data.read', 'data.store', 'data.update', 'data.delete',
          'files.upload', 'files.download', 'files.delete',
          'project.manage',
        ],
      },
    },
  };

  await kv.put(K.project(id), JSON.stringify(project));
  await putProjectsIndex(kv, [...index, id]);
  await kv.put(K.recordsIndex(id), JSON.stringify([]));
  await kv.put(K.filesIndex(id), JSON.stringify([]));

  return { project, credentials: { userToken, adminSecret } };
}

export async function updateProject(kv, projectId, patch = {}) {
  const project = await getProject(kv, projectId);
  if (patch.name != null) project.name = validateProjectName(patch.name);
  if (patch.description != null) project.description = String(patch.description).slice(0, 200);
  if (patch.status != null) {
    if (!['active', 'paused'].includes(patch.status)) {
      throw new ValidationError('status', 'Status must be "active" or "paused".');
    }
    project.status = patch.status;
  }
  if (patch.settings && typeof patch.settings === 'object') {
    const s = patch.settings;
    const next = { ...project.settings };
    if (Array.isArray(s.corsOrigins)) {
      next.corsOrigins = s.corsOrigins
        .map((o) => String(o).trim())
        .filter((o) => /^https?:\/\/[^\s]+$/i.test(o))
        .slice(0, 10);
    }
    if (typeof s.allowUserApi === 'boolean') next.allowUserApi = s.allowUserApi;
    if (Number.isFinite(s.maxRecordBytes)) {
      next.maxRecordBytes = Math.min(LIMITS.RECORD_MAX_BYTES, Math.max(1024, Number(s.maxRecordBytes)));
    }
    if (Number.isFinite(s.userWritesPerMinute)) {
      next.userWritesPerMinute = Math.min(600, Math.max(1, Number(s.userWritesPerMinute)));
    }
    if (Number.isFinite(s.retentionDays)) {
      next.retentionDays = Math.min(3650, Math.max(0, Number(s.retentionDays)));
    }
    if (typeof s.requireJsonForUser === 'boolean') next.requireJsonForUser = s.requireJsonForUser;
    project.settings = next;
  }
  project.updatedAt = nowIso();
  await kv.put(K.project(project.id), JSON.stringify(project));
  return project;
}

/**
 * Rotates credentials.
 * kind = 'user' | 'admin' | 'both'
 */
export async function rotateCredentials(kv, projectId, kind = 'user') {
  const project = await getProject(kv, projectId);
  const rotationId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const result = { userToken: null, adminSecret: null };

  if (kind === 'user' || kind === 'both') {
    const userTokenSecret = generateUserToken();
    const signingSecret = await hmacSign(userTokenSecret, `signing:${project.id}`);
    const { token } = await createUserToken({
      projectId: project.id,
      rotationId,
      signingSecret,
      issuedAt: Date.now(),
    });
    project.config.user = {
      ...project.config.user,
      token,
      signingSecret,
      rotationId,
      keyId: `pk_live_${rotationId}`,
      createdAt: nowIso(),
    };
    result.userToken = token;
  }

  if (kind === 'admin' || kind === 'both') {
    const adminSecret = generateAdminSecret();
    project.config.admin = {
      ...project.config.admin,
      secret: adminSecret,
      rotationId,
      createdAt: nowIso(),
    };
    result.adminSecret = adminSecret;
  }

  project.updatedAt = nowIso();
  await kv.put(K.project(project.id), JSON.stringify(project));
  return { project, credentials: result };
}

/**
 * Deletes a project.
 *   purgeData = false -> project shell removed, KV records / Blob files kept
 *                        (they become orphaned and are listed under "orphaned data")
 *   purgeData = true  -> every KV key and Blob object for the project is removed
 * Both require `confirmName` to equal the project name (typed confirmation).
 */
export async function deleteProject(kv, blob, projectId, { purgeData = true, confirmName = '' } = {}) {
  const project = await getProject(kv, projectId);
  if (String(confirmName).trim() !== project.name) {
    throw Object.assign(new Error('Confirmation name does not match the project name.'), {
      status: 422,
      code: 'confirm_mismatch',
    });
  }

  let purged = { records: 0, files: 0, keys: 0 };

  if (purgeData) {
    // KV records
    const recordIds = (await kv.get(K.recordsIndex(project.id), 'json')) || [];
    for (const rid of recordIds) {
      // eslint-disable-next-line no-await-in-loop
      await kv.delete(K.record(project.id, rid));
      purged.keys += 1;
    }
    // KV file metadata
    const fileMetas = (await kv.get(K.filesIndex(project.id), 'json')) || [];
    for (const f of fileMetas) {
      // eslint-disable-next-line no-await-in-loop
      await kv.delete(K.fileMeta(project.id, f.id));
      purged.keys += 1;
      // eslint-disable-next-line no-await-in-loop
      await blob.delete(BLOB.fileKey(project.id, f.id, f.ext));
      purged.files += 1;
    }
    purged.records = recordIds.length;
    await kv.delete(K.recordsIndex(project.id));
    await kv.delete(K.filesIndex(project.id));
    purged.keys += 2;
  }

  await kv.delete(K.project(project.id));
  const index = await getProjectsIndex(kv);
  await putProjectsIndex(kv, index.filter((id) => id !== project.id));

  return { deleted: project.id, purged };
}

/* ------------------------------------------------------------------ */
/* Public metadata (used by external projects)                        */
/* ------------------------------------------------------------------ */

export function publicProjectView(project) {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    usage: project.usage,
    settings: {
      allowUserApi: project.settings.allowUserApi,
      maxRecordBytes: project.settings.maxRecordBytes,
      userWritesPerMinute: project.settings.userWritesPerMinute,
      requireJsonForUser: project.settings.requireJsonForUser,
    },
  };
}

/** Config payload shown in the dashboard + returned by GET /api/config/:projectId */
export function buildConnectionConfig(project, origin = '') {
  const base = String(origin || '').replace(/\/$/, '');
  const userCfg = {
    scope: 'user',
    label: 'User Panel Config',
    projectId: project.id,
    apiBase: `${base}/api`,
    writeUrl: `${base}/api/data`,
    filesUrl: `${base}/api/files`,
    readUrl: null,
    token: project.config.user.token,
    header: 'Authorization: Bearer <userToken>',
    keyId: project.config.user.keyId,
    capabilities: ['data.send', 'files.send', 'meta.read'],
    restrictions: [
      'Cannot read existing records',
      'Cannot update existing records',
      'Cannot delete records',
      'Cannot download or list files',
      'Cannot perform admin operations',
    ],
    limits: {
      maxRecordBytes: project.settings.maxRecordBytes,
      writesPerMinute: project.settings.userWritesPerMinute,
      maxFileBytes: LIMITS.FILE_MAX_BYTES,
    },
    sampleCurl: `curl -X POST ${base}/api/data \\
  -H "Authorization: Bearer ${project.config.user.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"json","kind":"contact","key":"contact-form","content":{"name":"Aarav","email":"aarav@example.com"}}'`,
    sampleFetch: `await fetch("${base}/api/data", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${project.config.user.token}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    type: "json",
    kind: "contact",
    key: "contact-form",
    content: { name: "Aarav", email: "aarav@example.com" }
  })
});`,
  };

  const adminCfg = {
    scope: 'admin',
    label: 'Admin Panel Config',
    projectId: project.id,
    apiBase: `${base}/api`,
    readUrl: `${base}/api/data?projectId=${project.id}`,
    token: project.config.admin.secret,
    header: 'Authorization: Bearer <adminSecret>',
    keyId: `ak_live_${project.config.admin.rotationId}`,
    capabilities: project.config.admin.capabilities,
    warning: 'Admin secret grants full data access. Keep it server-side only. Never ship it to a browser or a public repo.',
    sampleCurl: `curl -H "Authorization: Bearer ${project.config.admin.secret}" \\
  "${base}/api/data?projectId=${project.id}"`,
    sampleFetch: `await fetch("${base}/api/data?projectId=${project.id}", {
  headers: { "Authorization": "Bearer ${project.config.admin.secret}" }
});`,
  };

  return {
    projectId: project.id,
    generatedAt: nowIso(),
    user: userCfg,
    admin: adminCfg,
  };
}

/** env snippet for an external project's .env */
export function buildEnvSnippet(project, origin = '') {
  return `# ${project.name}  (project id: ${project.id})
STORAGE_API_BASE=${String(origin || '').replace(/\/$/, '')}
STORAGE_PROJECT_ID=${project.id}
# Public frontend (write-only, safe to ship)
STORAGE_USER_TOKEN=${project.config.user.token}
# Server-side only. Never expose in browser code.
STORAGE_ADMIN_SECRET=${project.config.admin.secret}
`;
}

/* ------------------------------------------------------------------ */
/* Orphaned data (for purge-after-delete)                             */
/* ------------------------------------------------------------------ */

export async function findOrphanedData(kv) {
  const liveIds = new Set(await getProjectsIndex(kv));
  const keys = await kv.listAll('ss_record_prj_');
  const fileKeys = await kv.listAll('ss_file_prj_');
  const recordIndexes = await kv.listAll('ss_records_prj_');
  const fileIndexes = await kv.listAll('ss_files_prj_');
  const projects = await kv.listAll('ss_project_prj_');

  const orphanPrefixes = new Set();
  for (const key of [...recordIndexes, ...fileIndexes, ...projects]) {
    const id = key.replace(/^ss_(records|files|project)_/, '');
    if (!liveIds.has(id)) orphanPrefixes.add(id);
  }
  for (const key of [...keys, ...fileKeys]) {
    const m = key.match(/^ss_(?:record|file)_(prj_[a-z0-9]+)_/);
    if (m && !liveIds.has(m[1])) orphanPrefixes.add(m[1]);
  }

  const summary = [];
  for (const id of orphanPrefixes) {
    summary.push({
      projectId: id,
      records: keys.filter((k) => k.startsWith(K.record(id, ''))).length,
      files: fileKeys.filter((k) => k.startsWith(K.fileMeta(id, ''))).length,
    });
  }
  return summary;
}

export async function purgeOrphanedData(kv, blob, projectId) {
  const id = sanitizeKey(projectId);
  if (!/^prj_[a-z0-9]{6,24}$/.test(id)) throw new ValidationError('projectId', 'Invalid project id.');
  const keys = [
    ...(await kv.listAll(`ss_record_${id}_`)),
    ...(await kv.listAll(`ss_file_${id}_`)),
    K.recordsIndex(id),
    K.filesIndex(id),
    K.project(id),
  ];
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    await kv.delete(key);
  }
  for (const key of await blob.list(`${id}/files/`)) {
    // eslint-disable-next-line no-await-in-loop
    await blob.delete(key);
  }
  return { projectId: id, deletedKeys: keys.length };
}
