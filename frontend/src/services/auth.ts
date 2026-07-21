import { apiClient } from './api';

const TOKEN_KEY = 'fage_access_token';
const USER_KEY = 'fage_user';

export interface AuthUser {
  username: string;
  role: string;
  display_name: string;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  delete apiClient.defaults.headers.common['x-api-key'];
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  delete apiClient.defaults.headers.common['Authorization'];
  if (import.meta.env.VITE_FAGE_API_KEY) {
    apiClient.defaults.headers.common['x-api-key'] = import.meta.env.VITE_FAGE_API_KEY;
  } else {
    delete apiClient.defaults.headers.common['x-api-key'];
  }
}

export function bootstrapAuthHeaders() {
  const token = getStoredToken();
  if (token) {
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    delete apiClient.defaults.headers.common['x-api-key'];
  }
}

export async function loginRequest(username: string, password: string) {
  const formData = new URLSearchParams();
  formData.append('username', username);
  formData.append('password', password);
  const response = await apiClient.post<{
    access_token: string;
    token_type: string;
    expires_in: number;
    user: AuthUser;
  }>('/token', formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  setSession(response.data.access_token, response.data.user);
  return response.data;
}
