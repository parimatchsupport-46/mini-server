/**
 * Auth service — dashboard session handling.
 * The session token is kept in localStorage and sent as a Bearer header.
 * No admin secret ever touches the browser beyond this opaque session token.
 */

import { api, clearToken, getToken, setToken } from './api.js';

let currentUser = null;

export async function fetchStatus() {
  return api.get('/api/auth/status', { noAuth: true });
}

export async function login({ email, password }) {
  const result = await api.post('/api/auth/login', { email, password }, { noAuth: true });
  if (result?.token) setToken(result.token);
  currentUser = { email: result.email };
  return result;
}

export async function setup({ email, password, setupKey }) {
  const result = await api.post('/api/auth/setup', { email, password, setupKey }, { noAuth: true });
  if (result?.token) setToken(result.token);
  currentUser = { email: result.email };
  return result;
}

export async function me() {
  if (!getToken()) return null;
  try {
    currentUser = await api.get('/api/auth/me');
    return currentUser;
  } catch {
    return null;
  }
}

export function getUser() {
  return currentUser;
}

export function isAuthenticated() {
  return Boolean(getToken());
}

export function logout() {
  clearToken();
  currentUser = null;
}

export async function changePassword(payload) {
  const result = await api.post('/api/auth/password', payload);
  if (result?.token) setToken(result.token);
  return result;
}

export async function changeEmail(payload) {
  return api.post('/api/auth/email', payload);
}
