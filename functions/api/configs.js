/**
 * EdgeOne Pages Function - /api/config/:projectId
 * Returns connection configs. Admin scope only for the full config; user-panel
 * credentials receive public metadata and never another credential.
 */
import { handleApi } from '../../server/app.js';
import { createRuntimeServices } from '../../server/runtime.js';
import { getStore } from '@edgeone/pages-blob';
import { wrapKvBinding } from '../../server/storage.js';

export async function onRequest(context) {
  const services = await createRuntimeServices(context, { getStore, wrapKvBinding });
  return handleApi(context.request, services);
}

export default onRequest;
