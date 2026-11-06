import { nonEmpty } from './mail';

interface ApiBody {
  success?: boolean;
  error?: string;
}

/** The server answered 401: no valid login cookie. main.tsx turns it into a sign-out. */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

// Every endpoint answers `{ success, ... }` (or `{ success: false, error }`); anything else is an error.
async function request<T>(url: string, init: RequestInit, fallbackError: string): Promise<T> {
  const res = await fetch(url, init);
  // An error page from a proxy or a deploy in progress is not JSON: it fails like any other answer, with the fallback text.
  const data = await res.json<(T & ApiBody) | null>().catch(() => null);
  if (!res.ok || data?.success !== true) {
    const message = nonEmpty(data?.error) ?? fallbackError;
    throw res.status === 401 ? new UnauthorizedError(message) : new Error(message);
  }
  return data;
}

export function apiGet<T>(url: string, fallbackError: string, signal?: AbortSignal): Promise<T> {
  return request<T>(url, { signal }, fallbackError);
}

function sendJson<T>(method: 'POST' | 'PUT', url: string, body: unknown, fallbackError: string): Promise<T> {
  return request<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fallbackError);
}

export function apiPost<T>(url: string, body: unknown, fallbackError: string): Promise<T> {
  return sendJson<T>('POST', url, body, fallbackError);
}

export function apiPut<T>(url: string, body: unknown, fallbackError: string): Promise<T> {
  return sendJson<T>('PUT', url, body, fallbackError);
}

export function apiDelete<T>(url: string, fallbackError: string): Promise<T> {
  return request<T>(url, { method: 'DELETE' }, fallbackError);
}
