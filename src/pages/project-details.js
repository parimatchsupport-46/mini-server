/**
 * Project details — overview, connection configs, records, files, danger zone.
 */

import { getProject } from '../services/project-service.js';
import { listRecords } from '../services/kv-service.js';
import { listFiles, uploadFile, formatUploadError } from '../services/blob-service.js';
import { renderRecordsTable, renderFileTile } from '../components/data-table.js';
import { renderSecretField, renderCodeBlock, downloadTextFile, buildEnvFile, buildClientSnippet } from '../utils/config-generator.js';
import { icon } from '../components/icons.js';
import { colorFor, copyToClipboard, esc, formatBytes, formatDateTime, formatNumber, initials, timeAgo } from '../utils/helpers.js';
import { closeModal, confirmDialog, openModal, toast } from '../components/modal.js';
import { deleteProjectFlow, rotateFlow, toggleStatusFlow } from './projects.js';
import { openRecordModal, deleteRecordFlow } from './storage.js';
import { validateProjectName, validateFile } from '../utils/validators.js';
import { updateProject } from '../services/project-service.js';

let activeTab = 'overview';

export async function renderProjectDetails(ctx) {
  const { id } = ctx.params;

  ctx.setHeader({
    title: 'Project',
    subtitle: 'Connection configs, stored data and settings',
    actions: `<button class="btn btn--secondary btn--sm" data-action="back-to-projects">${icon('arrowLeft', { size: 15 })} All projects</button>`,
  });

  ctx.renderContent(`
    <div class="card card--pad">
      <div class="row gap-12">
        <div class="skeleton" style="width:56px;height:56px;border-radius:17px"></div>
        <div class="grow">
          <div class="skeleton" style="height:16px;width:34%;margin-bottom:8px"></div>
          <div class="skeleton" style="height:10px;width:52%"></div>
        </div>
      </div>
    </div>`);

  let data;
  try {
    data = await getProject(id);
  } catch (error) {
    ctx.renderContent(`
      <div class="card card--pad">
        <div class="row gap-12">
          <span class="stat__icon stat__icon--orange">${icon('alert', { size: 18 })}</span>
          <div>
            <div class="h3">Project not found</div>
            <div class="sub mt-4">${esc(error.message)}</div>
          </div>
        </div>
        <button class="btn btn--secondary mt-16" data-action="back-to-projects">Back to projects</button>
      </div>`);
    return;
  }

  const project = data.project;
  ctx.setHeader({
    title: project.name,
    subtitle: project.id,
    actions: `
      <button class="btn btn--secondary btn--sm" data-action="back-to-projects">${icon('arrowLeft', { size: 15 })} All projects</button>
      <button class="btn btn--primary btn--sm" data-action="create-record" data-project="${esc(project.id)}">
        ${icon('plus', { size: 15 })} New record
      </button>`,
  });

  ctx.renderContent(shell(project, data, activeTab));
  wire(ctx, project, data);

  const content = document.getElementById('page-content');

  content.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      activeTab = tabBtn.dataset.tab;
      content.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-active', b === tabBtn));
      content.querySelectorAll('[data-panel]').forEach((p) => {
        p.classList.toggle('hide', p.dataset.panel !== activeTab);
      });
      return;
    }

    if (e.target.closest('[data-action="back-to-projects"]')) {
      ctx.navigate('/projects');
      return;
    }

    if (e.target.closest('[data-action="create-record"]')) {
      openRecordModal({ projectId: project.id, onSaved: () => refreshRecordsPanel(project.id) });
      return;
    }

    if (e.target.closest('[data-action="edit-project"]')) {
      openEditProjectModal(ctx, project);
      return;
    }

    if (e.target.closest('[data-action="toggle-status"]')) {
      await toggleStatusFlow(ctx, project);
      return;
    }

    if (e.target.closest('[data-action="rotate-user"]')) {
      await rotateFlow(ctx, project, 'user');
      return;
    }

    if (e.target.closest('[data-action="rotate-admin"]')) {
      await rotateFlow(ctx, project, 'admin');
      return;
    }

    if (e.target.closest('[data-action="delete-project"]')) {
      await deleteProjectFlow(ctx, project);
      return;
    }

    if (e.target.closest('[data-action="download-env"]')) {
      downloadTextFile(
        `${project.id}.env`,
        buildEnvFile({
          projectName: project.name,
          projectId: project.id,
          apiBase: data.connection?.user?.apiBase || `${location.origin}/api`,
          userToken: data.connection?.user?.token || '',
          adminSecret: data.connection?.admin?.token || '',
        }),
      );
      toast('.env file downloaded', { type: 'success' });
      return;
    }

    if (e.target.closest('[data-action="download-client"]')) {
      downloadTextFile(`storage-client-${project.id}.js`, buildClientSnippet({
        apiBase: data.connection?.user?.apiBase || `${location.origin}/api`,
        projectId: project.id,
        userToken: 'YOUR_USER_TOKEN',
      }));
      toast('Client helper downloaded', { type: 'success' });
      return;
    }

    if (e.target.closest('[data-action="copy-code"]')) {
      const btn = e.target.closest('[data-action="copy-code"]');
      const text = document.getElementById(btn.dataset.codeId)?.textContent || '';
      const ok = await copyToClipboard(text);
      toast(ok ? 'Copied to clipboard' : 'Copy failed', { type: ok ? 'success' : 'error' });
      return;
    }

    if (e.target.closest('[data-action="copy-secret"]')) {
      const field = e.target.closest('[data-secret-field]');
      const value = field?.dataset.raw || '';
      const ok = await copyToClipboard(value);
      toast(ok ? 'Copied to clipboard' : 'Copy failed', { type: ok ? 'success' : 'error' });
      return;
    }

    if (e.target.closest('[data-action="toggle-secret"]')) {
      const field = e.target.closest('[data-secret-field]');
      const raw = field.dataset.raw || '';
      const revealed = field.classList.toggle('is-revealed');
      field.querySelector('[data-secret-value]').textContent = revealed
        ? raw
        : `${raw.slice(0, 10)}${'•'.repeat(22)}${raw.slice(-4)}`;
      return;
    }

    if (e.target.closest('[data-action="view-record"]')) {
      const recordId = e.target.closest('[data-action="view-record"]').dataset.id;
      openRecordModal({ projectId: project.id, recordId, readOnly: true });
      return;
    }

    if (e.target.closest('[data-action="edit-record"]')) {
      const recordId = e.target.closest('[data-action="edit-record"]').dataset.id;
      openRecordModal({ projectId: project.id, recordId, onSaved: () => refreshRecordsPanel(project.id) });
      return;
    }

    if (e.target.closest('[data-action="delete-record"]')) {
      const recordId = e.target.closest('[data-action="delete-record"]').dataset.id;
      if (await deleteRecordFlow(project.id, recordId)) refreshRecordsPanel(project.id);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Shell                                                              */
/* ------------------------------------------------------------------ */

function shell(project, data, tab) {
  const usage = project.usage || {};
  const paused = project.status !== 'active';

  return `
  <div class="card project-hero" style="margin-bottom:16px">
    <span class="project-hero__mark" style="background:${colorFor(project.id)}">${esc(initials(project.name))}</span>
    <div class="project-hero__main">
      <div class="project-hero__name">
        ${esc(project.name)}
        ${paused ? '<span class="badge badge--gray badge--dot">Paused</span>' : '<span class="badge badge--green badge--dot">Active</span>'}
      </div>
      <div class="project-hero__meta">
        <code>${esc(project.id)}</code>
        <span>${icon('key', { size: 13 })} ${esc(project.keyId || '')}</span>
        <span>${icon('clock', { size: 13 })} Created ${esc(formatDateTime(project.createdAt))}</span>
      </div>
    </div>
    <div class="project-hero__actions">
      <button class="btn btn--secondary btn--sm" data-action="edit-project">${icon('edit', { size: 14 })} Edit</button>
      <button class="btn ${paused ? 'btn--primary' : 'btn--secondary'} btn--sm" data-action="toggle-status">
        ${paused ? icon('play', { size: 14 }) : icon('pause', { size: 14 })} ${paused ? 'Resume' : 'Pause'}
      </button>
      <button class="btn btn--danger-soft btn--sm" data-action="delete-project">${icon('trash', { size: 14 })} Delete</button>
    </div>
  </div>

  <div class="metric-row" style="margin-bottom:18px">
    <div class="metric">
      <div class="metric__label">Records</div>
      <div class="metric__value">${formatNumber(usage.records)}</div>
    </div>
    <div class="metric">
      <div class="metric__label">KV used</div>
      <div class="metric__value">${formatBytes(usage.kvBytes)}</div>
    </div>
    <div class="metric">
      <div class="metric__label">Files</div>
      <div class="metric__value">${formatNumber(usage.files)}</div>
    </div>
    <div class="metric">
      <div class="metric__label">Blob used</div>
      <div class="metric__value">${formatBytes(usage.blobBytes)}</div>
    </div>
  </div>

  <div class="pill-tabs-wrap">
    <div class="tabs" role="tablist">
      <button class="tab ${tab === 'overview' ? 'is-active' : ''}" data-tab="overview">${icon('grid', { size: 14 })} Overview</button>
      <button class="tab ${tab === 'config' ? 'is-active' : ''}" data-tab="config">${icon('key', { size: 14 })} Connection</button>
      <button class="tab ${tab === 'records' ? 'is-active' : ''}" data-tab="records">${icon('database', { size: 14 })} Records</button>
      <button class="tab ${tab === 'files' ? 'is-active' : ''}" data-tab="files">${icon('files', { size: 14 })} Files</button>
      <button class="tab ${tab === 'settings' ? 'is-active' : ''}" data-tab="settings">${icon('settings', { size: 14 })} Settings</button>
    </div>
  </div>

  <div data-panel="overview" class="${tab === 'overview' ? '' : 'hide'}">
    ${overviewPanel(project, data)}
  </div>
  <div data-panel="config" class="${tab === 'config' ? '' : 'hide'}">
    ${configPanel(project, data)}
  </div>
  <div data-panel="records" class="${tab === 'records' ? '' : 'hide'}">
    <div class="card" id="records-panel" data-project="${esc(project.id)}">
      <div class="toolbar">
        <div class="search">
          ${icon('search', { size: 15 })}
          <input class="input" placeholder="Search records…" data-record-search />
        </div>
        <div class="toolbar__filters">
          <select class="select" data-record-type>
            <option value="">All types</option>
            <option value="json">JSON</option>
            <option value="txt">TXT</option>
          </select>
        </div>
        <button class="btn btn--primary btn--sm" data-action="create-record">${icon('plus', { size: 14 })} New</button>
      </div>
      <div data-record-host>
        <div class="loading-block"><span class="spinner"></span></div>
      </div>
    </div>
  </div>
  <div data-panel="files" class="${tab === 'files' ? '' : 'hide'}">
    <div class="card" id="files-panel" data-project="${esc(project.id)}" style="padding:0">
      <div class="dropzone" data-dropzone>
        <div class="dropzone__icon">${icon('upload', { size: 19 })}</div>
        <div class="dropzone__title">Drop files here or click to upload</div>
        <div class="dropzone__desc">Images, PDF, ZIP, audio, video — up to 20 MB per file</div>
        <input type="file" hidden data-file-input multiple />
      </div>
      <div data-file-host>
        <div class="loading-block"><span class="spinner"></span></div>
      </div>
    </div>
  </div>
  <div data-panel="settings" class="${tab === 'settings' ? '' : 'hide'}">
    ${settingsPanel(project)}
  </div>`;
}

function overviewPanel(project, data) {
  const activity = data.activity || [];
  return `
  <div class="dash-grid">
    <div class="card">
      <div class="card__head">
        <div class="grow">
          <div class="card__title">How this project connects</div>
          <div class="card__desc">Two credentials, two very different privilege levels</div>
        </div>
      </div>
      <div class="card__body col gap-12">
        <div class="row gap-12">
          <span class="config-card__icon config-card__icon--user">${icon('globe', { size: 18 })}</span>
          <div class="grow">
            <div class="h3">User Panel — public frontend</div>
            <div class="muted">Can create records and upload files. Cannot read, update, delete or list anything.</div>
          </div>
          <span class="badge badge--blue">write-only</span>
        </div>
        <div class="divider"></div>
        <div class="row gap-12">
          <span class="config-card__icon config-card__icon--admin">${icon('shield', { size: 18 })}</span>
          <div class="grow">
            <div class="h3">Admin Panel — server-side</div>
            <div class="muted">Full read/write/delete inside this project only. Never expose it in a browser.</div>
          </div>
          <span class="badge badge--orange">server-side</span>
        </div>
        <div class="divider"></div>
        <div class="kv-row"><span class="kv-row__key">API base</span><span class="kv-row__val">${esc(data.connection?.user?.apiBase || '')}</span></div>
        <div class="kv-row"><span class="kv-row__key">KV namespace</span><span class="kv-row__val">${esc(project.namespace || '')}</span></div>
        <div class="kv-row"><span class="kv-row__key">Blob folder</span><span class="kv-row__val">${esc(project.id)}/files/</span></div>
        <div class="kv-row"><span class="kv-row__key">Last updated</span><span class="kv-row__val">${esc(timeAgo(project.updatedAt))}</span></div>
      </div>
    </div>

    <div class="card card--pad">
      <div class="section-head">
        <span class="section-head__title">Project activity</span>
      </div>
      <div class="activity">
        ${
          activity.length
            ? activity
                .map(
                  (a) => `
          <div class="activity__row">
            <span class="activity__dot activity__dot--blue">${icon('activity', { size: 14 })}</span>
            <div class="activity__main">
              <div class="activity__text">${esc(a.message)}</div>
              <div class="activity__time">${esc(timeAgo(a.at))}</div>
            </div>
          </div>`,
                )
                .join('')
            : `<div class="muted" style="padding:12px 0">No activity recorded for this project yet.</div>`
        }
      </div>
    </div>
  </div>`;
}

function configPanel(project, data) {
  const conn = data.connection || {};
  const user = conn.user || {};
  const admin = conn.admin || {};

  return `
  <div class="config-grid">
    <div class="card config-card">
      <div class="config-card__head">
        <span class="config-card__icon config-card__icon--user">${icon('globe', { size: 19 })}</span>
        <div class="grow">
          <div class="config-card__title">User Panel Config</div>
          <div class="config-card__desc">Safe to embed in your public frontend</div>
        </div>
        <span class="badge badge--blue">Public</span>
      </div>
      <div class="config-card__body">
        <div class="secret-field" data-secret-field data-raw="${esc(user.token || '')}">
          <code data-secret-value>${esc(mask(user.token || ''))}</code>
          <button class="btn btn--ghost btn--icon" data-action="toggle-secret" title="Show / hide">${icon('eye', { size: 15 })}</button>
          <button class="btn btn--ghost btn--icon" data-action="copy-secret" title="Copy">${icon('copy', { size: 15 })}</button>
        </div>

        <div class="perm-list">
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Data send · store · new records</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>File upload</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>Read existing records</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>Update or delete records</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>Read / list files</span></div>
          <div class="perm-item perm-item--deny">${icon('x', { size: 14 })}<span>Admin operations</span></div>
        </div>

        ${renderCodeBlock({ label: 'POST /api/data', code: user.sampleCurl || '' })}
        ${renderCodeBlock({ label: 'javascript', code: user.sampleFetch || '' })}

        <div class="row gap-8">
          <button class="btn btn--secondary btn--sm grow" data-action="download-env">${icon('download', { size: 14 })} .env</button>
          <button class="btn btn--secondary btn--sm grow" data-action="download-client">${icon('code', { size: 14 })} Client helper</button>
        </div>
        <button class="btn btn--danger-soft btn--sm" data-action="rotate-user">${icon('refresh', { size: 14 })} Rotate user credential</button>
      </div>
    </div>

    <div class="card config-card">
      <div class="config-card__head">
        <span class="config-card__icon config-card__icon--admin">${icon('shield', { size: 19 })}</span>
        <div class="grow">
          <div class="config-card__title">Admin Panel Config</div>
          <div class="config-card__desc">Full data access — server-side only</div>
        </div>
        <span class="badge badge--orange">Secret</span>
      </div>
      <div class="config-card__body">
        <div class="secret-field" data-secret-field data-raw="${esc(admin.token || '')}">
          <code data-secret-value>${esc(mask(admin.token || ''))}</code>
          <button class="btn btn--ghost btn--icon" data-action="toggle-secret" title="Show / hide">${icon('eye', { size: 15 })}</button>
          <button class="btn btn--ghost btn--icon" data-action="copy-secret" title="Copy">${icon('copy', { size: 15 })}</button>
        </div>

        <div class="perm-list">
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Data receive · read · store · update · delete</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>File upload · download · delete</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Scoped to this project only</span></div>
        </div>

        <div class="perm-item perm-item--deny">
          ${icon('alert', { size: 14 })}
          <span>${esc(admin.warning || 'Keep this out of client bundles and public repos.')}</span>
        </div>

        ${renderCodeBlock({ label: 'GET /api/data', code: admin.sampleCurl || '' })}
        <button class="btn btn--danger-soft btn--sm" data-action="rotate-admin">${icon('refresh', { size: 14 })} Rotate admin secret</button>
      </div>
    </div>
  </div>`;
}

function settingsPanel(project) {
  return `
  <div class="settings-grid">
    <div class="card card--pad">
      <div class="section-head"><span class="section-head__title">Project settings</span></div>
      <div class="setting-row">
        <div class="setting-row__main">
          <div class="setting-row__title">User API</div>
          <div class="setting-row__desc">Master switch for the write-only endpoint. Turning this off blocks all public writes.</div>
        </div>
        <div class="setting-row__control">
          <span class="badge ${project.settings?.allowUserApi ? 'badge--green' : 'badge--gray'}">${project.settings?.allowUserApi ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-row__main">
          <div class="setting-row__title">Max record size</div>
          <div class="setting-row__desc">Per-record cap for this project's KV writes.</div>
        </div>
        <div class="setting-row__control"><span class="badge badge--gray">${formatBytes(project.settings?.maxRecordBytes || 0)}</span></div>
      </div>
      <div class="setting-row">
        <div class="setting-row__main">
          <div class="setting-row__title">User writes per minute</div>
          <div class="setting-row__desc">Fixed-window rate limit applied per project and client.</div>
        </div>
        <div class="setting-row__control"><span class="badge badge--gray">${project.settings?.userWritesPerMinute || 60}/min</span></div>
      </div>
      <div class="setting-row">
        <div class="setting-row__main">
          <div class="setting-row__title">JSON only for user API</div>
          <div class="setting-row__desc">When enabled, TXT records can only be written by admins.</div>
        </div>
        <div class="setting-row__control">
          <span class="badge ${project.settings?.requireJsonForUser ? 'badge--green' : 'badge--gray'}">${project.settings?.requireJsonForUser ? 'On' : 'Off'}</span>
        </div>
      </div>
      <div class="mt-16">
        <button class="btn btn--secondary btn--sm" data-action="edit-project">${icon('edit', { size: 14 })} Edit settings</button>
      </div>
    </div>

    <div class="card danger-zone">
      <div class="danger-zone__head">
        <div class="danger-zone__title">Danger zone</div>
      </div>
      <div class="card__body">
        <div class="setting-row__desc" style="margin-bottom:12px">
          Deleting this project revokes both credentials immediately. You can choose whether the stored records and
          files are removed too, and you must type the project name to confirm.
        </div>
        <button class="btn btn--danger btn--sm btn--block" data-action="delete-project">${icon('trash', { size: 14 })} Delete project</button>
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Data loading                                                       */
/* ------------------------------------------------------------------ */

function wire(ctx, project, data) {
  refreshRecordsPanel(project.id);
  refreshFilesPanel(project.id);

  const content = document.getElementById('page-content');

  const search = content.querySelector('[data-record-search]');
  const typeSelect = content.querySelector('[data-record-type]');
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => refreshRecordsPanel(project.id), 220);
  };
  search?.addEventListener('input', schedule);
  typeSelect?.addEventListener('change', () => refreshRecordsPanel(project.id));

  // Files: upload zone
  const dropzone = content.querySelector('[data-dropzone]');
  const fileInput = content.querySelector('[data-file-input]');
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      uploadMany(project.id, Array.from(fileInput.files || []));
      fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add('is-over');
      }),
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-over');
      }),
    );
    dropzone.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) uploadMany(project.id, files);
    });
  }
}

export async function refreshRecordsPanel(projectId) {
  const host = document.querySelector('[data-record-host]');
  if (!host) return;
  const content = document.getElementById('page-content');
  const q = content?.querySelector('[data-record-search]')?.value || '';
  const type = content?.querySelector('[data-record-type]')?.value || '';

  try {
    const result = await listRecords(projectId, { q, type, limit: 10 });
    host.innerHTML = renderRecordsTable({
      records: result.records,
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      projectId,
    });
  } catch (error) {
    host.innerHTML = `<div class="empty"><div class="empty__title">Could not load records</div><div class="empty__desc">${esc(error.message)}</div></div>`;
  }
}

export async function refreshFilesPanel(projectId) {
  const host = document.querySelector('[data-file-host]');
  if (!host) return;
  try {
    const result = await listFiles(projectId, { limit: 24 });
    if (!result.files.length) {
      host.innerHTML = `
        <div class="empty">
          <div class="empty__art">${icon('image', { size: 24 })}</div>
          <div class="empty__title">No files yet</div>
          <div class="empty__desc">Upload images, PDFs, archives, audio or video. Files are stored in Blob storage under this project's folder.</div>
        </div>`;
      return;
    }
    host.innerHTML = `<div class="file-grid">${result.files.map(renderFileTile).join('')}</div>`;
    host.dataset.total = String(result.total);
  } catch (error) {
    host.innerHTML = `<div class="empty"><div class="empty__title">Could not load files</div><div class="empty__desc">${esc(error.message)}</div></div>`;
  }
}

async function uploadMany(projectId, files) {
  let ok = 0;

  for (const file of files) {
    const problem = validateFile(file);
    if (problem) {
      toast(problem, { type: 'error' });
      continue;
    }
    try {
      await uploadFile(projectId, file);
      ok += 1;
    } catch (error) {
      toast(formatUploadError(error), { type: 'error' });
    }
  }

  if (ok) {
    toast(`${ok} file${ok > 1 ? 's' : ''} uploaded`, { type: 'success' });
    refreshFilesPanel(projectId);
    window.dispatchEvent(new CustomEvent('app:refresh-projects-stats'));
  }
}

/* ------------------------------------------------------------------ */
/* Edit project                                                       */
/* ------------------------------------------------------------------ */

function openEditProjectModal(ctx, project) {
  openModal({
    title: 'Edit project',
    body: `
      <div class="field">
        <label class="field__label">Project name</label>
        <input class="input" data-name value="${esc(project.name)}" maxlength="60" autofocus />
        <div class="field__error hide" data-name-error></div>
      </div>
      <div class="field">
        <label class="field__label">Description</label>
        <textarea class="textarea" data-desc maxlength="200">${esc(project.description || '')}</textarea>
      </div>
      <div class="setting-row">
        <div class="setting-row__main">
          <div class="setting-row__title">User API enabled</div>
          <div class="setting-row__desc">Allow write-only requests from your public frontend.</div>
        </div>
        <div class="setting-row__control">
          <label class="switch">
            <input type="checkbox" data-allow-user ${project.settings?.allowUserApi ? 'checked' : ''} />
            <span class="switch__track"></span>
          </label>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-row__main">
          <div class="setting-row__title">JSON only for user API</div>
          <div class="setting-row__desc">Reject TXT writes that come from the public credential.</div>
        </div>
        <div class="setting-row__control">
          <label class="switch">
            <input type="checkbox" data-json-only ${project.settings?.requireJsonForUser ? 'checked' : ''} />
            <span class="switch__track"></span>
          </label>
        </div>
      </div>
      <div class="field">
        <label class="field__label">User writes per minute</label>
        <input class="input" type="number" min="1" max="600" data-rate value="${project.settings?.userWritesPerMinute || 60}" />
        <div class="field__hint">Abuse protection for the public write endpoint (1–600).</div>
      </div>`,
    footer: `
      <button class="btn btn--secondary" data-cancel>Cancel</button>
      <button class="btn btn--primary" data-save>Save changes</button>`,
    onMount(modal) {
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('[data-save]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const name = modal.querySelector('[data-name]').value.trim();
        const problem = validateProjectName(name);
        const errBox = modal.querySelector('[data-name-error]');
        if (problem) {
          errBox.textContent = problem;
          errBox.classList.remove('hide');
          return;
        }
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner spinner--white"></span> Saving…`;
        try {
          await updateProject(project.id, {
            name,
            description: modal.querySelector('[data-desc]').value.trim(),
            settings: {
              allowUserApi: modal.querySelector('[data-allow-user]').checked,
              requireJsonForUser: modal.querySelector('[data-json-only]').checked,
              userWritesPerMinute: Number(modal.querySelector('[data-rate]').value) || 60,
            },
          });
          closeModal();
          await ctx.refreshProjects();
          toast('Project updated', { type: 'success' });
          const { renderRoute } = await import('../app.js');
          ctx.navigate(`/projects/${project.id}`);
          setTimeout(() => renderRoute(), 40);
        } catch (error) {
          toast(error.message || 'Update failed', { type: 'error' });
          btn.disabled = false;
          btn.textContent = 'Save changes';
        }
      });
    },
  });
}

function mask(value) {
  const s = String(value || '');
  if (s.length <= 14) return '•'.repeat(Math.max(8, s.length));
  return `${s.slice(0, 10)}${'•'.repeat(22)}${s.slice(-4)}`;
}
