/**
 * Activity log - a rolling list of the last 100 events, stored as one KV value.
 * Used by the dashboard "Recent activity" panel.
 */

import { K, generateActivityId } from './core.js';

const MAX_ENTRIES = 100;

export async function addActivity(kv, { action, projectId = null, projectName = '', scope = 'admin', message = '', meta = {} }) {
  const list = (await kv.get(K.activityIndex(), 'json')) || [];
  const entry = {
    id: generateActivityId(),
    at: new Date().toISOString(),
    action,
    projectId,
    projectName,
    scope,
    message,
    meta,
  };
  const next = [entry, ...(Array.isArray(list) ? list : [])].slice(0, MAX_ENTRIES);
  await kv.put(K.activityIndex(), JSON.stringify(next));
  return entry;
}

export async function listActivity(kv, { limit = 25, projectId = null } = {}) {
  const list = (await kv.get(K.activityIndex(), 'json')) || [];
  const items = Array.isArray(list) ? list : [];
  const filtered = projectId ? items.filter((e) => e.projectId === projectId) : items;
  return filtered.slice(0, limit);
}

export async function clearActivity(kv) {
  await kv.put(K.activityIndex(), JSON.stringify([]));
  return { cleared: true };
}
