// The resume desk's own routes (/api/state, /api/save, …), shared by the local dashboard and the online desk.
import type { Json } from '../lib/api';

export async function desk(path: string, body?: Json): Promise<Json> {
  const res = await fetch(`/api/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.reload(); throw new Error('Sign in to continue.'); }
  if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
  return data;
}
export async function htmlOf(file: string): Promise<string> {
  const res = await fetch(`/HTML/${encodeURIComponent(file)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${file} could not be loaded (${res.status}).`);
  return res.text();
}
export const pdfUrl = (pdf: string) => `/PDF/${encodeURIComponent(pdf)}`;
