/**
 * Application shell: routing, layout, global actions.
 *
 * Routes
 *   /login
 *   /setup
 *   /dashboard
 *   /projects
 *   /projects/:id
 *   /storage
 *   /storage/:id
 *   /settings
 *   /docs
 *   /security
 */

import { renderSidebar, renderTabbar, bindSidebar, NAV_ITEMS } from './components/sidebar.js';
import { renderHeader, bindHeader } from './components/header.js';
import { confirmDialog, closeModal, toast } from './components/modal.js';
import { icon } from './components/icons.js';
import { esc } from './utils/helpers.js';
import { detectMode } from './services/api.js';
import { fetchStatus, getUser, isAuthenticated, logout, me, login, setup } from './services/auth-service.js';
import { listProjects } from './services/project-service.js';

import { renderDashboard } from './pages/dashboard.js';
import { renderProjects } from './pages/projects.js';
import { renderProjectDetails } from './pages/project-details.js';
import { renderStorage } from './pages/storage.js';
import { renderSettings } from './pages/settings.js';
import { renderLoginScreen, renderSetupScreen } from './pages/auth-screens.js';
import { renderDocs } from './pages/docs.js';

export const state = {
  route: 'dashboard',
  params: {},
  email: '',
  projects: [],
  preview: false,
  initialised: true,
};

const ROUTES = {
  dashboard: { render: renderDashboard, nav: 'dashboard', title: 'Dashboard' },
  projects: { render: renderProjects, nav: 'projects', title: 'Projects' },
  project: { render: renderProjectDetails, nav: 'projects', title: 'Project' },
  storage: { render: renderStorage, nav: 'storage', title: 'Storage' },
  settings: { render: renderSettings, nav: 'settings', title: 'Settings' },
  docs: { render: renderDocs, nav: 'docs', title: 'API Reference' },
  security: { render: renderDocs, nav: 'security', title: 'Security Notes', variant: 'security' },
};

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

export function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (!parts.length) return { route: 'dashboard', params: {} };
  const [head, second] = parts;
  if (head === 'projects' && second) return { route: 'project', params: { id: second } };
  if (head === 'storage') return { route: 'storage', params: second ? { projectId: second } : {} };
  if (ROUTES[head]) return { route: head, params: {} };
  return { route: 'dashboard', params: {} };
}

export function navigate(path) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === target) renderRoute();
  else window.location.hash = target;
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

export async function boot(root) {
  state.preview = await detectPreview();
  const status = await safeStatus();

  if (!status.initialised) {
    renderAuthShell(root, renderSetupScreen({ setupKeyRequired: status.setupKeyRequired, email: status.email }));
    return;
  }

  if (!isAuthenticated()) {
    renderAuthShell(root, renderLoginScreen());
    return;
  }

  const user = await me();
  if (!user) {
    renderAuthShell(root, renderLoginScreen({ error: 'Your session expired. Please sign in again.' }));
    return;
  }
  state.email = user.email || '';

  await loadProjects();
  renderAppShell(root);

  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

async function detectPreview() {
  // detectMode() performs the only health probe (cached for the session).
  return (await detectMode()) === 'preview';
}

async function safeStatus() {
  try {
    return await fetchStatus();
  } catch {
    // API unreachable -> show login; the page itself will surface errors.
    return { initialised: true, setupKeyRequired: false, email: null };
  }
}

export async function loadProjects() {
  try {
    const result = await listProjects();
    state.projects = result.projects || [];
    return state.projects;
  } catch {
    state.projects = [];
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Auth shell                                                         */
/* ------------------------------------------------------------------ */

function renderAuthShell(root, screenHtml) {
  root.innerHTML = `
    <div class="auth">
      ${state.preview ? previewBanner() : ''}
      ${screenHtml}
    </div>
    <div class="toasts"></div>`;

  bindAuthForms(root);
}

function previewBanner() {
  return `
  <div class="preview-banner">
    ${icon('info', { size: 15 })}
    <span>
      <span class="preview-banner__long">Preview mode — running against an in-browser mock backend. Deploy to EdgeOne for real KV + Blob storage.</span>
      <span class="preview-banner__short" style="display:none">Preview mode — demo data stored in this browser</span>
    </span>
    <span class="preview-banner__tag">Demo</span>
  </div>`;
}

function bindAuthForms(root) {
  const loginForm = root.querySelector('#login-form');
  if (loginForm) {
    const errBox = root.querySelector('[data-auth-error]');
    const submit = loginForm.querySelector('button[type="submit"]');
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(loginForm).entries());
      setLoading(submit, true);
      hideError(errBox);
      try {
        await login({ email: data.email, password: data.password });
        await boot(document.getElementById('app'));
      } catch (error) {
        showError(errBox, error.message || 'Sign in failed.');
        setLoading(submit, false);
      }
    });
    return;
  }

  const setupForm = root.querySelector('#setup-form');
  if (setupForm) {
    const errBox = root.querySelector('[data-auth-error]');
    const submit = setupForm.querySelector('button[type="submit"]');
    setupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(setupForm).entries());
      setLoading(submit, true);
      hideError(errBox);
      try {
        await setup({ email: data.email, password: data.password, setupKey: data.setupKey });
        await boot(document.getElementById('app'));
      } catch (error) {
        showError(errBox, error.message || 'Setup failed.');
        setLoading(submit, false);
      }
    });
  }
}

function showError(box, message) {
  if (!box) {
    toast(message, { type: 'error' });
    return;
  }
  box.innerHTML = `${icon('alert', { size: 16 })}<span>${esc(message)}</span>`;
  box.classList.remove('hide');
}

function hideError(box) {
  box?.classList.add('hide');
}

function setLoading(button, loading) {
  if (!button) return;
  button.disabled = loading;
  if (loading) {
    button.dataset.label = button.innerHTML;
    button.innerHTML = `<span class="spinner spinner--white"></span> Working…`;
  } else if (button.dataset.label) {
    button.innerHTML = button.dataset.label;
  }
}

/* ------------------------------------------------------------------ */
/* App shell                                                          */
/* ------------------------------------------------------------------ */

function renderAppShell(root) {
  const route = ROUTES[parseRoute().route] ? parseRoute() : { route: 'dashboard', params: {} };
  const activeNav = ROUTES[route.route]?.nav || 'dashboard';

  root.innerHTML = `
    <div class="app">
      ${state.preview ? `<div class="app__banner">${previewBanner()}</div>` : ''}
      ${renderSidebar({
        route: activeNav,
        email: state.email,
        projectCount: state.projects.length,
        maxProjects: 2,
        preview: state.preview,
      })}
      <div class="app__main">
        <div id="page-header"></div>
        <main id="page-content" class="page"></main>
      </div>
    </div>
    ${isMobileViewport() ? renderTabbar(activeNav) : ''}
    <div class="toasts"></div>`;

  bindShell(root);
  ensureShellListeners();
}

function bindShell(root) {
  bindSidebar();
  bindHeader();

  root.addEventListener('click', async (e) => {
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      const target = navBtn.dataset.nav;
      document.getElementById('sidebar')?.classList.remove('is-open');
      document.getElementById('sidebar-backdrop')?.classList.add('hide');
      navigate(mapNavToPath(target));
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout') {
      const ok = await confirmDialog({
        title: 'Sign out?',
        description: 'You will need your admin password to get back in.',
        confirmLabel: 'Sign out',
      });
      if (ok) {
        logout();
        window.location.hash = '';
        await boot(document.getElementById('app'));
      }
    }
    if (action === 'create-project' && !e.target.closest('[data-page-handled]')) {
      // handled by page modules; this is a safety net for the dashboard slot
      window.dispatchEvent(new CustomEvent('app:create-project'));
    }
  });

  window.addEventListener('app:logout', async () => {
    logout();
    window.location.hash = '';
    await boot(document.getElementById('app'));
  });

  window.addEventListener('app:refresh-projects', async () => {
    await loadProjects();
    renderRoute({ soft: true });
  });
}

/**
 * One-time global listeners (registered once per page load, never stacked).
 * The biggest one: when the viewport crosses the mobile breakpoint the tabbar
 * and off-canvas sidebar must swap correctly, so we rebuild the shell - routes
 * are hash-based so the current page is preserved.
 */
let shellListenersBound = false;

function ensureShellListeners() {
  if (shellListenersBound) return;
  shellListenersBound = true;

  // Rebuild the shell when the mobile/desktop shell shape changes (cheap, and
  // guarantees the tabbar/sidebar pair always matches the viewport).
  // A matchMedia change listener is used in addition to `resize` because some
  // environments (device emulation, rotation) change matchMedia without resize.
  let mobileShape = isMobileViewport();
  let pending = 0;
  let syncing = false;

  const syncShell = () => {
    if (syncing) return;
    const nowMobile = isMobileViewport();
    const hasTabbar = Boolean(document.querySelector('.tabbar'));
    if (nowMobile === mobileShape && hasTabbar === nowMobile) return;
    mobileShape = nowMobile;
    syncing = true;
    clearTimeout(pending);
    document.getElementById('sidebar')?.classList.remove('is-open');
    document.getElementById('sidebar-backdrop')?.classList.add('hide');
    const root = document.getElementById('app');
    if (root && document.getElementById('page-header')) {
      renderAppShell(root);
      renderRoute({ soft: true });
    }
    // Release on the next frame - never on a timer that a stray resize can cancel.
    requestAnimationFrame(() => {
      syncing = false;
    });
  };

  window.addEventListener('resize', syncShell);
  try {
    window.matchMedia('(max-width: 860px)').addEventListener('change', syncShell);
  } catch {
    window.matchMedia('(max-width: 860px)').addListener(syncShell);
  }
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function mapNavToPath(id) {
  switch (id) {
    case 'projects':
      return '/projects';
    case 'storage':
      return '/storage';
    case 'settings':
      return '/settings';
    case 'docs':
      return '/docs';
    case 'security':
      return '/security';
    default:
      return '/dashboard';
  }
}

/* ------------------------------------------------------------------ */
/* Render current route                                               */
/* ------------------------------------------------------------------ */

export async function renderRoute({ soft = false } = {}) {
  const { route, params } = parseRoute();
  const def = ROUTES[route] || ROUTES.dashboard;
  const activeNav = def.nav;

  // Update active nav state without re-rendering the shell
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.nav === activeNav);
  });

  const headerHost = document.getElementById('page-header');
  const contentHost = document.getElementById('page-content');
  if (!contentHost) return;

  const ctx = {
    params,
    projects: state.projects,
    preview: state.preview,
    email: state.email,
    navigate,
    setHeader: (opts) => {
      headerHost.innerHTML = renderHeader({ ...opts, preview: state.preview });
      bindHeader();
    },
    refreshProjects: async () => {
      await loadProjects();
      document.querySelectorAll('.nav__badge').forEach((b) => {
        b.textContent = `${state.projects.length}/2`;
      });
    },
    /**
     * Replaces the whole page container (not just innerHTML) so that event
     * listeners attached by a previous page render are garbage-collected with
     * the old node. Without this, listeners stack up and actions fire twice.
     */
    renderContent: (html) => {
      const old = document.getElementById('page-content');
      const fresh = document.createElement('main');
      fresh.id = 'page-content';
      fresh.className = 'page';
      fresh.innerHTML = html;
      if (old) old.replaceWith(fresh);
      else document.querySelector('.app__main')?.appendChild(fresh);
      fresh.style.animation = 'none';
      requestAnimationFrame(() => {
        fresh.style.animation = '';
        window.scrollTo({ top: 0, behavior: soft ? 'instant' : 'auto' });
      });
    },
    soft,
  };

  try {
    await def.render(ctx);
  } catch (error) {
    console.error('[route] render failed', error);
    ctx.setHeader({ title: 'Something went wrong', subtitle: '' });
    ctx.renderContent(`
      <div class="card card--pad">
        <div class="row gap-12">
          <span class="stat__icon stat__icon--orange">${icon('alert', { size: 18 })}</span>
          <div>
            <div class="h3">Could not load this page</div>
            <div class="sub mt-4">${esc(error.message || 'Unknown error')}</div>
          </div>
        </div>
        <button class="btn btn--primary mt-16" onclick="location.reload()">Reload</button>
      </div>`);
  }
}

/* ------------------------------------------------------------------ */
/* Global helpers re-exported for pages                               */
/* ------------------------------------------------------------------ */

export { closeModal, toast };
