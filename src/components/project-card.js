/**
 * Project cards + the "create project" slot.
 */

import { colorFor, esc, formatBytes, formatNumber, initials, timeAgo } from '../utils/helpers.js';
import { icon } from './icons.js';

export function renderProjectCard(project) {
  const statusBadge =
    project.status === 'active'
      ? '<span class="badge badge--green badge--dot">Active</span>'
      : '<span class="badge badge--gray badge--dot">Paused</span>';

  return `
  <article class="card card--hover project-card" data-project-id="${esc(project.id)}" tabindex="0" role="button"
    aria-label="Open ${esc(project.name)}">
    <div class="project-card__head">
      <span class="project-card__mark" style="background:${colorFor(project.id)}">${esc(initials(project.name))}</span>
      <div class="grow">
        <div class="project-card__name">${esc(project.name)}</div>
        <div class="project-card__id">${esc(project.id)}</div>
      </div>
      ${statusBadge}
    </div>

    <div class="project-card__stats">
      <div class="project-card__stat">
        <b>${esc(formatNumber(project.usage?.records || 0))}</b>
        <span>Records</span>
      </div>
      <div class="project-card__stat">
        <b>${esc(formatNumber(project.usage?.files || 0))}</b>
        <span>Files</span>
      </div>
      <div class="project-card__stat">
        <b>${esc(formatBytes((project.usage?.kvBytes || 0) + (project.usage?.blobBytes || 0)))}</b>
        <span>Storage</span>
      </div>
    </div>

    <div class="project-card__foot">
      <span class="muted">Updated ${esc(timeAgo(project.updatedAt))}</span>
      <span class="project-card__open">Manage ${icon('chevronRight', { size: 14 })}</span>
    </div>
  </article>`;
}

export function renderProjectSlot({ disabled = false, reason = '' } = {}) {
  if (disabled) {
    return `
    <div class="project-slot" style="cursor:default" aria-disabled="true">
      <span class="project-slot__icon">${icon('lock', { size: 18 })}</span>
      <div class="project-slot__title">Project limit reached</div>
      <div class="project-slot__desc">${esc(reason || 'You can run 2 projects at a time. Delete one to free a slot.')}</div>
    </div>`;
  }
  return `
  <button class="project-slot" data-action="create-project" type="button">
    <span class="project-slot__icon">${icon('plus', { size: 18 })}</span>
    <div class="project-slot__title">Create project</div>
    <div class="project-slot__desc">Generates a project ID plus separate user and admin connection configs.</div>
  </button>`;
}
