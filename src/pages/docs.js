/**
 * API reference + security notes (in-app documentation).
 */

import { renderCodeBlock } from '../utils/config-generator.js';
import { icon } from '../components/icons.js';
import { esc } from '../utils/helpers.js';

const ENDPOINTS = [
  { method: 'POST', path: '/api/auth/setup', auth: 'public (once)', desc: 'Create the admin account. Locked after the first call.' },
  { method: 'POST', path: '/api/auth/login', auth: 'public', desc: 'Exchange email + password for a 12h session token.' },
  { method: 'GET', path: '/api/health', auth: 'public', desc: 'Runtime, storage backend and limits.' },
  { method: 'GET', path: '/api/stats', auth: 'admin', desc: 'Dashboard totals + recent activity.' },
  { method: 'GET', path: '/api/projects', auth: 'admin', desc: 'List projects (max 2).' },
  { method: 'POST', path: '/api/projects', auth: 'admin', desc: 'Create a project + both configs.' },
  { method: 'GET', path: '/api/projects/:id', auth: 'admin | project', desc: 'Project details and connection config.' },
  { method: 'PATCH', path: '/api/projects/:id', auth: 'admin', desc: 'Rename, pause or change project settings.' },
  { method: 'DELETE', path: '/api/projects/:id', auth: 'admin', desc: 'Delete project. Requires confirmName; purgeData decides whether data is removed.' },
  { method: 'POST', path: '/api/projects/:id/rotate', auth: 'admin', desc: 'Rotate user, admin or both credentials.' },
  { method: 'GET', path: '/api/config/:projectId', auth: 'admin | project', desc: 'Connection configs. User credentials receive public metadata only.' },
  { method: 'POST', path: '/api/data', auth: 'admin | project | user', desc: 'Create a JSON or TXT record. User credentials may only create.' },
  { method: 'GET', path: '/api/data', auth: 'admin | project', desc: 'List / search records (q, type, kind, limit, offset).' },
  { method: 'GET', path: '/api/data/:id', auth: 'admin | project', desc: 'Read one record in full.' },
  { method: 'PUT', path: '/api/data/:id', auth: 'admin | project', desc: 'Update a record (version is incremented).' },
  { method: 'DELETE', path: '/api/data/:id', auth: 'admin | project', desc: 'Delete a record.' },
  { method: 'POST', path: '/api/files', auth: 'admin | project | user', desc: 'Upload via multipart/form-data, field "file".' },
  { method: 'GET', path: '/api/files', auth: 'admin | project', desc: 'List files with type grouping.' },
  { method: 'GET', path: '/api/files/:id', auth: 'admin | project', desc: 'Download / stream a file.' },
  { method: 'DELETE', path: '/api/files/:id', auth: 'admin | project', desc: 'Delete a file and its metadata.' },
  { method: 'GET', path: '/api/settings', auth: 'admin', desc: 'Server settings and storage info.' },
  { method: 'GET', path: '/api/maintenance/orphans', auth: 'admin', desc: 'Detect data left behind after a non-purge delete.' },
];

export async function renderDocs(ctx) {
  if (ctx.params?.variant === 'security') return renderSecurity(ctx);

  const hash = window.location.hash.replace(/^#\/?/, '');
  const isSecurity = hash === 'security';

  if (isSecurity) return renderSecurity(ctx);

  ctx.setHeader({ title: 'API Reference', subtitle: 'Every endpoint, its scope and its permissions' });

  const origin = window.location.origin;

  ctx.renderContent(`
    <div class="card card--pad" style="margin-bottom:16px">
      <div class="row gap-12 row--wrap">
        <span class="stat__icon stat__icon--blue">${icon('code', { size: 18 })}</span>
        <div class="grow" style="min-width:220px">
          <div class="h3">Base URL</div>
          <div class="mono muted mt-4">${esc(origin)}/api</div>
        </div>
        <span class="badge badge--blue">JSON over HTTPS</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card__head">
        <div class="grow">
          <div class="card__title">Endpoints</div>
          <div class="card__desc">All routes require <span class="mono">Authorization: Bearer &lt;token&gt;</span> unless marked public.</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Method</th><th>Path</th><th>Scope</th><th>Description</th></tr>
          </thead>
          <tbody>
            ${ENDPOINTS.map(
              (e) => `
              <tr>
                <td><span class="type-tag ${e.method === 'GET' ? 'type-tag--txt' : 'type-tag--json'}">${e.method}</span></td>
                <td class="mono">${esc(e.path)}</td>
                <td><span class="badge ${scopeBadge(e.auth)}">${esc(e.auth)}</span></td>
                <td class="muted">${esc(e.desc)}</td>
              </tr>`,
            ).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="config-grid">
      <div class="card card--pad">
        <div class="h3" style="margin-bottom:10px">Write a record (user credential)</div>
        ${renderCodeBlock({
          label: 'curl',
          code: `curl -X POST ${origin}/api/data \\
  -H "Authorization: Bearer $USER_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "projectId": "prj_xxxxxxxx",
    "type": "json",
    "kind": "contact",
    "key": "contact-form",
    "content": { "name": "Aarav", "email": "aarav@example.com" }
  }'`,
        })}
      </div>

      <div class="card card--pad">
        <div class="h3" style="margin-bottom:10px">Read records (admin secret)</div>
        ${renderCodeBlock({
          label: 'curl',
          code: `curl -G ${origin}/api/data \\
  -H "Authorization: Bearer $ADMIN_SECRET" \\
  --data-urlencode "projectId=prj_xxxxxxxx" \\
  --data-urlencode "type=json" \\
  --data-urlencode "limit=25"`,
        })}
      </div>

      <div class="card card--pad">
        <div class="h3" style="margin-bottom:10px">Upload a file</div>
        ${renderCodeBlock({
          label: 'curl',
          code: `curl -X POST ${origin}/api/files \\
  -H "Authorization: Bearer $USER_TOKEN" \\
  -F "projectId=prj_xxxxxxxx" \\
  -F "file=@./invoice.pdf" \\
  -F "note=Customer invoice"`,
        })}
      </div>

      <div class="card card--pad">
        <div class="h3" style="margin-bottom:10px">Response envelope</div>
        ${renderCodeBlock({
          label: 'json',
          code: `{
  "ok": true,
  "data": { "...": "..." }
}

{
  "ok": false,
  "error": {
    "code": "forbidden",
    "message": "The \\"user\\" credential cannot perform \\"data.read\\"."
  }
}`,
        })}
      </div>
    </div>`);
}

function renderSecurity(ctx) {
  ctx.setHeader({ title: 'Security Notes', subtitle: 'How the permission model actually works' });

  ctx.renderContent(`
    <div class="config-grid">
      <div class="card card--pad">
        <span class="config-card__icon config-card__icon--user" style="margin-bottom:10px">${icon('globe', { size: 18 })}</span>
        <div class="h2" style="margin-bottom:6px">User Panel credential</div>
        <p class="sub" style="margin-bottom:12px">
          A signed capability token (<span class="mono">etu1.…</span>) that travels to the browser. It is verified with
          HMAC-SHA256 against a per-project signing secret and checked against the live rotation id, so revoking it is
          instant.
        </p>
        <div class="perm-list">
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Create records — the only write path</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Upload files with size + MIME + extension checks</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>Any read, list, update or delete call → 403</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>Choosing its own record id → 403</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>Reaching another project → 403</span></div>
        </div>
      </div>

      <div class="card card--pad">
        <span class="config-card__icon config-card__icon--admin" style="margin-bottom:10px">${icon('shield', { size: 18 })}</span>
        <div class="h2" style="margin-bottom:6px">Admin secret</div>
        <p class="sub" style="margin-bottom:12px">
          A per-project secret (<span class="mono">adm_…</span>) meant for your external project's server code. It can
          read and delete inside its own project, but it can never enumerate or touch the other project.
        </p>
        <div class="perm-list">
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Full read / write / delete inside its project</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>List all projects or change server settings</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>Cross-project access → 403</span></div>
        </div>
      </div>

      <div class="card card--pad">
        <div class="h2" style="margin-bottom:10px">Dashboard session</div>
        <p class="sub" style="margin-bottom:12px">
          The only credential that lives in this browser. It is a short-lived HMAC token
          (<span class="mono">das_…</span>) issued after a PBKDF2 password check. The password hash and signing secret
          never leave KV.
        </p>
        <div class="perm-list">
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Full admin: projects, records, files, settings</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Password change rotates the signing secret → all sessions drop</span></div>
        </div>
      </div>

      <div class="card card--pad">
        <div class="h2" style="margin-bottom:10px">Abuse protection</div>
        <div class="perm-list">
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Login: 10 attempts / 5 min per IP</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Setup: 5 attempts / 5 min per IP, single-use lock</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Writes: per-project fixed window (default 60/min)</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Record cap: 5,000 / project, 2 MB / record</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Files: 20 MB / file, 2,000 / project</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Dangerous extensions rejected; SVG forced to download</span></div>
        </div>
      </div>
    </div>

    <div class="card card--pad mt-16">
      <div class="h2" style="margin-bottom:10px">Deployment checklist</div>
      <div class="perm-list">
        <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Create an EdgeOne KV namespace and bind it to the project as <span class="mono">STORAGE_KV</span></span></div>
        <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Leave the Blob store name as <span class="mono">storage-server</span> (auto-created) or set <span class="mono">BLOB_STORE_NAME</span></span></div>
        <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Set <span class="mono">ADMIN_SETUP_KEY</span> so first-run setup cannot be hijacked</span></div>
        <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Run <span class="mono">npm run smoke</span> before deploying to verify the permission matrix</span></div>
      </div>
    </div>`);
}

function scopeBadge(scope) {
  if (scope.includes('admin')) return 'badge--orange';
  if (scope.includes('user')) return 'badge--blue';
  if (scope.includes('public')) return 'badge--gray';
  return 'badge--green';
}
