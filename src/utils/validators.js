/**
 * Client-side validation mirroring server/index.js rules.
 * Server-side checks always run too — this is only for instant feedback.
 */

import { LIMITS, RECORD_TYPES } from '../../server/core.js';

export function validateProjectName(name) {
  const v = String(name || '').trim();
  if (!v) return 'Project name is required.';
  if (v.length < 2) return 'Use at least 2 characters.';
  if (v.length > 60) return 'Keep it under 60 characters.';
  if (!/^[\w .()&+'\-]+$/u.test(v)) return 'Only letters, numbers, spaces and . ( ) & + \' - are allowed.';
  return null;
}

export function validateEmail(email) {
  const v = String(email || '').trim();
  if (!v) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(password, { strict = false } = {}) {
  const v = String(password || '');
  if (!v) return 'Password is required.';
  if (v.length < 10) return 'Use at least 10 characters.';
  if (strict) {
    if (!/[a-z]/.test(v)) return 'Add a lowercase letter.';
    if (!/[A-Z]/.test(v)) return 'Add an uppercase letter.';
    if (!/[0-9]/.test(v)) return 'Add a number.';
  }
  return null;
}

export function passwordStrength(password) {
  const v = String(password || '');
  let score = 0;
  if (v.length >= 10) score += 1;
  if (v.length >= 14) score += 1;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score += 1;
  if (/[0-9]/.test(v)) score += 1;
  if (/[^A-Za-z0-9]/.test(v)) score += 1;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  return { score, label: labels[Math.min(score, 5)], percent: (score / 5) * 100 };
}

export function validateRecordDraft({ type, content }) {
  if (!RECORD_TYPES.includes(type)) return 'Choose a record type (JSON or TXT).';
  if (type === 'json') {
    const raw = String(content ?? '').trim();
    if (!raw) return 'JSON content cannot be empty.';
    try {
      JSON.parse(raw);
    } catch (error) {
      return `Invalid JSON: ${error.message}`;
    }
  }
  return null;
}

export function estimateRecordBytes({ type, content, key, tags = [] }) {
  const draft = JSON.stringify({ type, content, key, tags });
  return new Blob([draft]).size;
}

export function validateFile(file) {
  const maxBytes = LIMITS.FILE_MAX_BYTES;
  if (!file) return 'Choose a file first.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > maxBytes) {
    return `File is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${Math.round(maxBytes / 1048576)} MB.`;
  }
  return null;
}

export function validateProjectId(id) {
  return /^prj_[a-z0-9]{6,24}$/.test(String(id || '')) ? null : 'Invalid project id.';
}

export function validateUrl(value) {
  try {
    const u = new URL(String(value));
    return ['http:', 'https:'].includes(u.protocol) ? null : 'URL must start with http:// or https://';
  } catch {
    return 'Enter a valid URL.';
  }
}
