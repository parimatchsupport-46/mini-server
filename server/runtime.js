/**
 * Builds the `services` object passed to the router.
 *
 * Kept separate from the function entrypoints so that local development, the
 * Vite dev middleware and EdgeOne Functions all construct identical services.
 */

import { wrapBlobStore } from './storage.js';
import { BLOB } from './core.js';

/**
 * @param {object} context EdgeOne Functions context: { request, env, params }
 * @param {object} deps    { getStore, wrapKvBinding }
 */
export async function createRuntimeServices(context, deps) {
  const env = context?.env || {};

  // KV binding name is configurable; fall back to a few common spellings.
  const kvBinding =
    env.STORAGE_KV ||
    env.STORAGE ||
    env.KV ||
    env.MY_KV ||
    env.STORAGE_KV_NAMESPACE ||
    null;

  const { wrapKvBinding } = deps;
  const kv = wrapKvBinding(kvBinding, { name: kvBinding ? 'STORAGE_KV' : 'STORAGE_KV (unbound)' });

  let blob;
  try {
    const storeName = env.BLOB_STORE_NAME || BLOB.storeName;
    const store = deps.getStore ? deps.getStore({ name: storeName, consistency: 'strong' }) : null;
    blob = wrapBlobStore(store);
  } catch (error) {
    console.error('[runtime] blob store unavailable:', error?.message);
    blob = wrapBlobStore(null);
  }

  return {
    kv,
    blob,
    env,
    runtime: 'edgeone',
    request: context?.request,
  };
}
