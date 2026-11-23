/**
 * Sidebar navigation + mobile tab bar.
 */

import { esc, initials } from '../utils/helpers.js';
import { icon } from './icons.js';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/dashboard' },
  { id: 'projects', label: 'Projects', icon: 'projects', path: '/projects' },
  { id: 'storage', label: 'Storage', icon: 'database', path: '/storage' },
  { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
];

export function renderSidebar({ route = 'dashboard', email = '', projectCount = 0, maxProjects = 2, preview = false } = {}) {
  return `
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <span class="brand__mark">${icon('logo', { size: 21 })}</span>
      <div class="brand__text">
        <div class="brand__name">Storage Server</div>
        <div class="brand__sub">
          ${preview ? 'Preview mode' : 'EdgeOne Pages'}
        </div>
      </div>
    </div>

    <div class="sidebar__label">Workspace</div>
    <nav class="nav">
      ${NAV_ITEMS.map(
        (item) => `
        <button class="nav__item ${route === item.id ? 'is-active' : ''}" data-nav="${item.id}">
          ${icon(item.icon, { size: 19 })}
          <span>${item.label}</span>
          ${item.id === 'projects' ? `<span class="nav__badge">${projectCount}/${maxProjects}</span>` : ''}
        </button>`,
      ).join('')}
    </nav>

    <div class="sidebar__spacer"></div>

    <div class="sidebar__label">Reference</div>
    <nav class="nav">
      <button class="nav__item" data-nav="docs">
        ${icon('code', { size: 19 })}
        <span>API Reference</span>
      </button>
      <button class="nav__item" data-nav="security">
        ${icon('shield', { size: 19 })}
        <span>Security Notes</span>
      </button>
    </nav>

    <div class="sidebar__foot">
      <div class="user-chip">
        <span class="avatar">${esc(initials(email.split('@')[0] || 'AD'))}</span>
        <div class="user-chip__meta">
          <div class="user-chip__name">${esc(email || 'Admin')}</div>
          <div class="user-chip__role">Administrator</div>
        </div>
        <button class="btn btn--ghost btn--icon btn--sm" data-action="logout" title="Sign out" aria-label="Sign out">
          ${icon('logout', { size: 16 })}
        </button>
      </div>
    </div>
  </aside>
  <div class="sidebar__backdrop hide" id="sidebar-backdrop"></div>`;
}

export function renderTabbar(route = 'dashboard') {
  // display is set inline: the tabbar is only rendered for the mobile shell, so
  // it must not depend on which stylesheet happens to load last.
  return `
  <nav class="tabbar" aria-label="Primary" style="display:grid">
    ${NAV_ITEMS.map(
      (item) => `
      <button class="tabbar__item ${route === item.id ? 'is-active' : ''}" data-nav="${item.id}">
        ${icon(item.icon, { size: 21 })}
        <span>${item.label}</span>
      </button>`,
    ).join('')}
  </nav>`;
}

export function bindSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  const open = () => {
    sidebar?.classList.add('is-open');
    backdrop?.classList.remove('hide');
  };
  const close = () => {
    sidebar?.classList.remove('is-open');
    backdrop?.classList.add('hide');
  };

  window.addEventListener('app:toggle-nav', () => {
    if (sidebar?.classList.contains('is-open')) close();
    else open();
  });
  backdrop?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}
