/**
 * Settings — server config, auth, storage info, security, maintenance.
 */

import { getSettings, saveSettings, getOrphans } from '../services/project-service.js';
import { changePassword, changeEmail } from '../services/auth-service.js';
import { closeModal, openModal, toast } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { esc, formatBytes, formatDateTime } from '../utils/helpers.js';
import { passwordStrength, validateEmail, validatePassword } from '../utils/validators.js';

export async function renderSettings(ctx) {
  ctx.setHeader({
    title: 'Settings',
    subtitle: 'Server configuration, authentication and storage',
    actions: '',
  });

  ctx.renderContent(`<div class="card card--pad"><div class="loading-block"><span class="spinner"></span></div></div>`);

  let data;
  try {
    data = await getSettings();
  } catch (error) {
    ctx.renderContent(`<div class="card card--pad"><div class="h3">Could not load settings</div><div class="sub mt-4">${esc(error.message)}</div></div>`);
    return;
  }

  const settings = data.settings || {};
  const storage = data.storage || {};

  ctx.renderContent(`
    <div class="settings-grid">
      <div class="col gap-16">
        <div class="card card--pad">
          <div class="section-head">
            <span class="section-head__title">Server configuration</span>
          </div>
          <div class="field" style="margin-bottom:14px">
            <label class="field__label">Server name</label>
            <input class="input" data-site-name value="${esc(settings.siteName || '')}" maxlength="60" />
            <div class="field__hint">Shown in the dashboard header.</div>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">Default upload limit</div>
              <div class="setting-row__desc">Applied to new projects. Hard ceiling is 20 MB per file.</div>
            </div>
            <div class="setting-row__control">
              <input class="input" type="number" min="1" max="20" data-upload-max value="${settings.defaultUploadMaxMb || 20}" style="width:84px" />
              <span class="muted">MB</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">User API enabled for new projects</div>
              <div class="setting-row__desc">Controls the default for freshly created projects.</div>
            </div>
            <div class="setting-row__control">
              <label class="switch">
                <input type="checkbox" data-allow-default ${settings.allowUserApiByDefault ? 'checked' : ''} />
                <span class="switch__track"></span>
              </label>
            </div>
          </div>
          <div class="mt-16">
            <button class="btn btn--primary btn--sm" data-action="save-server">${icon('check', { size: 14 })} Save configuration</button>
          </div>
        </div>

        <div class="card card--pad">
          <div class="section-head">
            <span class="section-head__title">Authentication</span>
            <span class="badge badge--green badge--dot">Admin</span>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">Admin email</div>
              <div class="setting-row__desc">${esc(ctx.email || '—')}</div>
            </div>
            <div class="setting-row__control">
              <button class="btn btn--secondary btn--sm" data-action="change-email">Change</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">Password</div>
              <div class="setting-row__desc">Hashed with PBKDF2-SHA256 (100k iterations) and stored in KV.</div>
            </div>
            <div class="setting-row__control">
              <button class="btn btn--secondary btn--sm" data-action="change-password">Change</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">Session lifetime</div>
              <div class="setting-row__desc">12 hours. Changing your password ends all other sessions.</div>
            </div>
            <div class="setting-row__control"><span class="badge badge--gray">12h</span></div>
          </div>
        </div>

        <div class="card card--pad">
          <div class="section-head"><span class="section-head__title">Maintenance</span></div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">Orphaned data</div>
              <div class="setting-row__desc">Data kept after a project was deleted without purging.</div>
            </div>
            <div class="setting-row__control">
              <button class="btn btn--secondary btn--sm" data-action="check-orphans">${icon('search', { size: 14 })} Scan</button>
            </div>
          </div>
          <div data-orphans-host class="mt-12"></div>
        </div>
      </div>

      <div class="col gap-16">
        <div class="card card--pad">
          <div class="section-head">
            <span class="section-head__title">Storage</span>
          </div>
          <div class="kv-row"><span class="kv-row__key">KV binding</span><span class="kv-row__val">${esc(storage.kvNamespace || 'STORAGE_KV')}</span></div>
          <div class="kv-row"><span class="kv-row__key">Blob store</span><span class="kv-row__val">${esc(storage.blobStore || 'storage-server')}</span></div>
          <div class="kv-row"><span class="kv-row__key">Max projects</span><span class="kv-row__val">${esc(String(storage.maxProjects || 2))}</span></div>
          <div class="kv-row"><span class="kv-row__key">Max record size</span><span class="kv-row__val">${esc(formatBytes(storage.recordMaxBytes))}</span></div>
          <div class="kv-row"><span class="kv-row__key">Max file size</span><span class="kv-row__val">${esc(formatBytes(storage.fileMaxBytes))}</span></div>
          <div class="kv-row"><span class="kv-row__key">Runtime</span><span class="kv-row__val">${ctx.preview ? 'Preview (localStorage)' : 'EdgeOne Pages Functions'}</span></div>
        </div>

        <div class="card card--pad">
          <div class="section-head"><span class="section-head__title">Security posture</span></div>
          <div class="perm-list">
            <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Admin credentials never reach the browser</span></div>
            <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>User tokens are write-only capability tokens</span></div>
            <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Every request verifies project ownership</span></div>
            <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Rate limiting on login, setup, writes and uploads</span></div>
            <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>File extension + MIME + size validation</span></div>
            <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Downloads force attachment for risky types</span></div>
          </div>
        </div>

        <div class="card danger-zone">
          <div class="danger-zone__head"><div class="danger-zone__title">Danger zone</div></div>
          <div class="card__body">
            <div class="setting-row__desc" style="margin-bottom:12px">
              Signing out clears the session token from this browser. Your projects and data stay untouched.
            </div>
            <button class="btn btn--danger-soft btn--sm btn--block" data-action="logout">${icon('logout', { size: 14 })} Sign out</button>
          </div>
        </div>
      </div>
    </div>`);

  const content = document.getElementById('page-content');

  content.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="save-server"]')) {
      const btn = e.target.closest('[data-action="save-server"]');
      btn.disabled = true;
      try {
        await saveSettings({
          siteName: content.querySelector('[data-site-name]').value,
          defaultUploadMaxMb: Number(content.querySelector('[data-upload-max]').value),
          allowUserApiByDefault: content.querySelector('[data-allow-default]').checked,
        });
        toast('Configuration saved', { type: 'success' });
      } catch (error) {
        toast(error.message || 'Save failed', { type: 'error' });
      } finally {
        btn.disabled = false;
      }
      return;
    }

    if (e.target.closest('[data-action="change-password"]')) {
      openPasswordModal(ctx);
      return;
    }

    if (e.target.closest('[data-action="change-email"]')) {
      openEmailModal(ctx);
      return;
    }

    if (e.target.closest('[data-action="check-orphans"]')) {
      const host = content.querySelector('[data-orphans-host]');
      host.innerHTML = `<div class="row gap-8"><span class="spinner"></span><span class="muted">Scanning KV…</span></div>`;
      try {
        const result = await getOrphans();
        host.innerHTML = result.orphans.length
          ? result.orphans
              .map(
                (o) => `
            <div class="kv-row">
              <span class="kv-row__key">${esc(o.projectId)}</span>
              <span class="kv-row__val">${o.records} records · ${o.files} files</span>
            </div>`,
              )
              .join('')
          : `<div class="row gap-8 muted">${icon('check', { size: 15 })} No orphaned data found.</div>`;
      } catch (error) {
        host.innerHTML = `<div class="field__error">${esc(error.message)}</div>`;
      }
      return;
    }

    if (e.target.closest('[data-action="logout"]')) {
      window.dispatchEvent(new CustomEvent('app:logout'));
    }
  });
}

/* ------------------------------------------------------------------ */
/* Password / email modals                                            */
/* ------------------------------------------------------------------ */

function openPasswordModal(ctx) {
  openModal({
    title: 'Change password',
    description: 'All other dashboard sessions will be signed out.',
    body: `
      <div class="field">
        <label class="field__label">Current password</label>
        <input class="input" type="password" data-current autocomplete="current-password" autofocus />
      </div>
      <div class="field">
        <label class="field__label">New password</label>
        <input class="input" type="password" data-new autocomplete="new-password" />
        <div class="meter" style="height:5px;margin-top:6px"><div class="meter__fill" data-strength style="width:0%"></div></div>
        <div class="field__hint" data-strength-label>At least 10 characters.</div>
      </div>
      <div class="field">
        <label class="field__label">Confirm new password</label>
        <input class="input" type="password" data-confirm autocomplete="new-password" />
      </div>
      <div class="field__error hide" data-error></div>`,
    footer: `
      <button class="btn btn--secondary" data-cancel>Cancel</button>
      <button class="btn btn--primary" data-save>Update password</button>`,
    onMount(modal) {
      const newInput = modal.querySelector('[data-new]');
      const bar = modal.querySelector('[data-strength]');
      const label = modal.querySelector('[data-strength-label]');
      newInput.addEventListener('input', () => {
        const s = passwordStrength(newInput.value);
        bar.style.width = `${s.percent}%`;
        bar.className = `meter__fill ${s.score >= 4 ? 'meter__fill--green' : s.score >= 2 ? '' : 'meter__fill--orange'}`;
        label.textContent = s.label;
      });

      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('[data-save]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errorBox = modal.querySelector('[data-error]');
        const currentPassword = modal.querySelector('[data-current]').value;
        const newPassword = newInput.value;
        const confirm = modal.querySelector('[data-confirm]').value;

        const problem =
          (!currentPassword && 'Enter your current password.') ||
          validatePassword(newPassword) ||
          (newPassword !== confirm && 'Passwords do not match.');
        if (problem) {
          errorBox.textContent = problem;
          errorBox.classList.remove('hide');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = `<span class="spinner spinner--white"></span> Updating…`;
        try {
          await changePassword({ currentPassword, newPassword });
          closeModal();
          toast('Password updated', { type: 'success' });
        } catch (error) {
          errorBox.textContent = error.message || 'Update failed';
          errorBox.classList.remove('hide');
          btn.disabled = false;
          btn.textContent = 'Update password';
        }
      });
    },
  });
}

function openEmailModal(ctx) {
  openModal({
    title: 'Change admin email',
    body: `
      <div class="field">
        <label class="field__label">New email</label>
        <input class="input" type="email" data-email value="${esc(ctx.email || '')}" autofocus />
      </div>
      <div class="field">
        <label class="field__label">Current password</label>
        <input class="input" type="password" data-password autocomplete="current-password" />
      </div>
      <div class="field__error hide" data-error></div>`,
    footer: `
      <button class="btn btn--secondary" data-cancel>Cancel</button>
      <button class="btn btn--primary" data-save>Update email</button>`,
    onMount(modal) {
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('[data-save]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errorBox = modal.querySelector('[data-error]');
        const email = modal.querySelector('[data-email]').value;
        const currentPassword = modal.querySelector('[data-password]').value;
        const problem = validateEmail(email) || (!currentPassword && 'Enter your password.');
        if (problem) {
          errorBox.textContent = problem;
          errorBox.classList.remove('hide');
          return;
        }
        btn.disabled = true;
        try {
          await changeEmail({ email, currentPassword });
          closeModal();
          toast('Email updated', { type: 'success' });
        } catch (error) {
          errorBox.textContent = error.message || 'Update failed';
          errorBox.classList.remove('hide');
          btn.disabled = false;
        }
      });
    },
  });
}
