/**
 * Records table (desktop) that collapses into cards on phones via
 * the `.table--stack` CSS. Includes empty state + pagination.
 */

import { esc, formatBytes, timeAgo, truncateMiddle } from '../utils/helpers.js';
import { icon } from './icons.js';
import { renderEmpty } from './storage-card.js';

export function renderRecordsTable({ records, total, offset, limit, projectId }) {
  if (!records.length) {
    return renderEmpty({
      iconName: 'database',
      title: 'No records yet',
      desc: 'Records arrive here when your external project posts JSON or TXT data, or create one yourself.',
      actionLabel: 'New record',
      actionAttr: 'data-action="create-record"',
    });
  }

  const rows = records
    .map(
      (r) => `
    <tr data-record-id="${esc(r.id)}">
      <td>
        <div class="row gap-8">
          <span class="type-tag type-tag--${esc(r.type)}">${esc(r.type)}</span>
          <div class="grow" style="min-width:0">
            <div class="record-key truncate">${esc(r.key || 'untitled')}</div>
            <div class="record-preview">${esc(r.preview || '')}</div>
          </div>
        </div>
      </td>
      <td class="nowrap"><span class="badge badge--gray">${esc(r.kind || 'other')}</span></td>
      <td class="nowrap mono">${esc(formatBytes(r.size))}</td>
      <td class="nowrap muted">${esc(timeAgo(r.createdAt))}</td>
      <td data-label="actions">
        <div class="table__actions">
          <button class="btn btn--ghost btn--sm btn--icon" data-action="view-record" data-id="${esc(r.id)}" title="View">${icon('eye', { size: 15 })}</button>
          <button class="btn btn--ghost btn--sm btn--icon" data-action="edit-record" data-id="${esc(r.id)}" title="Edit">${icon('edit', { size: 15 })}</button>
          <button class="btn btn--ghost btn--sm btn--icon" data-action="delete-record" data-id="${esc(r.id)}" title="Delete" style="color:var(--red)">${icon('trash', { size: 15 })}</button>
        </div>
      </td>
    </tr>`,
    )
    .join('');

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return `
  <div class="table-wrap">
    <table class="table table--stack">
      <thead>
        <tr>
          <th>Record</th>
          <th>Kind</th>
          <th>Size</th>
          <th>Created</th>
          <th style="text-align:right">Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="pagination">
    <span>Showing <b>${from}–${to}</b> of <b>${total}</b></span>
    <div class="pagination__pages">
      <button class="btn btn--secondary btn--sm" data-action="page-prev" ${hasPrev ? '' : 'disabled'}>${icon('arrowLeft', { size: 14 })} Prev</button>
      <button class="btn btn--secondary btn--sm" data-action="page-next" ${hasNext ? '' : 'disabled'}>Next ${icon('arrowRight', { size: 14 })}</button>
    </div>
  </div>`;
}

export function renderFileTile(file) {
  const kind = file.type?.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'file';
  const thumb =
    kind === 'image' && file.previewUrl
      ? `<img src="${file.previewUrl}" alt="${esc(file.name)}" loading="lazy">`
      : `<span class="file-tile__ext">${esc(file.ext || 'file')}</span>`;

  return `
  <div class="file-tile" data-file-id="${esc(file.id)}" title="${esc(file.name)}">
    <div class="file-tile__thumb">${thumb}</div>
    <div class="file-tile__actions">
      <button class="btn btn--sm btn--icon" data-action="download-file" data-id="${esc(file.id)}" title="Download">${icon('download', { size: 14 })}</button>
      <button class="btn btn--sm btn--icon" data-action="delete-file" data-id="${esc(file.id)}" title="Delete" style="color:var(--red)">${icon('trash', { size: 14 })}</button>
    </div>
    <div class="file-tile__meta">
      <div class="file-tile__name">${esc(file.name)}</div>
      <div class="file-tile__size">${esc(formatBytes(file.size))} · ${esc(timeAgo(file.uploadedAt))}</div>
    </div>
  </div>`;
}

export function renderRecordsSkeleton(rows = 5) {
  return `
  <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
    ${Array.from({ length: rows })
      .map(
        () => `<div class="row gap-12">
          <div class="skeleton" style="width:42px;height:22px;border-radius:7px"></div>
          <div class="grow">
            <div class="skeleton" style="height:11px;width:42%;margin-bottom:6px"></div>
            <div class="skeleton" style="height:9px;width:66%"></div>
          </div>
        </div>`,
      )
      .join('')}
  </div>`;
}

export { truncateMiddle };
