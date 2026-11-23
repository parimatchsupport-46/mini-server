/**
 * Client-side config snippet generation & download helpers.
 * (The authoritative configs are produced by the server; these helpers format
 * them for copy/paste and file export.)
 */

import { esc } from './helpers.js';
import { icon } from '../components/icons.js';

export function renderSecretField({ id, value, label, masked = true, hint = '' }) {
  return `
  <div class="field">
    <div class="field__label">
      ${esc(label)}
      ${hint ? `<span class="muted" style="font-weight:500">${esc(hint)}</span>` : ''}
    </div>
    <div class="secret-field ${masked ? '' : 'is-revealed'}" data-secret-field>
      <code data-secret-value>${esc(masked ? maskSecret(value) : value)}</code>
      <button class="btn btn--ghost btn--icon" type="button" data-action="toggle-secret" title="Show / hide">
        ${icon(masked ? 'eye' : 'eyeOff', { size: 15 })}
      </button>
      <button class="btn btn--ghost btn--icon" type="button" data-action="copy-secret" title="Copy">
        ${icon('copy', { size: 15 })}
      </button>
    </div>
  </div>`;
}

export function maskSecret(value) {
  const s = String(value || '');
  if (s.length <= 14) return '•'.repeat(Math.max(8, s.length));
  return `${s.slice(0, 10)}${'•'.repeat(22)}${s.slice(-4)}`;
}

export function renderCodeBlock({ label, code, language = 'bash' }) {
  const id = `code-${Math.random().toString(36).slice(2, 9)}`;
  return `
  <div class="code-block">
    <div class="code__head">
      <span class="code__label">${esc(label || language)}</span>
      <button class="btn" type="button" data-action="copy-code" data-code-id="${id}">${icon('copy', { size: 12 })} Copy</button>
    </div>
    <pre class="code" id="${id}">${highlight(code)}</pre>
  </div>`;
}

/** Very small shell/JSON highlighter — safe because input is escaped first. */
function highlight(code) {
  const raw = String(code || '');
  return raw
    .split('\n')
    .map((line) => {
      // Only < and > need escaping inside <pre> to guarantee no markup injection;
      // escaping ' and " would leak entities into copied commands.
      let out = String(line).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      out = out.replace(/(#.*)$/g, '<span class="code__muted">$1</span>');
      out = out.replace(/(Bearer\s+)([A-Za-z0-9._-]+)/g, '$1<span class="code__secret">$2</span>');
      out = out.replace(/((?:usr_|adm_|etu1\.)[A-Za-z0-9._-]+)/g, '<span class="code__secret">$1</span>');
      out = out.replace(/\b(curl|fetch|await|method|headers|body|JSON\.stringify)\b/g, '<span style="color:#8ab4ff">$1</span>');
      return out;
    })
    .join('\n');
}

export function buildEnvFile(config) {
  return `# ${config.projectName || 'Storage Server project'} — environment
STORAGE_API_BASE=${config.apiBase}
STORAGE_PROJECT_ID=${config.projectId}

# Public frontend credential — write-only, safe to ship in a browser bundle
VITE_STORAGE_USER_TOKEN=${config.userToken}

# Server-side credential — keep this out of any client bundle
STORAGE_ADMIN_SECRET=${config.adminSecret}
`;
}

export function buildClientSnippet(config) {
  return `// storage-client.js — safe to import in your public frontend
const API = "${config.apiBase}";
const PROJECT_ID = "${config.projectId}";
const USER_TOKEN = import.meta.env.VITE_STORAGE_USER_TOKEN;

/** Send a contact form submission (write-only). */
export async function sendContactForm(data) {
  const res = await fetch(\`\${API}/data\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${USER_TOKEN}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      type: "json",
      kind: "contact",
      key: "contact-form",
      content: data,
    }),
  });
  if (!res.ok) throw new Error(\`Storage error \${res.status}\`);
  return res.json();
}

/** Upload an image or document. */
export async function uploadMedia(file) {
  const form = new FormData();
  form.append("file", file);
  form.append("projectId", PROJECT_ID);
  const res = await fetch(\`\${API}/files\`, {
    method: "POST",
    headers: { "Authorization": \`Bearer \${USER_TOKEN}\` },
    body: form,
  });
  if (!res.ok) throw new Error(\`Upload error \${res.status}\`);
  return res.json();
}
`;
}

export function downloadTextFile(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function downloadJsonFile(name, data) {
  downloadTextFile(name, JSON.stringify(data, null, 2), 'application/json');
}
