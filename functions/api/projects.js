/**
 * EdgeOne Pages Function - /api/projects and /api/projects/*
 * Thin entrypoint; all logic lives in server/app.js so behaviour is identical
 * across every route file.
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
