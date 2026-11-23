/**
 * Storage manager — records and files for any project.
 * Also exports the record create/edit/view modal used elsewhere.
 */

import { listRecords, getRecord, createRecord, updateRecord, deleteRecord } from '../services/kv-service.js';
import { listFiles, uploadFile, deleteFile, downloadFile, formatUploadError } from '../services/blob-service.js';
import { renderRecordsTable, renderFileTile, renderRecordsSkeleton } from '../components/data-table.js';
import { renderEmpty, renderMeter } from '../components/storage-card.js';
import { closeModal, confirmDialog, openModal, toast } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { esc, formatBytes, formatDateTime, formatNumber, prettifyJsonSafe, safeParse, timeAgo } from '../utils/helpers.js';
import { validateRecordDraft, validateFile } from '../utils/validators.js';
import { RECORD_KINDS } from '../../server/core.js';

const PAGE_SIZE = 10;
let current = { projectId: null, tab: 'records', offset: 0, q: '', type: '' };

export async function renderStorage(ctx) {
  ctx.setHeader({
    title: 'Storage',
    subtitle: 'Browse and manage records and files per project',
    actions: `
      <button class="btn btn--secondary btn--sm" data-action="refresh-storage">${icon('refresh', { size: 15 })} Refresh</button>`,
  });

  if (!ctx.projects.length) {
    ctx.renderContent(`
      <div class="card">
        ${renderEmpty({
          iconName: 'database',
          title: 'Nothing stored yet',
          desc: 'Create a project first — records and files live inside a project namespace.',
          actionLabel: 'Go to projects',
          actionAttr: 'data-action="go-projects"',
        })}
      </div>`);
    document.getElementById('page-content').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="go-projects"]')) ctx.navigate('/projects');
    });
    return;
  }

  const selectedId = ctx.params.projectId || current.projectId || ctx.projects[0].id;
  current.projectId = ctx.projects.some((p) => p.id === selectedId) ? selectedId : ctx.projects[0].id;
  current.offset = 0;

  ctx.renderContent(`
    <div class="card card--pad" style="margin-bottom:16px">
      <div class="row gap-12 row--wrap">
        <div class="field grow" style="min-width:200px">
          <label class="field__label">Project</label>
          <select class="select" data-project-select>
            ${ctx.projects
              .map((p) => `<option value="${esc(p.id)}" ${p.id === current.projectId ? 'selected' : ''}>${esc(p.name)} — ${esc(p.id)}</option>`)
              .join('')}
          </select>
        </div>
        <div class="field" style="min-width:150px">
          <label class="field__label">View</label>
          <div class="tabs">
            <button class="tab ${current.tab === 'records' ? 'is-active' : ''}" data-storage-tab="records">${icon('database', { size: 14 })} Records</button>
            <button class="tab ${current.tab === 'files' ? 'is-active' : ''}" data-storage-tab="files">${icon('files', { size: 14 })} Files</button>
          </div>
        </div>
      </div>
    </div>
    <div id="storage-host">
      <div class="card card--pad"><div class="loading-block"><span class="spinner"></span></div></div>
    </div>`);

  const content = document.getElementById('page-content');

  content.querySelector('[data-project-select]')?.addEventListener('change', (e) => {
    current.projectId = e.target.value;
    current.offset = 0;
    current.q = '';
    refresh(ctx);
  });

  content.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('[data-storage-tab]');
    if (tabBtn) {
      current.tab = tabBtn.dataset.storageTab;
      content.querySelectorAll('[data-storage-tab]').forEach((b) => b.classList.toggle('is-active', b === tabBtn));
      refresh(ctx);
      return;
    }

    if (e.target.closest('[data-action="refresh-storage"]')) {
      refresh(ctx);
      return;
    }

    if (e.target.closest('[data-action="create-record"]')) {
      openRecordModal({ projectId: current.projectId, onSaved: () => refresh(ctx) });
      return;
    }

    const viewBtn = e.target.closest('[data-action="view-record"]');
    if (viewBtn) {
      openRecordModal({ projectId: current.projectId, recordId: viewBtn.dataset.id, readOnly: true });
      return;
    }

    const editBtn = e.target.closest('[data-action="edit-record"]');
    if (editBtn) {
      openRecordModal({ projectId: current.projectId, recordId: editBtn.dataset.id, onSaved: () => refresh(ctx) });
      return;
    }

    const delBtn = e.target.closest('[data-action="delete-record"]');
    if (delBtn) {
      if (await deleteRecordFlow(current.projectId, delBtn.dataset.id)) refresh(ctx);
      return;
    }

    if (e.target.closest('[data-action="page-prev"]')) {
      current.offset = Math.max(0, current.offset - PAGE_SIZE);
      refresh(ctx);
      return;
    }
    if (e.target.closest('[data-action="page-next"]')) {
      current.offset += PAGE_SIZE;
      refresh(ctx);
      return;
    }

    const downloadBtn = e.target.closest('[data-action="download-file"]');
    if (downloadBtn) {
      const file = (downloadedFiles.get(downloadBtn.dataset.id));
      if (file) {
        try {
          await downloadFile(current.projectId, file);
        } catch (error) {
          toast(error.message || 'Download failed', { type: 'error' });
        }
      }
      return;
    }

    const fileDelBtn = e.target.closest('[data-action="delete-file"]');
    if (fileDelBtn) {
      const ok = await confirmDialog({
        title: 'Delete this file?',
        description: 'The file is removed from Blob storage immediately.',
        confirmLabel: 'Delete file',
        danger: true,
      });
      if (ok) {
        try {
          await deleteFile(current.projectId, fileDelBtn.dataset.id);
          toast('File deleted', { type: 'success' });
          refresh(ctx);
        } catch (error) {
          toast(error.message || 'Delete failed', { type: 'error' });
        }
      }
    }
  });

  refresh(ctx);
}

const downloadedFiles = new Map();

async function refresh(ctx) {
  const host = document.getElementById('storage-host');
  if (!host) return;
  host.innerHTML = `<div class="card">${renderRecordsSkeleton(4)}</div>`;

  try {
    if (current.tab === 'records') {
      const result = await listRecords(current.projectId, {
        q: current.q,
        type: current.type,
        limit: PAGE_SIZE,
        offset: current.offset,
      });
      host.innerHTML = `
        <div class="card" style="margin-bottom:16px">
          <div class="toolbar">
            <div class="search">
              ${icon('search', { size: 15 })}
              <input class="input" placeholder="Search records…" data-storage-search value="${esc(current.q)}" />
            </div>
            <div class="toolbar__filters">
              <select class="select" data-storage-type>
                <option value="">All types</option>
                <option value="json" ${current.type === 'json' ? 'selected' : ''}>JSON</option>
                <option value="txt" ${current.type === 'txt' ? 'selected' : ''}>TXT</option>
              </select>
            </div>
            <button class="btn btn--primary btn--sm" data-action="create-record">${icon('plus', { size: 14 })} New</button>
          </div>
          ${renderRecordsTable({ ...result, projectId: current.projectId })}
        </div>`;

      const search = host.querySelector('[data-storage-search]');
      let timer = null;
      search?.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          current.q = search.value;
          current.offset = 0;
          refresh(ctx);
          document.querySelector('[data-storage-search]')?.focus();
        }, 240);
      });
      host.querySelector('[data-storage-type]')?.addEventListener('change', (e) => {
        current.type = e.target.value;
        current.offset = 0;
        refresh(ctx);
      });
      return;
    }

    // Files tab
    const result = await listFiles(current.projectId, { limit: 100 });
    downloadedFiles.clear();
    result.files.forEach((f) => downloadedFiles.set(f.id, f));

    host.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card__head">
          <div class="grow">
            <div class="card__title">Files</div>
            <div class="card__desc">${formatNumber(result.total)} files · ${formatBytes(result.totalBytes)} in Blob storage</div>
          </div>
          <label class="btn btn--primary btn--sm">
            ${icon('upload', { size: 14 })} Upload
            <input type="file" hidden multiple data-storage-file-input />
          </label>
        </div>
        ${
          result.files.length
            ? `<div class="file-grid">${result.files.map(renderFileTile).join('')}</div>`
            : `<div class="empty">
                 <div class="empty__art">${icon('image', { size: 24 })}</div>
                 <div class="empty__title">No files in this project</div>
                 <div class="empty__desc">Upload images, documents, archives or media. Each file is stored under this project's blob folder.</div>
               </div>`
        }
      </div>
      <div class="storage-panel">
        ${renderMeter({
          title: 'Blob usage',
          sub: 'Files stored for this project',
          usedBytes: result.totalBytes,
          capBytes: 1024 * 1024 * 1024,
          count: result.total,
          countLabel: 'Files',
          tone: 'indigo',
          iconName: 'files',
        })}
        ${renderMeter({
          title: 'File mix',
          sub: 'Distribution by type',
          usedBytes: result.totalBytes,
          capBytes: 1024 * 1024 * 1024,
          count: result.total,
          countLabel: 'Files',
          tone: 'green',
          iconName: 'image',
          segments: [
            { label: 'Images', value: result.folders.image, color: '#007aff' },
            { label: 'PDF', value: result.folders.pdf, color: '#ff9500' },
            { label: 'Audio/Video', value: result.folders.audio + result.folders.video, color: '#af52de' },
            { label: 'Other', value: result.folders.other + result.folders.archive, color: '#c7cbd4' },
          ],
        })}
      </div>`;

    const input = host.querySelector('[data-storage-file-input]');
    input?.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      let ok = 0;
      for (const file of files) {
        const problem = validateFile(file);
        if (problem) {
          toast(problem, { type: 'error' });
          continue;
        }
        try {
          await uploadFile(current.projectId, file);
          ok += 1;
        } catch (error) {
          toast(formatUploadError(error), { type: 'error' });
        }
      }
      if (ok) {
        toast(`${ok} file${ok > 1 ? 's' : ''} uploaded`, { type: 'success' });
        refresh(ctx);
      }
    });
  } catch (error) {
    host.innerHTML = `<div class="card card--pad"><div class="h3">Could not load storage</div><div class="sub mt-4">${esc(error.message)}</div></div>`;
  }
}

/* ------------------------------------------------------------------ */
/* Record modal (view / create / edit)                                */
/* ------------------------------------------------------------------ */

export function openRecordModal({ projectId, recordId = null, readOnly = false, onSaved }) {
  const isEdit = Boolean(recordId);
  const id = `rec-${Math.random().toString(36).slice(2, 8)}`;

  const loadingBody = `<div class="loading-block"><span class="spinner"></span></div>`;

  const { el } = openModal({
    title: isEdit ? 'Record' : 'New record',
    description: isEdit ? recordId : 'Store a JSON object or a plain-text snippet.',
    size: 'wide',
    body: loadingBody,
    footer: `
      <button class="btn btn--secondary" data-cancel>Close</button>
      ${readOnly ? '' : `<button class="btn btn--primary" data-save>${isEdit ? 'Save changes' : 'Create record'}</button>`}`,
    onMount(modal) {
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      if (isEdit) load(modal);
      else mountForm(modal, { type: 'json', kind: 'other', key: '', content: '' });
    },
  });

  async function load(modal) {
    try {
      const { record } = await getRecord(projectId, recordId);
      mountForm(modal, record, readOnly);
    } catch (error) {
      modal.querySelector('.modal__body').innerHTML = `<div class="empty"><div class="empty__title">Could not load record</div><div class="empty__desc">${esc(error.message)}</div></div>`;
    }
  }

  function mountForm(modal, record, locked = false) {
    const body = modal.querySelector('.modal__body');
    const typeValue = record.type || 'json';
    const contentValue =
      typeValue === 'json'
        ? typeof record.content === 'string'
          ? prettifyJsonSafe(record.content)
          : JSON.stringify(record.content, null, 2)
        : String(record.content ?? '');

    body.innerHTML = `
      ${locked ? `<div class="row gap-8" style="margin-bottom:4px">
        <span class="type-tag type-tag--${esc(typeValue)}">${esc(typeValue)}</span>
        <span class="badge badge--gray">${esc(record.kind || 'other')}</span>
        <span class="muted">v${esc(String(record.version || 1))} · ${esc(formatDateTime(record.updatedAt || record.createdAt))}</span>
      </div>` : ''}
      <div class="row gap-8">
        <div class="field grow">
          <label class="field__label">Type</label>
          <select class="select" data-type ${locked ? 'disabled' : ''}>
            <option value="json" ${typeValue === 'json' ? 'selected' : ''}>JSON</option>
            <option value="txt" ${typeValue === 'txt' ? 'selected' : ''}>TXT</option>
          </select>
        </div>
        <div class="field grow">
          <label class="field__label">Kind</label>
          <select class="select" data-kind ${locked ? 'disabled' : ''}>
            ${RECORD_KINDS.map((k) => `<option value="${k}" ${record.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label class="field__label">Key <span class="muted">optional label, e.g. contact-form</span></label>
        <input class="input" data-key value="${esc(record.key || '')}" placeholder="contact-form" ${locked ? 'disabled' : ''} />
      </div>
      <div class="field">
        <label class="field__label" data-content-label>${typeValue === 'json' ? 'JSON content' : 'Text content'}</label>
        <textarea class="textarea textarea--code" data-content rows="12" spellcheck="false">${esc(contentValue)}</textarea>
        <div class="row row--between">
          <div class="field__error hide" data-content-error></div>
          <div class="muted" data-size-hint></div>
        </div>
      </div>
      ${
        locked
          ? `<div class="field">
              <label class="field__label">Record metadata</label>
              ${renderCodeBlockObj({ id: record.id, projectId: record.projectId, source: record.source, createdAt: record.createdAt, tags: record.tags })}
            </div>`
          : ''
      }`;

    const typeEl = body.querySelector('[data-type]');
    const contentEl = body.querySelector('[data-content]');
    const errorEl = body.querySelector('[data-content-error]');
    const sizeHint = body.querySelector('[data-size-hint]');

    const refreshHint = () => {
      const bytes = new Blob([contentEl.value]).size;
      sizeHint.textContent = `${formatBytes(bytes)} · limit 2 MB`;
    };
    contentEl.addEventListener('input', refreshHint);
    refreshHint();

    typeEl?.addEventListener('change', () => {
      body.querySelector('[data-content-label]').textContent =
        typeEl.value === 'json' ? 'JSON content' : 'Text content';
      if (typeEl.value === 'json') contentEl.value = prettifyJsonSafe(contentEl.value);
    });

    const saveBtn = modal.querySelector('[data-save]');
    if (!saveBtn || locked) return;

    saveBtn.addEventListener('click', async () => {
      const type = typeEl.value;
      const content = contentEl.value;
      const problem = validateRecordDraft({ type, content });
      if (problem) {
        errorEl.textContent = problem;
        errorEl.classList.remove('hide');
        contentEl.focus();
        return;
      }
      errorEl.classList.add('hide');
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="spinner spinner--white"></span> Saving…`;
      try {
        const payload = {
          type,
          kind: body.querySelector('[data-kind]').value,
          key: body.querySelector('[data-key]').value.trim(),
          content,
        };
        if (isEdit) await updateRecord(projectId, recordId, payload);
        else await createRecord(projectId, payload);
        closeModal();
        toast(isEdit ? 'Record updated' : 'Record created', { type: 'success' });
        onSaved?.();
      } catch (error) {
        errorEl.textContent = error.message || 'Save failed';
        errorEl.classList.remove('hide');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Save changes' : 'Create record';
      }
    });
  }

  return { el };
}

export async function deleteRecordFlow(projectId, recordId) {
  const ok = await confirmDialog({
    title: 'Delete this record?',
    description: 'The KV entry is removed immediately. This cannot be undone.',
    confirmLabel: 'Delete record',
    danger: true,
  });
  if (!ok) return false;
  try {
    await deleteRecord(projectId, recordId);
    toast('Record deleted', { type: 'success' });
    return true;
  } catch (error) {
    toast(error.message || 'Delete failed', { type: 'error' });
    return false;
  }
}

function renderCodeBlockObj(obj) {
  return `<pre class="code">${esc(JSON.stringify(obj, null, 2))}</pre>`;
}
