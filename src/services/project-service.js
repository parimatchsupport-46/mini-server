/**
 * Project service — CRUD + connection configs.
 */

import { api } from './api.js';

export async function listProjects() {
  return api.get('/api/projects');
}

export async function getProject(id) {
  return api.get(`/api/projects/${encodeURIComponent(id)}`);
}

export async function createProject(payload) {
  return api.post('/api/projects', payload);
}

export async function updateProject(id, payload) {
  return api.patch(`/api/projects/${encodeURIComponent(id)}`, payload);
}

export async function deleteProject(id, { confirmName, purgeData = true }) {
  return api.del(`/api/projects/${encodeURIComponent(id)}`, { body: { confirmName, purgeData } });
}

export async function rotateCredentials(id, kind = 'user') {
  return api.post(`/api/projects/${encodeURIComponent(id)}/rotate`, { kind });
}

export async function getConnectionConfig(id) {
  return api.get(`/api/config/${encodeURIComponent(id)}`);
}

export async function getStats() {
  return api.get('/api/stats');
}

export async function getActivity(limit = 25) {
  return api.get(`/api/activity?limit=${limit}`);
}

export async function clearActivity() {
  return api.del('/api/activity');
}

export async function getSettings() {
  return api.get('/api/settings');
}

export async function saveSettings(payload) {
  return api.put('/api/settings', payload);
}

export async function getOrphans() {
  return api.get('/api/maintenance/orphans');
}
