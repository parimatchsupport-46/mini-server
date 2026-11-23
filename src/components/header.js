/**
 * Top header: page title, preview badge, quick actions.
 */

import { esc } from '../utils/helpers.js';
import { icon } from './icons.js';

export function renderHeader({ title, subtitle = '', actions = '', preview = false } = {}) {
  return `
  <header class="topbar" id="topbar">
    <button class="btn btn--ghost btn--icon" id="nav-toggle" aria-label="Open navigation" style="display:none">
      ${icon('menu', { size: 20 })}
    </button>
    <span class="topbar__mobile-logo">${icon('logo', { size: 18 })}</span>
    <div class="topbar__titles">
      <div class="topbar__title">${esc(title)}</div>
      ${subtitle ? `<div class="topbar__sub">${esc(subtitle)}</div>` : ''}
    </div>
    <div class="topbar__actions">
      ${preview ? `<span class="badge badge--orange badge--dot">Preview</span>` : `<span class="badge badge--green badge--dot">Live</span>`}
      ${actions}
    </div>
  </header>`;
}

export function bindHeader() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  const onScroll = () => {
    const scrolled = window.scrollY > 4;
    topbar.classList.toggle('is-stuck', scrolled);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const toggle = document.getElementById('nav-toggle');
  if (toggle) {
    toggle.style.display = window.matchMedia('(max-width: 860px)').matches ? 'inline-flex' : 'none';
    toggle.addEventListener('click', () => window.dispatchEvent(new CustomEvent('app:toggle-nav')));
  }
}
