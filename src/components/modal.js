/**
 * Modal + confirm dialogs. One modal at a time, focus-trapped, ESC to close.
 */

import { qs } from '../utils/helpers.js';
import { icon } from './icons.js';

let active = null;

export function closeModal() {
  if (!active) return;
  const { backdrop, previousFocus } = active;
  backdrop.style.opacity = '0';
  setTimeout(() => backdrop.remove(), 140);
  document.body.style.overflow = '';
  active = null;
  if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {string} options.body       HTML for the modal body
 * @param {string} [options.footer]   HTML for the footer (buttons)
 * @param {'default'|'wide'} [options.size]
 * @param {boolean} [options.dismissible]
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function openModal({
  title,
  description = '',
  body = '',
  footer = '',
  size = 'default',
  dismissible = true,
  onMount,
} = {}) {
  closeModal();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size === 'wide' ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal__head">
        <div class="grow">
          <div class="modal__title">${title}</div>
          ${description ? `<div class="modal__desc">${description}</div>` : ''}
        </div>
        ${
          dismissible
            ? `<button class="modal__close" data-modal-close aria-label="Close">${icon('x', { size: 16 })}</button>`
            : ''
        }
      </div>
      <div class="modal__body">${body}</div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
    </div>`;

  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  const previousFocus = document.activeElement;
  active = { backdrop, previousFocus };

  if (dismissible) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    backdrop.querySelector('[data-modal-close]')?.addEventListener('click', closeModal);
  }

  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) {
      closeModal();
      document.removeEventListener('keydown', onKey);
    }
    if (e.key === 'Tab') trapFocus(e, backdrop);
  };
  document.addEventListener('keydown', onKey);

  // Autofocus the first input or primary button
  requestAnimationFrame(() => {
    const target =
      backdrop.querySelector('[autofocus]') ||
      backdrop.querySelector('input, textarea, select') ||
      backdrop.querySelector('.btn--primary');
    target?.focus({ preventScroll: true });
  });

  if (onMount) onMount(backdrop.querySelector('.modal'));

  return { el: backdrop.querySelector('.modal'), close: closeModal };
}

function trapFocus(e, root) {
  const focusable = Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Confirmation dialog with optional typed confirmation.
 * Resolves true when confirmed.
 */
export function confirmDialog({
  title = 'Are you sure?',
  description = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  requireText = null, // e.g. the project name
  details = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };

    const id = `confirm-${Math.random().toString(36).slice(2, 8)}`;

    const { el } = openModal({
      title,
      description,
      body: `
        ${details ? `<div class="card card--pad" style="background:var(--surface-2);box-shadow:none">${details}</div>` : ''}
        ${
          requireText
            ? `<div class="field">
                 <label class="field__label" for="${id}">Type <b>${escapeHtml(requireText)}</b> to confirm</label>
                 <input class="input" id="${id}" data-confirm-input autocomplete="off" spellcheck="false" placeholder="${escapeHtml(requireText)}" />
                 <div class="field__hint">This action cannot be undone.</div>
               </div>`
            : ''
        }`,
      footer: `
        <button class="btn btn--secondary" data-cancel>${cancelLabel}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm ${requireText ? 'disabled' : ''}>${confirmLabel}</button>`,
      onMount(modal) {
        const input = modal.querySelector('[data-confirm-input]');
        const okBtn = modal.querySelector('[data-confirm]');
        if (input) {
          input.addEventListener('input', () => {
            okBtn.disabled = input.value.trim() !== requireText;
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !okBtn.disabled) okBtn.click();
          });
        }
        modal.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
        okBtn.addEventListener('click', () => finish(true));
      },
    });

    el.closest('.modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) finish(false);
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------- Toast system --------------------------- */

let toastHost = null;

export function toast(message, { type = 'info', duration = 3600 } = {}) {
  if (!toastHost) {
    toastHost = qs('.toasts') || (() => {
      const el = document.createElement('div');
      el.className = 'toasts';
      document.body.appendChild(el);
      return el;
    })();
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  el.innerHTML = `<span class="toast__icon">${icon(iconName, { size: 17 })}</span><span>${escapeHtml(message)}</span>`;
  toastHost.appendChild(el);

  const remove = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 200);
  };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}
