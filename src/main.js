/**
 * Application entry point.
 */

// CSS order is deliberate: tokens/base -> dashboard -> responsive overrides.
import './styles/main.css';
import './styles/dashboard.css';
import './styles/responsive.css';
import { boot } from './app.js';

function mount() {
  let root = document.getElementById('app');
  if (!root) {
    root = document.createElement('div');
    root.id = 'app';
    document.body.prepend(root);
  }
  boot(root).catch((error) => {
    console.error('[boot] failed', error);
    root.innerHTML = `
      <div class="auth">
        <div class="auth__card">
          <div class="auth__title">Cannot start the dashboard</div>
          <p class="auth__desc">${String(error?.message || error)}</p>
          <button class="btn btn--primary btn--block" onclick="location.reload()">Reload</button>
        </div>
      </div>`;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
