/**
 * Blob service — file listing / upload / download / delete.
 */

import { api } from './api.js';

export async function listFiles(projectId, { q = '', type = '', limit = 25, offset = 0 } = {}) {
  const params = new URLSearchParams({ projectId, limit: String(limit), offset: String(offset) });
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  return api.get(`/api/files?${params.toString()}`);
}

export async function uploadFile(projectId, file, { note = '' } = {}) {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('projectId', projectId);
  if (note) form.append('note', note);
  return api.post('/api/files', undefined, { form });
}

export async function deleteFile(projectId, id) {
  return api.del(`/api/files/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`);
}

/**
 * Downloads a file through the API and triggers a browser save.
 * Goes through fetch so the Bearer token is applied.
 */
export async function downloadFile(projectId, file) {
  const url = `/api/files/${encodeURIComponent(file.id)}?projectId=${encodeURIComponent(projectId)}`;
  try {
    const res = await api.raw('GET', url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = file.name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    return true;
  } catch (error) {
    // Preview mode stores demo files without bytes — report cleanly.
    if (error?.status === 404 || error?.status === 410) {
      throw new Error('This demo file has no stored bytes. Upload your own file to test downloads.');
    }
    throw error;
  }
}

export function formatUploadError(error) {
  if (error?.status === 413 || error?.code === 'too_large') return 'That file is too large for this server.';
  if (error?.status === 415) return error.message || 'That file type is not allowed.';
  if (error?.status === 429) return 'Upload rate limit reached. Try again in a minute.';
  return error?.message || 'Upload failed.';
}
