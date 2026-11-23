/**
 * Reusable presentational blocks: stat tiles, storage meters, empty state.
 */

import { esc, formatBytes, formatNumber } from '../utils/helpers.js';
import { icon } from './icons.js';

export function renderStat({ label, value, suffix = '', iconName = 'database', tone = 'blue', foot = '' }) {
  return `
  <div class="card stat">
    <div class="stat__top">
      <span class="stat__icon stat__icon--${tone}">${icon(iconName, { size: 18 })}</span>
    </div>
    <div>
      <div class="stat__label">${esc(label)}</div>
      <div class="stat__value">${esc(value)}${suffix ? `<small>${esc(suffix)}</small>` : ''}</div>
    </div>
    ${foot ? `<div class="stat__foot">${foot}</div>` : ''}
  </div>`;
}

/**
 * Storage meter card.
 * @param {object} opts { title, sub, usedLabel, usedBytes, capBytes, count, countLabel, tone, iconName }
 */
export function renderMeter({ title, sub, usedBytes, capBytes, count, countLabel, tone = '', iconName = 'database', segments = null }) {
  const pct = capBytes ? Math.min(100, Math.max(usedBytes > 0 ? 1.5 : 0, (usedBytes / capBytes) * 100)) : 0;
  const danger = pct >= 90 ? 'meter__fill--danger' : '';

  const legend = segments
    ? `<div class="meter-legend">
        ${segments
          .map(
            (s) => `<span><i class="legend-dot" style="background:${s.color}"></i>${esc(s.label)} <b>${esc(String(s.value))}</b></span>`,
          )
          .join('')}
      </div>`
    : '';

  return `
  <div class="card meter-card">
    <div class="meter-card__head">
      <span class="stat__icon stat__icon--${tone || 'blue'}">${icon(iconName, { size: 18 })}</span>
      <div>
        <div class="meter-card__title">${esc(title)}</div>
        <div class="meter-card__sub">${esc(sub)}</div>
      </div>
      <div class="meter-card__value">
        <b>${esc(formatBytes(usedBytes))}</b>
        <span>${esc(countLabel)}: ${esc(formatNumber(count))}</span>
      </div>
    </div>
    <div class="meter">
      <div class="meter__fill ${danger} ${tone === 'indigo' ? 'meter__fill--indigo' : tone === 'green' ? 'meter__fill--green' : ''}" style="width:${pct.toFixed(1)}%"></div>
    </div>
    <div class="meter-legend">
      <span>Used <b>${esc(formatBytes(usedBytes))}</b></span>
      <span>Capacity reference <b>${esc(formatBytes(capBytes))}</b></span>
    </div>
    ${legend}
  </div>`;
}

export function renderEmpty({ iconName = 'database', title, desc, actionLabel = '', actionAttr = '' }) {
  return `
  <div class="empty">
    <div class="empty__art">${icon(iconName, { size: 25 })}</div>
    <div class="empty__title">${esc(title)}</div>
    <div class="empty__desc">${esc(desc)}</div>
    ${actionLabel ? `<div class="empty__actions"><button class="btn btn--primary btn--sm" ${actionAttr}>${esc(actionLabel)}</button></div>` : ''}
  </div>`;
}

export function renderSkeletonRow(count = 4) {
  return Array.from({ length: count })
    .map(
      () => `
    <div class="list__row">
      <div class="skeleton" style="width:34px;height:34px;border-radius:10px"></div>
      <div class="grow">
        <div class="skeleton" style="height:11px;width:38%;margin-bottom:6px"></div>
        <div class="skeleton" style="height:9px;width:58%"></div>
      </div>
    </div>`,
    )
    .join('');
}
