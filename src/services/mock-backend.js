/**
 * In-browser mock backend for the static preview.
 *
 * It mirrors the real API contracts (server/app.js) closely enough that every
 * dashboard screen is fully usable while the project is running under plain
 * Vite — no EdgeOne binding required. Data persists in localStorage.
 *
 * This file is only loaded in preview mode and never on the deployed site.
 */

import {
  LIMITS,
  buildConnectionConfig,
  createUserToken,
  generateAdminSecret,
  generateProjectId,
  generateRecordId,
  generateFileId,
  generateUserToken,
  generateActivityId,
  hmacSign,
  isUploadAllowed,
  nowIso,
  recordSizeBytes,
  buildRecord,
  validateProjectName,
  freshness,
} from './mock-helpers.js';

const NS = 'ss.preview.v1';
const ADMIN_EMAIL = 'owner@storage.local';
const ADMIN_PASSWORD = 'preview-admin-123';
const SESSION_TTL_MS = 12 * 3600 * 1000;

export function createMockBackend({ getToken, storage }) {
  const store = createStore(storage);
  seedIfNeeded();

  /* ----------------------------- storage ---------------------------- */
  function createStore(driver) {
    const cache = new Map();
    function read(key, fallback) {
      if (cache.has(key)) return cache.get(key);
      const raw = driver.get(`${NS}:${key}`);
      let value = fallback;
      if (raw != null) {
        try {
          value = JSON.parse(raw);
        } catch {
          value = fallback;
        }
      }
      cache.set(key, value);
      return value;
    }
    function write(key, value) {
      cache.set(key, value);
      try {
        driver.set(`${NS}:${key}`, JSON.stringify(value));
      } catch {
        /* quota */
      }
      return value;
    }
    function remove(key) {
      cache.delete(key);
      driver.remove(`${NS}:${key}`);
    }
    return { read, write, remove };
  }

  /* ------------------------------ seed ------------------------------ */
  function seedIfNeeded() {
    if (store.read('meta', null)) return;
    store.write('meta', { createdAt: nowIso(), version: 1, initialised: true });
    store.write('admin', {
      email: ADMIN_EMAIL,
      passwordHash: 'preview',
      createdAt: nowIso(),
    });
    store.write('sessions', []);
    store.write('projects', []);
    store.write('records', {});
    store.write('files', {});
    store.write('activity', []);
    store.write('settings', {
      siteName: 'Storage Server',
      timezone: 'Asia/Kolkata',
      defaultUploadMaxMb: 20,
      allowUserApiByDefault: true,
      activityRetentionDays: 90,
    });
    seedDemoContent();
  }

  async function seedDemoContent() {
    const a = await createProjectInternal({ name: 'My Support Website', description: 'Contact forms, FAQ snippets and help-centre JSON for the public site.' });
    const b = await createProjectInternal({ name: 'My Second Website', description: 'Landing page content, media library and changelog notes.' });
    store.write('demoCredentials', {
      [a.id]: a.credentials,
      [b.id]: b.credentials,
    });

    await createRecordInternal(a.id, {
      type: 'json',
      kind: 'contact',
      key: 'contact-form',
      tags: ['form', 'lead'],
      content: {
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
        subject: 'Billing question',
        message: 'Hi, I upgraded to the annual plan but my invoice still shows monthly. Could you check?',
        page: '/pricing',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2)',
      },
      createdAt: offsetIso(3, 'hours'),
    });
    await createRecordInternal(a.id, {
      type: 'json',
      kind: 'feedback',
      key: 'nps-survey',
      tags: ['survey'],
      content: { score: 9, comment: 'Fast support, would recommend.', plan: 'pro' },
      createdAt: offsetIso(1, 'days'),
    });
    await createRecordInternal(a.id, {
      type: 'txt',
      kind: 'note',
      key: 'faq-answer-1',
      tags: ['faq'],
      content: 'You can reset your password from Settings → Security → Reset password. A reset link is valid for 30 minutes.',
      createdAt: offsetIso(2, 'days'),
    });
    await createRecordInternal(a.id, {
      type: 'json',
      kind: 'config',
      key: 'site-banner',
      tags: ['config', 'frontend'],
      content: { enabled: true, text: 'Diwali sale — 30% off annual plans', link: '/pricing', dismissible: true },
      createdAt: offsetIso(4, 'days'),
    });
    await createRecordInternal(a.id, {
      type: 'json',
      kind: 'contact',
      key: 'contact-form',
      tags: ['form', 'lead'],
      content: {
        name: 'Meera Iyer',
        email: 'meera@example.com',
        subject: 'API limits',
        message: 'What is the rate limit on the write endpoint for my forms?',
        page: '/docs/api',
      },
      createdAt: offsetIso(5, 'hours'),
    });

    await createRecordInternal(b.id, {
      type: 'json',
      kind: 'config',
      key: 'hero-copy',
      tags: ['content'],
      content: {
        headline: 'Ship your side project this weekend',
        subhead: 'Templates, deploy pipeline and analytics in one place.',
        cta: { label: 'Start free', href: '/signup' },
      },
      createdAt: offsetIso(6, 'days'),
    });
    await createRecordInternal(b.id, {
      type: 'txt',
      kind: 'note',
      key: 'changelog',
      tags: ['release'],
      content: 'v1.4.0 — Added dark mode, fixed mobile nav overlap, 18% faster cold start.',
      createdAt: offsetIso(2, 'days'),
    });

    seedFile(a.id, { name: 'brand-hero.png', type: 'image/png', size: 184320, createdAt: offsetIso(1, 'days') });
    seedFile(a.id, { name: 'support-playbook.pdf', type: 'application/pdf', size: 962560, createdAt: offsetIso(3, 'days') });
    seedFile(a.id, { name: 'tone-of-voice.txt', type: 'text/plain', size: 4210, createdAt: offsetIso(4, 'hours') });
    seedFile(b.id, { name: 'launch-banner.webp', type: 'image/webp', size: 412000, createdAt: offsetIso(5, 'days') });

    pushActivity(a.id, a.name, 'project.create', `Project "${a.name}" created`);
    pushActivity(a.id, a.name, 'data.create', 'JSON record "contact-form" received');
    pushActivity(b.id, b.name, 'project.create', `Project "${b.name}" created`);
    pushActivity(b.id, b.name, 'files.upload', 'Uploaded "launch-banner.webp" (402 KB)');
  }

  /* --------------------------- auth -------------------------------- */
  function sessions() {
    return store.read('sessions', []);
  }

  function issueSession() {
    const token = `das_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const list = sessions().filter((s) => s.expiresAt > Date.now());
    list.push({ token, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
    store.write('sessions', list);
    return token;
  }

  function requireAdmin(token) {
    if (!token) throw apiError(401, 'unauthorized', 'Please sign in to continue.');
    const found = sessions().find((s) => s.token === token && s.expiresAt > Date.now());
    if (!found) throw apiError(401, 'unauthorized', 'Session expired. Please sign in again.');
    return { email: store.read('admin', {}).email };
  }

  /* --------------------------- projects ---------------------------- */
  function projects() {
    return store.read('projects', []);
  }

  async function createProjectInternal({ name, description = '' }) {
    const list = projects();
    if (list.length >= LIMITS.MAX_PROJECTS) {
      throw apiError(409, 'project_limit', `Project limit reached (${LIMITS.MAX_PROJECTS}).`);
    }
    const clean = validateProjectName(name);
    const id = generateProjectId();
    const now = nowIso();
    const rotationId = Math.random().toString(36).slice(2, 14);
    const userSecret = generateUserToken();
    const signingSecret = await hmacSign(userSecret, `signing:${id}`);
    const { token } = await createUserToken({ projectId: id, rotationId, signingSecret });
    const adminSecret = generateAdminSecret();

    const project = {
      id,
      name: clean,
      description,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      namespace: `kv_${id}`,
      usage: { records: 0, files: 0, kvBytes: 0, blobBytes: 0 },
      settings: {
        corsOrigins: [],
        allowUserApi: true,
        maxRecordBytes: 512 * 1024,
        userWritesPerMinute: LIMITS.RATE_LIMIT_USER_PER_MIN,
        retentionDays: 0,
        requireJsonForUser: false,
      },
      config: {
        user: { token, signingSecret, rotationId, keyId: `pk_live_${rotationId}`, createdAt: now },
        admin: { secret: adminSecret, rotationId, createdAt: now },
      },
    };

    store.write('projects', [...list, project]);
    const records = store.read('records', {});
    records[id] = records[id] || [];
    store.write('records', records);
    const files = store.read('files', {});
    files[id] = files[id] || [];
    store.write('files', files);

    return { id, name: clean, credentials: { userToken: token, adminSecret } };
  }

  function publicProject(p) {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      usage: p.usage,
      settings: {
        allowUserApi: p.settings.allowUserApi,
        maxRecordBytes: p.settings.maxRecordBytes,
        userWritesPerMinute: p.settings.userWritesPerMinute,
        requireJsonForUser: p.settings.requireJsonForUser,
        corsOrigins: p.settings.corsOrigins,
      },
      keyId: p.config.user.keyId,
      adminKeyId: `ak_live_${p.config.admin.rotationId}`,
    };
  }

  function findProject(id) {
    const p = projects().find((x) => x.id === id);
    if (!p) throw apiError(404, 'not_found', 'Project not found.');
    return p;
  }

  function saveProject(updated) {
    store.write('projects', projects().map((p) => (p.id === updated.id ? updated : p)));
    return updated;
  }

  /* ---------------------------- records ---------------------------- */
  async function createRecordInternal(projectId, payload, { skipTouch = false } = {}) {
    const project = findProject(projectId);
    const records = store.read('records', {});
    const list = records[projectId] || [];
    const record = buildRecord({ ...payload, projectId, id: payload.id || generateRecordId() }, { actor: payload.source || 'admin' });
    if (payload.createdAt) record.createdAt = payload.createdAt;
    list.push(record);
    records[projectId] = list;
    store.write('records', records);
    if (!skipTouch) touchUsage(projectId);
    return record;
  }

  function seedFile(projectId, { name, type, size, createdAt }) {
    const files = store.read('files', {});
    const list = files[projectId] || [];
    const ext = String(name).split('.').pop().toLowerCase();
    list.push({
      id: generateFileId(),
      projectId,
      name,
      ext,
      type,
      size,
      key: `${projectId}/files/${name}`,
      uploadedAt: createdAt || nowIso(),
      uploadedBy: 'admin',
      note: '',
      downloads: Math.floor(Math.random() * 5),
      demo: true,
    });
    files[projectId] = list;
    store.write('files', files);
    touchUsage(projectId);
  }

  function touchUsage(projectId) {
    const project = findProject(projectId);
    const records = (store.read('records', {})[projectId] || []);
    const files = (store.read('files', {})[projectId] || []);
    project.usage = {
      records: records.length,
      files: files.length,
      kvBytes: records.reduce((s, r) => s + recordSizeBytes(r), 0),
      blobBytes: files.reduce((s, f) => s + (f.size || 0), 0),
    };
    saveProject(project);
  }

  function recordSummary(r) {
    let preview = String(r.content || '');
    if (r.type === 'json') {
      try {
        const obj = JSON.parse(preview);
        preview = Object.entries(obj)
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(' · ');
      } catch {
        /* keep raw */
      }
    }
    return {
      id: r.id,
      projectId: r.projectId,
      type: r.type,
      kind: r.kind,
      key: r.key,
      tags: r.tags,
      source: r.source,
      size: recordSizeBytes(r),
      preview: preview.slice(0, 100),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      version: r.version,
    };
  }

  /* --------------------------- activity ---------------------------- */
  function pushActivity(projectId, projectName, action, message, scope = 'admin') {
    const list = store.read('activity', []);
    list.unshift({
      id: generateActivityId(),
      at: nowIso(),
      action,
      projectId,
      projectName,
      scope,
      message,
    });
    store.write('activity', list.slice(0, 100));
  }

  /* ---------------------------- router ----------------------------- */
  async function handle(method, path, options = {}) {
    const url = new URL(path, location.origin);
    const segments = url.pathname.split('/').filter(Boolean);
    const query = Object.fromEntries(url.searchParams.entries());
    const token = options.noAuth ? '' : getToken();
    const body = options.body;

    await new Promise((r) => setTimeout(r, 90 + Math.random() * 140)); // realistic latency

    const route = (m, pattern) => {
      if (m !== method) return null;
      const parts = pattern.split('/').filter(Boolean);
      if (parts.length !== segments.length) return null;
      const params = {};
      for (let i = 0; i < parts.length; i += 1) {
        if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
        else if (parts[i] !== segments[i]) return null;
      }
      return params;
    };

    let params;

    /* --- health --- */
    if (route('GET', '/api/health')) {
      return {
        status: 'ok',
        runtime: 'preview',
        kvBackend: 'localStorage',
        blobBackend: 'localStorage',
        initialised: true,
        preview: true,
        limits: {
          maxProjects: LIMITS.MAX_PROJECTS,
          recordMaxBytes: LIMITS.RECORD_MAX_BYTES,
          fileMaxBytes: LIMITS.FILE_MAX_BYTES,
        },
        time: nowIso(),
      };
    }

    /* --- auth --- */
    if (route('GET', '/api/auth/status')) {
      return { initialised: true, email: store.read('admin', {}).email, setupKeyRequired: false, preview: true };
    }

    if ((params = route('POST', '/api/auth/login'))) {
      if (String(body?.password || '') !== ADMIN_PASSWORD && String(body?.password || '').length < 10) {
        throw apiError(401, 'bad_credentials', 'Invalid email or password.');
      }
      return {
        token: issueSession(),
        email: body?.email || ADMIN_EMAIL,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        preview: true,
        previewPassword: ADMIN_PASSWORD,
      };
    }

    if (route('POST', '/api/auth/setup')) {
      throw apiError(409, 'already_initialised', 'Preview server is already initialised. Sign in instead.');
    }

    if (route('POST', '/api/auth/logout')) return { ok: true };

    if (route('GET', '/api/auth/me')) {
      return requireAdmin(token);
    }

    /* --- everything below needs a session --- */
    if (segments[0] !== 'api') throw apiError(404, 'not_found', 'Not found.');

    if ((params = route('GET', '/api/projects'))) {
      requireAdmin(token);
      const list = projects();
      return {
        projects: list.map(publicProject),
        limit: LIMITS.MAX_PROJECTS,
        canCreate: list.length < LIMITS.MAX_PROJECTS,
      };
    }

    if ((params = route('POST', '/api/projects'))) {
      requireAdmin(token);
      const created = await createProjectInternal({
        name: body?.name,
        description: body?.description || '',
      });
      const project = findProject(created.id);
      pushActivity(project.id, project.name, 'project.create', `Project "${project.name}" created`);
      return {
        project: publicProject(project),
        credentials: created.credentials,
        connection: buildConnectionConfig(project, location.origin),
      };
    }

    if ((params = route('GET', '/api/projects/:id'))) {
      requireAdmin(token);
      const project = findProject(params.id);
      const records = store.read('records', {})[project.id] || [];
      const files = store.read('files', {})[project.id] || [];
      return {
        project: publicProject(project),
        connection: buildConnectionConfig(project, location.origin),
        counts: { records: records.length, files: files.length },
        activity: store.read('activity', []).filter((a) => a.projectId === project.id).slice(0, 12),
      };
    }

    if ((params = route('PATCH', '/api/projects/:id')) || (params = route('PUT', '/api/projects/:id'))) {
      requireAdmin(token);
      const project = findProject(params.id);
      if (body?.name != null) project.name = validateProjectName(body.name);
      if (body?.description != null) project.description = String(body.description).slice(0, 200);
      if (body?.status) project.status = body.status;
      if (body?.settings && typeof body.settings === 'object') {
        project.settings = { ...project.settings, ...body.settings };
      }
      project.updatedAt = nowIso();
      saveProject(project);
      pushActivity(project.id, project.name, 'project.update', `Project "${project.name}" updated`);
      return { project: publicProject(project) };
    }

    if ((params = route('DELETE', '/api/projects/:id'))) {
      requireAdmin(token);
      const project = findProject(params.id);
      if (String(body?.confirmName || '').trim() !== project.name) {
        throw apiError(422, 'confirm_mismatch', 'Type the project name exactly to confirm.');
      }
      if (body?.purgeData !== false) {
        const records = store.read('records', {});
        delete records[project.id];
        store.write('records', records);
        const files = store.read('files', {});
        delete files[project.id];
        store.write('files', files);
      }
      store.write('projects', projects().filter((p) => p.id !== project.id));
      pushActivity(null, '', 'project.delete', `Project "${project.name}" deleted`);
      return { deleted: project.id, purged: { records: 0, files: 0 } };
    }

    if ((params = route('POST', '/api/projects/:id/rotate'))) {
      requireAdmin(token);
      const project = findProject(params.id);
      const kind = body?.kind || 'user';
      const rotationId = Math.random().toString(36).slice(2, 14);
      const result = { userToken: null, adminSecret: null };
      if (kind === 'user' || kind === 'both') {
        const userSecret = generateUserToken();
        const signingSecret = await hmacSign(userSecret, `signing:${project.id}`);
        const { token: userToken } = await createUserToken({ projectId: project.id, rotationId, signingSecret });
        project.config.user = { token: userToken, signingSecret, rotationId, keyId: `pk_live_${rotationId}`, createdAt: nowIso() };
        result.userToken = userToken;
      }
      if (kind === 'admin' || kind === 'both') {
        const adminSecret = generateAdminSecret();
        project.config.admin = { secret: adminSecret, rotationId, createdAt: nowIso() };
        result.adminSecret = adminSecret;
      }
      project.updatedAt = nowIso();
      saveProject(project);
      pushActivity(project.id, project.name, 'project.rotate', `Rotated ${kind} credentials`);
      return { credentials: result, connection: buildConnectionConfig(project, location.origin) };
    }

    if ((params = route('GET', '/api/config/:projectId'))) {
      requireAdmin(token);
      const project = findProject(params.projectId);
      const files = store.read('files', {})[project.id] || [];
      return {
        mode: 'full',
        connection: buildConnectionConfig(project, location.origin),
        envSnippet: envSnippet(project),
        storage: {
          records: (store.read('records', {})[project.id] || []).length,
          files: files.length,
          blobBytes: files.reduce((s, f) => s + (f.size || 0), 0),
        },
        endpoints: [
          { method: 'POST', path: '/api/data', scope: 'user', desc: 'Create a TXT/JSON record' },
          { method: 'POST', path: '/api/files', scope: 'user', desc: 'Upload a file (multipart)' },
          { method: 'GET', path: `/api/data?projectId=${project.id}`, scope: 'admin', desc: 'List records' },
          { method: 'GET', path: `/api/files?projectId=${project.id}`, scope: 'admin', desc: 'List files' },
        ],
      };
    }

    /* --- stats --- */
    if (route('GET', '/api/stats')) {
      requireAdmin(token);
      const list = projects();
      const activity = store.read('activity', []).slice(0, 8);
      const totals = list.reduce(
        (acc, p) => {
          acc.records += p.usage.records;
          acc.files += p.usage.files;
          acc.kvBytes += p.usage.kvBytes;
          acc.blobBytes += p.usage.blobBytes;
          if (p.status === 'active') acc.active += 1;
          return acc;
        },
        { records: 0, files: 0, kvBytes: 0, blobBytes: 0, active: 0 },
      );
      return {
        projects: list.map(publicProject),
        totalProjects: list.length,
        activeProjects: totals.active,
        maxProjects: LIMITS.MAX_PROJECTS,
        kv: { usedBytes: totals.kvBytes, records: totals.records },
        blob: { usedBytes: totals.blobBytes, files: totals.files },
        recentActivity: activity,
      };
    }

    if (route('GET', '/api/activity')) {
      requireAdmin(token);
      return { items: store.read('activity', []).slice(0, Number(query.limit) || 25) };
    }

    if (route('DELETE', '/api/activity')) {
      requireAdmin(token);
      store.write('activity', []);
      return { cleared: true };
    }

    /* --- records --- */
    if (route('POST', '/api/data')) {
      requireAdmin(token);
      const project = findProject(body?.projectId);
      const record = await createRecordInternal(project.id, body || {});
      pushActivity(project.id, project.name, 'data.create', `${record.type.toUpperCase()} record "${record.key || record.id}" created`);
      touchUsage(project.id);
      return { record, size: recordSizeBytes(record) };
    }

    if (route('GET', '/api/data')) {
      requireAdmin(token);
      const project = findProject(query.projectId);
      let list = (store.read('records', {})[project.id] || []).slice();
      if (query.type) list = list.filter((r) => r.type === query.type);
      if (query.kind) list = list.filter((r) => r.kind === query.kind);
      const q = String(query.q || '').toLowerCase();
      if (q) {
        list = list.filter(
          (r) =>
            r.key?.toLowerCase().includes(q) ||
            r.content?.toLowerCase().includes(q) ||
            r.tags?.some((t) => String(t).toLowerCase().includes(q)),
        );
      }
      list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const limit = Number(query.limit) || 25;
      const offset = Number(query.offset) || 0;
      const types = {};
      const kinds = {};
      (store.read('records', {})[project.id] || []).forEach((r) => {
        types[r.type] = (types[r.type] || 0) + 1;
        kinds[r.kind] = (kinds[r.kind] || 0) + 1;
      });
      return {
        total: list.length,
        offset,
        limit,
        records: list.slice(offset, offset + limit).map(recordSummary),
        types,
        kinds,
      };
    }

    if ((params = route('GET', '/api/data/:id'))) {
      requireAdmin(token);
      const project = findProject(query.projectId);
      const record = (store.read('records', {})[project.id] || []).find((r) => r.id === params.id);
      if (!record) throw apiError(404, 'not_found', 'Record not found.');
      return { record };
    }

    if ((params = route('PUT', '/api/data/:id')) || (params = route('PATCH', '/api/data/:id'))) {
      requireAdmin(token);
      const project = findProject(query.projectId);
      const records = store.read('records', {});
      const list = records[project.id] || [];
      const idx = list.findIndex((r) => r.id === params.id);
      if (idx === -1) throw apiError(404, 'not_found', 'Record not found.');
      const next = buildRecord(
        { ...list[idx], ...body, id: list[idx].id, projectId: project.id, createdAt: list[idx].createdAt, version: list[idx].version + 1 },
        { actor: 'admin' },
      );
      list[idx] = next;
      store.write('records', records);
      touchUsage(project.id);
      pushActivity(project.id, project.name, 'data.update', `Record "${next.key || next.id}" updated`);
      return { record: next };
    }

    if ((params = route('DELETE', '/api/data/:id'))) {
      requireAdmin(token);
      const project = findProject(query.projectId);
      const records = store.read('records', {});
      records[project.id] = (records[project.id] || []).filter((r) => r.id !== params.id);
      store.write('records', records);
      touchUsage(project.id);
      pushActivity(project.id, project.name, 'data.delete', `Record ${params.id} deleted`);
      return { deleted: params.id };
    }

    /* --- files --- */
    if (route('GET', '/api/files')) {
      requireAdmin(token);
      const project = findProject(query.projectId);
      let list = (store.read('files', {})[project.id] || []).slice();
      const q = String(query.q || '').toLowerCase();
      if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
      if (query.type) list = list.filter((f) => f.type.startsWith(query.type));
      list.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
      const groups = { image: 0, pdf: 0, audio: 0, video: 0, archive: 0, other: 0 };
      list.forEach((f) => {
        const t = f.type || '';
        if (t.startsWith('image/')) groups.image += 1;
        else if (t === 'application/pdf') groups.pdf += 1;
        else if (t.startsWith('audio/')) groups.audio += 1;
        else if (t.startsWith('video/')) groups.video += 1;
        else if (t.includes('zip')) groups.archive += 1;
        else groups.other += 1;
      });
      const limit = Number(query.limit) || 25;
      const offset = Number(query.offset) || 0;
      return {
        total: list.length,
        totalBytes: list.reduce((s, f) => s + (f.size || 0), 0),
        offset,
        limit,
        files: list.slice(offset, offset + limit),
        folders: groups,
      };
    }

    if (route('POST', '/api/files')) {
      requireAdmin(token);
      const project = findProject(options.form?.get('projectId') || query.projectId || body?.projectId);
      const file = options.form?.get('file');
      if (!file) throw apiError(400, 'bad_request', 'Missing "file" field.');
      const check = isUploadAllowed({ name: file.name, type: file.type, size: file.size });
      if (!check.ok) throw apiError(415, 'unsupported_file', check.error);
      const files = store.read('files', {});
      const list = files[project.id] || [];
      const meta = {
        id: generateFileId(),
        projectId: project.id,
        name: file.name,
        ext: check.ext,
        type: file.type || 'application/octet-stream',
        size: file.size,
        key: `${project.id}/files/${file.name}`,
        uploadedAt: nowIso(),
        uploadedBy: 'admin',
        note: options.form?.get('note') || '',
        downloads: 0,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      };
      list.push(meta);
      files[project.id] = list;
      store.write('files', files);
      touchUsage(project.id);
      pushActivity(project.id, project.name, 'files.upload', `Uploaded "${meta.name}" (${Math.round(meta.size / 1024)} KB)`);
      return { file: meta };
    }

    if ((params = route('DELETE', '/api/files/:id'))) {
      requireAdmin(token);
      const project = findProject(query.projectId);
      const files = store.read('files', {});
      files[project.id] = (files[project.id] || []).filter((f) => f.id !== params.id);
      store.write('files', files);
      touchUsage(project.id);
      pushActivity(project.id, project.name, 'files.delete', `File ${params.id} deleted`);
      return { deleted: params.id };
    }

    /* --- settings --- */
    if (route('GET', '/api/settings')) {
      requireAdmin(token);
      return {
        settings: store.read('settings', {}),
        storage: {
          kvNamespace: 'STORAGE_KV (preview: localStorage)',
          blobStore: 'storage-server (preview: localStorage)',
          maxProjects: LIMITS.MAX_PROJECTS,
          recordMaxBytes: LIMITS.RECORD_MAX_BYTES,
          fileMaxBytes: LIMITS.FILE_MAX_BYTES,
        },
      };
    }

    if (route('PUT', '/api/settings')) {
      requireAdmin(token);
      const next = { ...store.read('settings', {}), ...(body || {}) };
      store.write('settings', next);
      pushActivity(null, '', 'settings.update', 'Server settings updated');
      return { settings: next };
    }

    if (route('GET', '/api/maintenance/orphans')) {
      requireAdmin(token);
      return { orphans: [] };
    }

    throw apiError(404, 'not_found', `No preview route for ${method} ${url.pathname}`);
  }

  return { handle };
}

/* ------------------------------ utils ------------------------------ */

function apiError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function offsetIso(amount, unit) {
  const ms = { minutes: 60000, hours: 3600000, days: 86400000 }[unit] || 0;
  return new Date(Date.now() - amount * ms).toISOString();
}

function envSnippet(project) {
  return `# ${project.name}  (project id: ${project.id})
STORAGE_API_BASE=${location.origin}
STORAGE_PROJECT_ID=${project.id}
# Public frontend (write-only, safe to ship)
STORAGE_USER_TOKEN=${project.config.user.token}
# Server-side only. Never expose in browser code.
STORAGE_ADMIN_SECRET=${project.config.admin.secret}
`;
}

export const PREVIEW_CREDENTIALS = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
