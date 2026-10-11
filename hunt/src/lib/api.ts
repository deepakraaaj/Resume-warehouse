// Thin client for the desk's /api/prep routes. A 401 sends the person to the desk's sign-in page.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = any;

let onAfterPost: (() => void) | null = null;
export const afterPost = (fn: () => void) => { onAfterPost = fn; };

async function call(method: 'GET' | 'POST', route: string, payload?: Json): Promise<Json> {
  const url = method === 'GET' ? `/api/prep/${route}${payload ? `?${new URLSearchParams(payload)}` : ''}` : `/api/prep/${route}`;
  const res = await fetch(url, method === 'GET' ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/'; throw new Error('Sign in first.'); }
  if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
  if (method === 'POST') onAfterPost?.();
  return data;
}
export const get = (route: string, q?: Record<string, string>) => call('GET', route, q);
export const post = (route: string, body?: Json) => call('POST', route, body);
