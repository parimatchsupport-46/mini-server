/**
 * Login + first-run setup screens.
 */

import { icon } from '../components/icons.js';

export function renderLoginScreen({ error = '' } = {}) {
  return `
  <div class="auth__card">
    <div class="auth__mark">${icon('logo', { size: 27 })}</div>
    <h1 class="auth__title">Welcome back</h1>
    <p class="auth__desc">Sign in to manage your projects, records and files.</p>

    <div class="auth__error ${error ? '' : 'hide'}" data-auth-error>
      ${icon('alert', { size: 16 })}<span>${error}</span>
    </div>

    <form class="auth__form" id="login-form" autocomplete="on">
      <div class="field">
        <label class="field__label" for="email">Email</label>
        <input class="input" id="email" name="email" type="email" autocomplete="username"
          placeholder="you@example.com" required autofocus />
      </div>
      <div class="field">
        <label class="field__label" for="password">Password</label>
        <input class="input" id="password" name="password" type="password" autocomplete="current-password"
          placeholder="Your admin password" required />
      </div>
      <button class="btn btn--primary btn--lg btn--block" type="submit">Sign in</button>
    </form>

    <div class="auth__foot">
      ${icon('lock', { size: 13 })}
      <span>Admin credentials are verified server-side and never exposed to the browser.</span>
    </div>
  </div>`;
}

export function renderSetupScreen({ setupKeyRequired = false, email = '' } = {}) {
  return `
  <div class="auth__card">
    <div class="auth__mark">${icon('logo', { size: 27 })}</div>
    <h1 class="auth__title">Set up your server</h1>
    <p class="auth__desc">
      Create the single admin account for this storage server. The password is hashed with
      PBKDF2-SHA256 before it is written to KV.
    </p>

    <div class="auth__error hide" data-auth-error></div>

    <form class="auth__form" id="setup-form">
      <div class="field">
        <label class="field__label" for="email">Admin email</label>
        <input class="input" id="email" name="email" type="email" value="${email || ''}"
          placeholder="you@example.com" required autofocus />
      </div>
      <div class="field">
        <label class="field__label" for="password">Admin password</label>
        <input class="input" id="password" name="password" type="password" autocomplete="new-password"
          placeholder="At least 10 characters" minlength="10" required />
        <div class="field__hint">Use at least 10 characters. There is no password reset, so store it safely.</div>
      </div>
      ${
        setupKeyRequired
          ? `<div class="field">
               <label class="field__label" for="setupKey">Setup key</label>
               <input class="input" id="setupKey" name="setupKey" type="password" placeholder="ADMIN_SETUP_KEY value" required />
               <div class="field__hint">This server requires the ADMIN_SETUP_KEY environment variable.</div>
             </div>`
          : ''
      }
      <button class="btn btn--primary btn--lg btn--block" type="submit">Create admin account</button>
    </form>

    <div class="auth__foot">
      ${icon('shield', { size: 13 })}
      <span>Setup can only run once. The endpoint locks itself after the first account.</span>
    </div>
  </div>`;
}
