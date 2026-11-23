/**
 * KV service — record CRUD against /api/data.
 */

import { api } from './api.js';

export async function listRecords(projectId, { q = '', type = '', kind = '', sort = 'newest', limit = 25, offset = 0 } = {}) {
  const params = new URLSearchParams({ projectId, limit: String(limit), offset: String(offset), sort });
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (kind) params.set('kind', kind);
  return api.get(`/api/data?${params.toString()}`);
}

export async function getRecord(projectId, id) {
  return api.get(`/api/data/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`);
}

export async function createRecord(projectId, payload) {
  return api.post('/api/data', { ...payload, projectId });
}

export async function updateRecord(projectId, id, payload) {
  return api.put(`/api/data/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`, payload);
}

export async function deleteRecord(projectId, id) {
  return api.del(`/api/data/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`);
}

export async function importRecords(projectId, records) {
  return api.post('/api/data/import', { projectId, records });
}
