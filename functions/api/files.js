/**
 * EdgeOne Pages Function - /api/files and /api/files/*
 * Blob-backed uploads / downloads / deletes.
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
