/**
 * EdgeOne Pages Function - catch-all API entrypoint.
 *
 * Every /api/* request that does not match a more specific file in
 * functions/api/ lands here. The router is shared by every entrypoint, so it
 * does not matter which file EdgeOne dispatches to.
 *
 * Bindings used:
 *   STORAGE_KV  -> EdgeOne KV namespace (console: Storage -> KV -> bind as STORAGE_KV)
 *   Blob        -> EdgeOne Blob, store name "storage-server" (auto-created)
 *
 * Environment variables:
 *   ADMIN_SETUP_KEY  optional: required by /api/auth/setup when set
 *   ADMIN_EMAIL      optional: suggested admin email
 */

import { handleApi } from '../../server/app.js';
import { wrapKvBinding } from '../../server/storage.js';
import { getStore } from '@edgeone/pages-blob';
import { createRuntimeServices } from '../../server/runtime.js';

export async function onRequest(context) {
  const services = await createRuntimeServices(context, { getStore, wrapKvBinding });
  return handleApi(context.request, services);
}

export default onRequest;
