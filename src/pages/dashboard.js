/**
 * Dashboard — totals, storage meters, project cards, recent activity.
 */

import { getStats } from '../services/project-service.js';
import { renderStat, renderMeter, renderSkeletonRow } from '../components/storage-card.js';
import { renderProjectCard, renderProjectSlot } from '../components/project-card.js';
import { icon } from '../components/icons.js';
import { esc, formatBytes, formatNumber, timeAgo } from '../utils/helpers.js';

const KV_REFERENCE_BYTES = 25 * 1024 * 1024;      // EdgeOne KV per-value ceiling
const BLOB_REFERENCE_BYTES = 1024 * 1024 * 1024;  // 1 GB planning reference

export async function renderDashboard(ctx) {
  ctx.setHeader({
    title: 'Dashboard',
    subtitle: 'Storage health, projects and recent activity',
    actions: `
      <button class="btn btn--secondary btn--sm" data-action="refresh-dashboard">
        ${icon('refresh', { size: 15 })} Refresh
      </button>
      <button class="btn btn--primary btn--sm" data-action="create-project" data-page-handled="1">
        ${icon('plus', { size: 15 })} New project
      </button>`,
  });

  ctx.renderContent(`
    <div class="stat-grid" id="stat-grid">
      ${renderStatSkeleton()}
    </div>
    <div class="card card--pad" style="margin-bottom:20px">
      <div class="row gap-12">${renderSkeletonRow(1)}</div>
    </div>`);

  const content = document.getElementById('page-content');

  try {
    const stats = await getStats();
    ctx.projects = stats.projects;
    paint(ctx, content, stats);
  } catch (error) {
    content.innerHTML = errorCard(error);
    return;
  }

  content.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-project-id]');
    if (card && !e.target.closest('button')) {
      ctx.navigate(`/projects/${card.dataset.projectId}`);
      return;
    }

    if (e.target.closest('[data-action="create-project"]')) {
      window.dispatchEvent(new CustomEvent('app:create-project'));
      return;
    }

    if (e.target.closest('[data-action="refresh-dashboard"]')) {
      await renderDashboard(ctx);
      return;
    }

    if (e.target.closest('[data-action="view-all-projects"]')) {
      ctx.navigate('/projects');
    }
  });
}

function paint(ctx, content, stats) {
  const projectCount = stats.totalProjects || 0;
  const canCreate = projectCount < (stats.maxProjects || 2);
  const kvBytes = stats.kv?.usedBytes || 0;
  const blobBytes = stats.blob?.usedBytes || 0;
  const totalRecords = stats.kv?.records || 0;
  const totalFiles = stats.blob?.files || 0;

  content.innerHTML = `
    <div class="stat-grid">
      ${renderStat({
        label: 'Total projects',
        value: String(projectCount),
        suffix: ` / ${stats.maxProjects}`,
        iconName: 'projects',
        tone: 'blue',
        foot: `<span class="badge badge--blue badge--dot">${stats.activeProjects} active</span>`,
      })}
      ${renderStat({
        label: 'Stored records',
        value: formatNumber(totalRecords),
        iconName: 'database',
        tone: 'green',
        foot: `<span>${renderMeterMini(kvBytes)}</span>`,
      })}
      ${renderStat({
        label: 'Uploaded files',
        value: formatNumber(totalFiles),
        iconName: 'files',
        tone: 'purple',
        foot: `<span>${esc(formatBytes(blobBytes))} in Blob storage</span>`,
      })}
      ${renderStat({
        label: 'Total storage used',
        value: formatBytes(kvBytes + blobBytes),
        iconName: 'server',
        tone: 'orange',
        foot: `<span>KV ${esc(formatBytes(kvBytes))} · Blob ${esc(formatBytes(blobBytes))}</span>`,
      })}
    </div>

    <div class="storage-panel">
      ${renderMeter({
        title: 'KV Storage',
        sub: 'TXT + JSON records, project settings, metadata',
        usedBytes: kvBytes,
        capBytes: KV_REFERENCE_BYTES,
        count: totalRecords,
        countLabel: 'Records',
        tone: 'blue',
        iconName: 'database',
        segments: [
          { label: 'Records', value: formatNumber(totalRecords), color: '#007aff' },
          { label: 'Per-value ceiling', value: '25 MB', color: '#cfe4ff' },
        ],
      })}
      ${renderMeter({
        title: 'Blob Storage',
        sub: 'Images, PDF, ZIP, audio, video, large JSON',
        usedBytes: blobBytes,
        capBytes: BLOB_REFERENCE_BYTES,
        count: totalFiles,
        countLabel: 'Files',
        tone: 'indigo',
        iconName: 'files',
        segments: [
          { label: 'Files', value: formatNumber(totalFiles), color: '#5856d6' },
          { label: 'Max per file', value: '20 MB', color: '#e4e2ff' },
        ],
      })}
    </div>

    <div class="dash-grid">
      <section>
        <div class="section-head">
          <span class="section-head__title">Projects</span>
          <span class="badge badge--gray">${projectCount} of ${stats.maxProjects}</span>
          <button class="section-head__more" data-action="view-all-projects">View all</button>
        </div>
        <div class="project-grid">
          ${stats.projects.map(renderProjectCard).join('')}
          ${renderProjectSlot({ disabled: !canCreate })}
        </div>
      </section>

      <section>
        <div class="section-head">
          <span class="section-head__title">Recent activity</span>
        </div>
        <div class="card card--pad">
          <div class="activity">
            ${stats.recentActivity?.length ? stats.recentActivity.map(renderActivityRow).join('') : emptyActivity()}
          </div>
        </div>
      </section>
    </div>`;
}

function renderMeterMini(bytes) {
  return `<span class="muted">${esc(formatBytes(bytes))} used</span>`;
}

function renderActivityRow(entry) {
  const map = {
    'project.create': { iconName: 'projects', tone: 'blue' },
    'project.update': { iconName: 'edit', tone: 'blue' },
    'project.delete': { iconName: 'trash', tone: 'red' },
    'project.rotate': { iconName: 'refresh', tone: 'orange' },
    'data.create': { iconName: 'plus', tone: 'green' },
    'data.update': { iconName: 'edit', tone: 'blue' },
    'data.delete': { iconName: 'trash', tone: 'red' },
    'files.upload': { iconName: 'upload', tone: 'green' },
    'files.delete': { iconName: 'trash', tone: 'red' },
    'auth.login': { iconName: 'lock', tone: 'orange' },
  };
  const meta = map[entry.action] || { iconName: 'activity', tone: '' };

  return `
  <div class="activity__row">
    <span class="activity__dot ${meta.tone ? `activity__dot--${meta.tone}` : ''}">${icon(meta.iconName, { size: 15 })}</span>
    <div class="activity__main">
      <div class="activity__text">${esc(entry.message || entry.action)}</div>
      <div class="activity__time">
        ${entry.projectName ? `${esc(entry.projectName)} · ` : ''}${esc(timeAgo(entry.at))}
      </div>
    </div>
  </div>`;
}

function emptyActivity() {
  return `
  <div class="empty" style="padding:28px 12px">
    <div class="empty__art" style="width:44px;height:44px;border-radius:14px">${icon('activity', { size: 20 })}</div>
    <div class="empty__title">No activity yet</div>
    <div class="empty__desc">Records and uploads will show up here as they arrive.</div>
  </div>`;
}

function renderStatSkeleton() {
  return Array.from({ length: 4 })
    .map(
      () => `
    <div class="card stat">
      <div class="stat__top"><div class="skeleton" style="width:34px;height:34px;border-radius:10px"></div></div>
      <div>
        <div class="skeleton" style="height:10px;width:56%;margin-bottom:9px"></div>
        <div class="skeleton" style="height:24px;width:38%"></div>
      </div>
    </div>`,
    )
    .join('');
}

function errorCard(error) {
  return `
  <div class="card card--pad">
    <div class="row gap-12">
      <span class="stat__icon stat__icon--orange">${icon('alert', { size: 18 })}</span>
      <div>
        <div class="h3">Dashboard data unavailable</div>
        <div class="sub mt-4">${esc(error.message || 'Request failed')}</div>
      </div>
    </div>
  </div>`;
}
