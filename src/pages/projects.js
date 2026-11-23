/**
 * Projects list page + create / delete / rotate flows.
 * Shared helpers are exported so the dashboard can reuse the create dialog.
 */

import { createProject, deleteProject, getConnectionConfig, rotateCredentials, updateProject } from '../services/project-service.js';
import { renderProjectCard, renderProjectSlot } from '../components/project-card.js';
import { confirmDialog, closeModal, openModal, toast } from '../components/modal.js';
import { renderEmpty } from '../components/storage-card.js';
import { icon } from '../components/icons.js';
import { renderCodeBlock } from '../utils/config-generator.js';
import { validateProjectName } from '../utils/validators.js';
import { copyToClipboard, esc } from '../utils/helpers.js';

export async function renderProjects(ctx) {
  ctx.setHeader({
    title: 'Projects',
    subtitle: 'Each project gets its own namespace and connection configs',
    actions: `
      <button class="btn btn--primary btn--sm" data-action="create-project" data-page-handled="1">
        ${icon('plus', { size: 15 })} New project
      </button>`,
  });

  const canCreate = ctx.projects.length < 2;

  ctx.renderContent(`
    <div class="card card--pad" style="margin-bottom:18px;background:linear-gradient(180deg,#f7fbff,#fff)">
      <div class="row gap-12 row--wrap">
        <span class="stat__icon stat__icon--blue">${icon('info', { size: 18 })}</span>
        <div class="grow" style="min-width:220px">
          <div class="h3">Two projects, fully isolated</div>
          <div class="sub mt-4">
            A project can read and write only its own namespace. The public user credential can create records and
            upload files, but can never read, update or delete anything.
          </div>
        </div>
        <span class="badge badge--blue">${ctx.projects.length} / 2 slots used</span>
      </div>
    </div>

    <div class="project-grid">
      ${ctx.projects.map(renderProjectCard).join('')}
      ${renderProjectSlot({ disabled: !canCreate })}
    </div>

    ${
      ctx.projects.length
        ? ''
        : `<div class="card mt-20">${renderEmpty({
            iconName: 'projects',
            title: 'No projects yet',
            desc: 'Create your first project to generate a project ID and its connection configs.',
            actionLabel: 'Create project',
            actionAttr: 'data-action="create-project" data-page-handled="1"',
          })}</div>`
    }
  `);

  const content = document.getElementById('page-content');
  content.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="create-project"]')) {
      openCreateProjectModal(ctx);
      return;
    }
    const card = e.target.closest('[data-project-id]');
    if (card) ctx.navigate(`/projects/${card.dataset.projectId}`);
  });
}

/* ------------------------------------------------------------------ */
/* Create project                                                     */
/* ------------------------------------------------------------------ */

export function openCreateProjectModal(ctx) {
  if (ctx.projects.length >= 2) {
    toast('Project limit reached. Delete a project to free a slot.', { type: 'error' });
    return;
  }

  openModal({
    title: 'Create project',
    description: 'A project ID and two connection configs are generated automatically.',
    body: `
      <div class="field">
        <label class="field__label" for="project-name">Project name</label>
        <input class="input" id="project-name" placeholder="My Support Website" maxlength="60" autofocus autocomplete="off" />
        <div class="field__error hide" data-error="name"></div>
      </div>
      <div class="field">
        <label class="field__label" for="project-desc">Description <span class="muted">optional</span></label>
        <textarea class="textarea" id="project-desc" maxlength="200" placeholder="What will this project store?"></textarea>
      </div>
      <div class="card card--pad" style="background:var(--surface-2);box-shadow:none">
        <div class="h3" style="margin-bottom:8px">What gets created</div>
        <div class="perm-list">
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Unique project ID and isolated KV + Blob namespace</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>User Panel credential — write-only, safe for public frontends</span></div>
          <div class="perm-item perm-item--allow">${icon('check', { size: 14 })}<span>Admin Panel secret — full data access, server-side only</span></div>
        </div>
      </div>
      <div class="field__error hide" data-error="form"></div>`,
    footer: `
      <button class="btn btn--secondary" data-cancel>Cancel</button>
      <button class="btn btn--primary" data-submit>${icon('plus', { size: 15 })} Create project</button>`,
    onMount(modal) {
      const nameInput = modal.querySelector('#project-name');
      const errorName = modal.querySelector('[data-error="name"]');
      const errorForm = modal.querySelector('[data-error="form"]');
      const submit = modal.querySelector('[data-submit]');
      const cancel = modal.querySelector('[data-cancel]');

      nameInput.addEventListener('input', () => {
        errorName.classList.add('hide');
        nameInput.classList.remove('is-error');
      });

      cancel.addEventListener('click', closeModal);

      const doCreate = async () => {
        const name = nameInput.value.trim();
        const problem = validateProjectName(name);
        if (problem) {
          errorName.textContent = problem;
          errorName.classList.remove('hide');
          nameInput.classList.add('is-error');
          return;
        }
        submit.disabled = true;
        submit.innerHTML = `<span class="spinner spinner--white"></span> Creating…`;
        try {
          const result = await createProject({
            name,
            description: modal.querySelector('#project-desc').value.trim(),
          });
          closeModal();
          await ctx.refreshProjects();
          showCreatedProject({ result, ctx });
        } catch (error) {
          errorForm.textContent = error.message || 'Could not create the project.';
          errorForm.classList.remove('hide');
          submit.disabled = false;
          submit.innerHTML = `${icon('plus', { size: 15 })} Create project`;
        }
      };

      submit.addEventListener('click', doCreate);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doCreate();
      });
    },
  });
}

/** Post-creation sheet with the generated credentials. */
export function showCreatedProject({ result, ctx }) {
  const { project, credentials, connection } = result;
  const apiBase = connection?.user?.apiBase || `${location.origin}/api`;

  openModal({
    title: 'Project created',
    description: 'Copy the configs now — the user token is shown in full only once.',
    size: 'wide',
    body: `
      <div class="row gap-12 row--wrap">
        <span class="project-card__mark" style="background:linear-gradient(150deg,#5aa9ff,#007aff);width:44px;height:44px;border-radius:13px;font-size:16px;font-weight:700;color:#fff;display:grid;place-items:center">
          ${esc(project.name.slice(0, 2).toUpperCase())}
        </span>
        <div class="grow">
          <div class="h2">${esc(project.name)}</div>
          <div class="mono muted">${esc(project.id)}</div>
        </div>
        <span class="badge badge--green badge--dot">Active</span>
      </div>

      <div class="field">
        <div class="field__label">User Panel Config <span class="badge badge--blue">public · write-only</span></div>
        ${renderCodeBlock({
          label: 'user config',
          code: `API base   ${apiBase}
Project ID ${project.id}
Token      ${credentials.userToken}
Header     Authorization: Bearer ${credentials.userToken}
Allowed    data.send · files.send · meta.read
Denied     read · update · delete · list`,
        })}
      </div>

      <div class="field">
        <div class="field__label">Admin Panel Config <span class="badge badge--orange">server-side only</span></div>
        ${renderCodeBlock({
          label: 'admin config',
          code: `Token      ${credentials.adminSecret}
Header     Authorization: Bearer ${credentials.adminSecret}
Scope      ${project.id} only
Allowed    read · create · update · delete · files`,
        })}
      </div>

      <div class="perm-item perm-item--deny">
        ${icon('alert', { size: 14 })}
        <span>Never ship the admin secret to a browser bundle. You can rotate either credential later from the project page.</span>
      </div>`,
    footer: `
      <button class="btn btn--secondary" data-open-project>Open project</button>
      <button class="btn btn--primary" data-done>Done</button>`,
    onMount(modal) {
      modal.querySelector('[data-done]').addEventListener('click', () => {
        document.querySelector('.modal-backdrop')?.remove();
        document.body.style.overflow = '';
        ctx.navigate('/projects');
      });
      modal.querySelector('[data-open-project]').addEventListener('click', () => {
        document.querySelector('.modal-backdrop')?.remove();
        document.body.style.overflow = '';
        ctx.navigate(`/projects/${project.id}`);
      });
      modal.querySelectorAll('[data-action="copy-code"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.codeId;
          const text = document.getElementById(id)?.textContent || '';
          const ok = await copyToClipboard(text);
          toast(ok ? 'Config copied' : 'Copy failed', { type: ok ? 'success' : 'error' });
        });
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Reusable project actions                                           */
/* ------------------------------------------------------------------ */

export async function deleteProjectFlow(ctx, project) {
  const purge = await confirmDialog({
    title: `Delete "${project.name}"?`,
    description: 'The project and its connection configs will stop working immediately.',
    confirmLabel: 'Continue',
    danger: true,
    details: `
      <div class="perm-list">
        <div class="perm-item perm-item--deny">${icon('alert', { size: 14 })}<span>Both credentials are revoked right away</span></div>
        <div class="perm-item perm-item--allow">${icon('info', { size: 14 })}<span>You can choose whether to also delete stored data</span></div>
      </div>`,
  });
  if (!purge) return false;

  const purgeData = await confirmDialog({
    title: 'Also delete stored data?',
    description: 'Choose what happens to the records and files this project owns.',
    confirmLabel: 'Delete project + data',
    cancelLabel: 'Keep my data',
    danger: true,
    details: `
      <div class="row gap-12" style="justify-content:space-between">
        <div><div class="h3">${formatCount(project.usage?.records)} records</div><div class="muted">KV storage</div></div>
        <div><div class="h3">${formatCount(project.usage?.files)} files</div><div class="muted">Blob storage</div></div>
      </div>`,
  });

  const confirmName = await typeConfirm(project.name, purgeData);
  if (confirmName === null) return false;

  try {
    await deleteProject(project.id, { confirmName, purgeData });
    await ctx.refreshProjects();
    toast(`Project "${project.name}" deleted`, { type: 'success' });
    ctx.navigate('/projects');
    return true;
  } catch (error) {
    toast(error.message || 'Delete failed', { type: 'error' });
    return false;
  }
}

function formatCount(n) {
  return new Intl.NumberFormat().format(Number(n) || 0);
}

function typeConfirm(name, purgeData) {
  return new Promise((resolve) => {
    const id = `tc-${Math.random().toString(36).slice(2, 8)}`;
    openModal({
      title: 'Confirm deletion',
      description: purgeData
        ? 'Type the project name to permanently delete the project and all of its data.'
        : 'Type the project name to delete the project. Its stored data will be kept as orphaned data.',
      body: `
        <div class="field">
          <label class="field__label" for="${id}">Project name</label>
          <input class="input" id="${id}" data-input autocomplete="off" spellcheck="false" placeholder="${esc(name)}" />
        </div>`,
      footer: `
        <button class="btn btn--secondary" data-cancel>Cancel</button>
        <button class="btn btn--danger" data-ok disabled>${purgeData ? 'Delete everything' : 'Delete project'}</button>`,
      onMount(modal) {
        const input = modal.querySelector('[data-input]');
        const ok = modal.querySelector('[data-ok]');
        input.addEventListener('input', () => {
          ok.disabled = input.value.trim() !== name;
        });
        modal.querySelector('[data-cancel]').addEventListener('click', () => {
          closeModal();
          resolve(null);
        });
        ok.addEventListener('click', () => {
          closeModal();
          resolve(input.value.trim());
        });
      },
    });
  });
}

export async function rotateFlow(ctx, project, kind) {
  const label = kind === 'user' ? 'User Panel credential' : kind === 'admin' ? 'Admin secret' : 'both credentials';
  const ok = await confirmDialog({
    title: `Rotate ${label}?`,
    description: 'The current credential stops working immediately. Update every place that uses it.',
    confirmLabel: 'Rotate now',
    danger: kind !== 'user',
  });
  if (!ok) return null;

  try {
    const result = await rotateCredentials(project.id, kind);
    const config = await getConnectionConfig(project.id);
    toast(`${label} rotated`, { type: 'success' });

    openModal({
      title: 'New credentials',
      description: 'Copy this now. The old credential has already stopped working.',
      size: 'wide',
      body: renderCodeBlock({
        label: `${kind} credential`,
        code:
          kind === 'user'
            ? `Token   ${result.credentials.userToken}\nHeader  Authorization: Bearer ${result.credentials.userToken}`
            : kind === 'admin'
              ? `Token   ${result.credentials.adminSecret}\nHeader  Authorization: Bearer ${result.credentials.adminSecret}`
              : `User token    ${result.credentials.userToken}\nAdmin secret  ${result.credentials.adminSecret}`,
      }),
      footer: `<button class="btn btn--primary" data-close>Done</button>`,
      onMount(modal) {
        modal.querySelector('[data-close]').addEventListener('click', () => {
          document.querySelector('.modal-backdrop')?.remove();
          document.body.style.overflow = '';
        });
      },
    });

    return { result, config };
  } catch (error) {
    toast(error.message || 'Rotation failed', { type: 'error' });
    return null;
  }
}

export async function toggleStatusFlow(ctx, project) {
  const next = project.status === 'active' ? 'paused' : 'active';
  try {
    await updateProject(project.id, { status: next });
    await ctx.refreshProjects();
    toast(next === 'active' ? 'Project resumed' : 'Project paused — all API calls from it are rejected', {
      type: 'success',
    });
    return true;
  } catch (error) {
    toast(error.message || 'Could not update status', { type: 'error' });
    return false;
  }
}
