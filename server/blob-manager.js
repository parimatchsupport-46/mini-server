/**
 * Blob manager - files stored in EdgeOne Blob Storage.
 *
 * Layout
 *   <projectId>/files/<fileId>.<ext>          actual bytes
 *   ss_files_<projectId>                      JSON array of file metadata
 *   ss_file_<projectId>_<fileId>              single file metadata (fast lookup)
 */

import {
  BLOB,
  LIMITS,
  K,
  ValidationError,
  fileExt,
  generateFileId,
  isUploadAllowed,
  nowIso,
} from './core.js';

async function readIndex(kv, projectId) {
  const raw = await kv.get(K.filesIndex(projectId), 'json');
  return Array.isArray(raw) ? raw : [];
}

async function writeIndex(kv, projectId, list) {
  await kv.put(K.filesIndex(projectId), JSON.stringify(list.slice(-LIMITS.FILES_MAX_COUNT_PER_PROJECT)));
}

async function touchProjectUsage(kv, projectId, delta) {
  const project = await kv.get(K.project(projectId), 'json');
  if (!project) return;
  project.usage = project.usage || { records: 0, files: 0, kvBytes: 0, blobBytes: 0 };
  project.usage.files = Math.max(0, (project.usage.files || 0) + (delta.files || 0));
  project.usage.blobBytes = Math.max(0, (project.usage.blobBytes || 0) + (delta.blobBytes || 0));
  project.updatedAt = nowIso();
  await kv.put(K.project(projectId), JSON.stringify(project));
}

/* ------------------------------------------------------------------ */
/* Read                                                               */
/* ------------------------------------------------------------------ */

export async function listFiles(kv, projectId, { search = '', type = '', limit = 50, offset = 0 } = {}) {
  const index = await readIndex(kv, projectId);
  let items = index.slice().sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));

  const q = String(search || '').trim().toLowerCase();
  if (q) {
    items = items.filter((f) =>
      f.name.toLowerCase().includes(q) ||
      (f.type || '').toLowerCase().includes(q) ||
      f.id.includes(q),
    );
  }
  if (type) {
    items = items.filter((f) => (f.type || '').startsWith(type));
  }

  const total = items.length;
  const totalBytes = items.reduce((sum, f) => sum + (f.size || 0), 0);
  return {
    total,
    totalBytes,
    offset,
    limit,
    files: items.slice(offset, offset + limit),
    folders: groupByType(items),
  };
}

function groupByType(items) {
  const groups = { image: 0, pdf: 0, audio: 0, video: 0, archive: 0, other: 0 };
  for (const f of items) {
    const t = f.type || '';
    if (t.startsWith('image/')) groups.image += 1;
    else if (t === 'application/pdf') groups.pdf += 1;
    else if (t.startsWith('audio/')) groups.audio += 1;
    else if (t.startsWith('video/')) groups.video += 1;
    else if (t.includes('zip')) groups.archive += 1;
    else groups.other += 1;
  }
  return groups;
}

export async function getFileMeta(kv, projectId, fileId) {
  if (!/^fil_[a-z0-9]{6,32}$/.test(String(fileId))) {
    throw new ValidationError('fileId', 'Invalid file id.');
  }
  const meta = await kv.get(K.fileMeta(projectId, fileId), 'json');
  if (!meta) throw Object.assign(new Error('File not found'), { status: 404, code: 'not_found' });
  return meta;
}

export async function downloadFile(kv, blob, projectId, fileId) {
  const meta = await getFileMeta(kv, projectId, fileId);
  const buf = await blob.get(BLOB.fileKey(projectId, meta.id, meta.ext), { type: 'arrayBuffer' });
  if (!buf) throw Object.assign(new Error('File bytes are missing from blob storage.'), { status: 410, code: 'gone' });
  return { meta, bytes: buf };
}

/* ------------------------------------------------------------------ */
/* Write                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {object} input
 * @param {string} input.name        original file name
 * @param {string} input.type        MIME type
 * @param {ArrayBuffer|Uint8Array} input.bytes
 */
export async function uploadFile(kv, blob, projectId, { name, type, bytes, uploadedBy = 'admin', note = '' }) {
  const project = await kv.get(K.project(projectId), 'json');
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404, code: 'not_found' });

  const index = await readIndex(kv, projectId);
  if (index.length >= LIMITS.FILES_MAX_COUNT_PER_PROJECT) {
    throw Object.assign(new Error('File limit reached for this project.'), { status: 429, code: 'file_limit' });
  }

  const size = bytes.byteLength ?? bytes.length ?? 0;
  const check = isUploadAllowed({ name, type, size });
  if (!check.ok) throw Object.assign(new Error(check.error), { status: 415, code: 'unsupported_file' });

  const id = generateFileId();
  const safeName = String(name).replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || `file.${check.ext}`;
  const key = BLOB.fileKey(projectId, id, check.ext);

  await blob.set(key, bytes, { contentType: type || 'application/octet-stream' });

  const meta = {
    id,
    projectId,
    name: safeName,
    ext: check.ext,
    type: type || 'application/octet-stream',
    size,
    key,
    uploadedAt: nowIso(),
    uploadedBy,
    note: String(note || '').slice(0, 200),
    downloads: 0,
  };

  await kv.put(K.fileMeta(projectId, id), JSON.stringify(meta));
  index.push(meta);
  await writeIndex(kv, projectId, index);
  await touchProjectUsage(kv, projectId, { files: 1, blobBytes: size });

  return meta;
}

export async function deleteFile(kv, blob, projectId, fileId) {
  const meta = await getFileMeta(kv, projectId, fileId);
  await blob.delete(meta.key);
  await kv.delete(K.fileMeta(projectId, fileId));
  const index = await readIndex(kv, projectId);
  await writeIndex(kv, projectId, index.filter((f) => f.id !== fileId));
  await touchProjectUsage(kv, projectId, { files: -1, blobBytes: -(meta.size || 0) });
  return { deleted: fileId };
}

export async function noteDownload(kv, projectId, fileId) {
  try {
    const meta = await getFileMeta(kv, projectId, fileId);
    meta.downloads = (meta.downloads || 0) + 1;
    meta.lastDownloadedAt = nowIso();
    await kv.put(K.fileMeta(projectId, fileId), JSON.stringify(meta));
    const index = await readIndex(kv, projectId);
    const next = index.map((f) => (f.id === fileId ? { ...f, downloads: meta.downloads } : f));
    await writeIndex(kv, projectId, next);
  } catch {
    /* download counters are best effort */
  }
}

/** Optional client-direct upload flow (EdgeOne createUploadUrl). */
export async function createUploadTicket(blob, projectId, { name, type, expireSeconds = 900 }) {
  const check = isUploadAllowed({ name, type });
  if (!check.ok) throw Object.assign(new Error(check.error), { status: 415, code: 'unsupported_file' });
  const id = generateFileId();
  const key = BLOB.fileKey(projectId, id, check.ext);
  const ticket = await blob.createUploadUrl?.(key, {
    expireSeconds,
    contentType: type || 'application/octet-stream',
  });
  if (!ticket) return null;
  return { fileId: id, ext: check.ext, key, ...ticket };
}

/** Confirms a client-direct upload: reads back size and writes metadata. */
export async function confirmUpload(kv, blob, projectId, { fileId, key, ext, name, type, note = '', uploadedBy = 'admin' }) {
  if (!/^fil_[a-z0-9]{6,32}$/.test(String(fileId))) throw new ValidationError('fileId', 'Invalid file id.');
  const expected = BLOB.fileKey(projectId, fileId, ext);
  if (key !== expected) throw new ValidationError('key', 'Upload key does not belong to this project/file.');
  const bytes = await blob.get(key, { type: 'arrayBuffer' });
  if (!bytes) throw Object.assign(new Error('Upload not found in blob storage.'), { status: 404, code: 'not_found' });

  const index = await readIndex(kv, projectId);
  const meta = {
    id: fileId,
    projectId,
    name: String(name).replace(/[^\w.\- ()]+/g, '_').slice(0, 120),
    ext,
    type: type || 'application/octet-stream',
    size: bytes.byteLength,
    key,
    uploadedAt: nowIso(),
    uploadedBy,
    note: String(note || '').slice(0, 200),
    downloads: 0,
  };
  await kv.put(K.fileMeta(projectId, fileId), JSON.stringify(meta));
  index.push(meta);
  await writeIndex(kv, projectId, index);
  await touchProjectUsage(kv, projectId, { files: 1, blobBytes: meta.size });
  return meta;
}

export function inferExt(name) {
  return fileExt(name);
}
