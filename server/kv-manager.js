/**
 * KV manager - records (TXT / JSON) stored in EdgeOne KV.
 *
 * Layout
 *   ss_records_<projectId>        -> JSON array of record ids (max 1000/page)
 *   ss_record_<projectId>_<id>    -> full record JSON
 *
 * Bigger JSON documents should go to Blob (see blob-manager.js) because KV
 * values are capped at 25 MB and are meant for small payloads.
 */

import {
  LIMITS,
  K,
  ValidationError,
  buildRecord,
  byteLength,
  generateRecordId,
  nowIso,
  recordSizeBytes,
  sanitizeKey,
} from './core.js';

const INDEX_PAGE = 500;

async function readIndex(kv, projectId) {
  const raw = await kv.get(K.recordsIndex(projectId), 'json');
  return Array.isArray(raw) ? raw : [];
}

async function writeIndex(kv, projectId, ids) {
  await kv.put(K.recordsIndex(projectId), JSON.stringify(ids.slice(-LIMITS.RECORD_MAX_COUNT_PER_PROJECT)));
}

async function touchProjectUsage(kv, projectId, delta) {
  const project = await kv.get(K.project(projectId), 'json');
  if (!project) return;
  project.usage = project.usage || { records: 0, files: 0, kvBytes: 0, blobBytes: 0 };
  project.usage.records = Math.max(0, (project.usage.records || 0) + (delta.records || 0));
  project.usage.kvBytes = Math.max(0, (project.usage.kvBytes || 0) + (delta.kvBytes || 0));
  project.updatedAt = nowIso();
  await kv.put(K.project(projectId), JSON.stringify(project));
}

/* ------------------------------------------------------------------ */
/* Read                                                               */
/* ------------------------------------------------------------------ */

export async function listRecords(kv, projectId, {
  search = '',
  type = '',
  kind = '',
  limit = 50,
  offset = 0,
  sort = 'newest',
} = {}) {
  const ids = await readIndex(kv, projectId);
  const all = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const rec = await kv.get(K.record(projectId, id), 'json');
    if (rec) all.push(rec);
  }

  let filtered = all;
  if (type) filtered = filtered.filter((r) => r.type === type);
  if (kind) filtered = filtered.filter((r) => r.kind === kind);
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((r) =>
      r.key?.toLowerCase().includes(q) ||
      r.content?.toLowerCase().includes(q) ||
      r.tags?.some((t) => String(t).toLowerCase().includes(q)) ||
      r.id.toLowerCase().includes(q),
    );
  }

  filtered.sort((a, b) => {
    const d = String(a.createdAt).localeCompare(String(b.createdAt));
    return sort === 'oldest' ? d : -d;
  });

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit).map(summaryOf);
  return { total, offset, limit, records: page, types: countBy(all, 'type'), kinds: countBy(all, 'kind') };
}

function countBy(list, field) {
  const out = {};
  for (const item of list) {
    const v = item[field] || 'other';
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}

export function summaryOf(rec) {
  return {
    id: rec.id,
    projectId: rec.projectId,
    type: rec.type,
    kind: rec.kind,
    key: rec.key,
    tags: rec.tags,
    source: rec.source,
    size: recordSizeBytes(rec),
    preview: previewOf(rec),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    version: rec.version,
  };
}

function previewOf(rec) {
  const raw = String(rec.content || '');
  if (rec.type === 'json') {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        const entries = Object.entries(obj).slice(0, 3).map(([k, v]) => {
          const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return `${k}: ${val.length > 28 ? `${val.slice(0, 27)}…` : val}`;
        });
        return entries.join(' · ') || '{}';
      }
      return String(obj).slice(0, 90);
    } catch {
      return raw.slice(0, 90);
    }
  }
  return raw.replace(/\s+/g, ' ').slice(0, 90);
}

export async function getRecord(kv, projectId, recordId) {
  const rec = await kv.get(K.record(projectId, recordId), 'json');
  if (!rec) throw Object.assign(new Error('Record not found'), { status: 404, code: 'not_found' });
  return rec;
}

/* ------------------------------------------------------------------ */
/* Write                                                              */
/* ------------------------------------------------------------------ */

export async function createRecord(kv, projectId, payload, { actor = 'admin', maxBytes = LIMITS.RECORD_MAX_BYTES } = {}) {
  const project = await kv.get(K.project(projectId), 'json');
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404, code: 'not_found' });

  const index = await readIndex(kv, projectId);
  if (index.length >= LIMITS.RECORD_MAX_COUNT_PER_PROJECT) {
    throw Object.assign(
      new Error(`Record limit reached (${LIMITS.RECORD_MAX_COUNT_PER_PROJECT}) for this project.`),
      { status: 429, code: 'record_limit' },
    );
  }

  const requestedId = payload.id || payload.clientId;
  const id = requestedId && /^rec_[a-z0-9]{6,32}$/.test(String(requestedId)) ? String(requestedId) : generateRecordId();
  const record = buildRecord({ ...payload, projectId, id }, { actor });
  if (payload.meta) record.meta = sanitizeMeta(payload.meta);

  const size = recordSizeBytes(record);
  const cap = Math.min(maxBytes, LIMITS.RECORD_MAX_BYTES);
  if (size > cap) {
    throw Object.assign(new Error(`Record is ${size} bytes; the project limit is ${cap} bytes.`), {
      status: 413,
      code: 'record_too_large',
    });
  }

  await kv.put(K.record(projectId, record.id), JSON.stringify(record));
  if (!index.includes(record.id)) {
    index.push(record.id);
    await writeIndex(kv, projectId, index);
  }
  await touchProjectUsage(kv, projectId, { records: 1, kvBytes: size });

  return { record, size };
}

export async function updateRecord(kv, projectId, recordId, payload) {
  const existing = await getRecord(kv, projectId, recordId);
  const previousSize = recordSizeBytes(existing);

  const next = buildRecord(
    {
      ...payload,
      id: existing.id,
      projectId,
      createdAt: existing.createdAt,
      version: Number(existing.version || 1) + 1,
      meta: payload.meta ?? existing.meta,
    },
    { actor: payload.source || 'admin' },
  );

  const size = recordSizeBytes(next);
  const cap = Math.min(projectCap(await kv.get(K.project(projectId), 'json')), LIMITS.RECORD_MAX_BYTES);
  if (size > cap) {
    throw Object.assign(new Error(`Record is ${size} bytes; the project limit is ${cap} bytes.`), {
      status: 413,
      code: 'record_too_large',
    });
  }

  await kv.put(K.record(projectId, recordId), JSON.stringify(next));
  await touchProjectUsage(kv, projectId, { kvBytes: size - previousSize });
  return { record: next, size };
}

function projectCap(project) {
  return project?.settings?.maxRecordBytes || LIMITS.RECORD_MAX_BYTES;
}

export async function deleteRecord(kv, projectId, recordId) {
  const existing = await getRecord(kv, projectId, recordId);
  const size = recordSizeBytes(existing);
  await kv.delete(K.record(projectId, recordId));
  const index = await readIndex(kv, projectId);
  await writeIndex(kv, projectId, index.filter((id) => id !== recordId));
  await touchProjectUsage(kv, projectId, { records: -1, kvBytes: -size });
  return { deleted: recordId };
}

/* ------------------------------------------------------------------ */
/* Bulk + maintenance                                                 */
/* ------------------------------------------------------------------ */

export async function exportRecords(kv, projectId) {
  const ids = await readIndex(kv, projectId);
  const out = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const rec = await kv.get(K.record(projectId, id), 'json');
    if (rec) out.push(rec);
  }
  return out;
}

export async function importRecords(kv, projectId, records = [], { actor = 'admin' } = {}) {
  const created = [];
  for (const rec of records.slice(0, 1000)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { record } = await createRecord(kv, projectId, rec, { actor });
      created.push(record.id);
    } catch {
      /* skip invalid rows */
    }
  }
  return { imported: created.length, ids: created };
}

/** Recomputes usage from the actual keys (repairs drifted counters). */
export async function recountUsage(kv, projectId) {
  const project = await kv.get(K.project(projectId), 'json');
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404, code: 'not_found' });
  const ids = await readIndex(kv, projectId);
  let bytes = 0;
  let count = 0;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const rec = await kv.get(K.record(projectId, id), 'json');
    if (!rec) continue;
    count += 1;
    bytes += recordSizeBytes(rec);
  }
  project.usage = { ...(project.usage || {}), records: count, kvBytes: bytes };
  await kv.put(K.project(projectId), JSON.stringify(project));
  return project.usage;
}

/** Detects duplicate writes from the same client (idempotency helper). */
export function recordFingerprint(payload) {
  const basis = sanitizeKey(payload.key || '') + '|' + JSON.stringify(payload.content ?? '');
  return byteLength(basis).toString(36) + '_' + basis.length.toString(36);
}

export async function findByFingerprint(kv, projectId, fingerprint) {
  const ids = await readIndex(kv, projectId);
  for (const id of ids.slice(-200)) {
    // eslint-disable-next-line no-await-in-loop
    const rec = await kv.get(K.record(projectId, id), 'json');
    if (rec?.meta?.fingerprint === fingerprint) return rec;
  }
  return null;
}

function sanitizeMeta(meta) {
  const out = {};
  const entries = Object.entries(meta).slice(0, 20);
  for (const [k, v] of entries) {
    const key = String(k).slice(0, 40);
    if (v == null) continue;
    out[key] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : String(v).slice(0, 500);
  }
  return out;
}

export function assertRecordId(id) {
  if (!/^rec_[a-z0-9]{6,32}$/.test(String(id))) {
    throw new ValidationError('recordId', 'Invalid record id.');
  }
  return id;
}

export { INDEX_PAGE };
