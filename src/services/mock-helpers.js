/**
 * Browser-side re-exports of the shared core, so the preview mock backend and
 * the real backend stay behaviourally identical (same ids, same token format,
 * same record shape, same validation).
 */

export {
  LIMITS,
  buildRecord,
  createUserToken,
  generateActivityId,
  generateAdminSecret,
  generateFileId,
  generateProjectId,
  generateRecordId,
  generateUserToken,
  hmacSign,
  isUploadAllowed,
  nowIso,
  recordSizeBytes,
  validateProjectName,
} from '../../server/core.js';

export { buildConnectionConfig } from '../../server/project-manager.js';

export function freshness() {
  return Date.now();
}
