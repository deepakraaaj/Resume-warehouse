// Thin wrapper over a private Vercel Blob store. Paths are stable; reads bypass the CDN so a save is
// visible on the very next request.
import { put, get, del, copy, list } from '@vercel/blob';

const ACCESS = { access: 'private' };

export async function readBuffer(pathname) {
  const result = await get(pathname, { ...ACCESS, useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export async function readText(pathname) {
  const buffer = await readBuffer(pathname);
  return buffer ? buffer.toString('utf8') : null;
}

export async function readJson(pathname, fallback) {
  const text = await readText(pathname);
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function write(pathname, body, contentType) {
  return put(pathname, body, {
    ...ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge: 60,
  });
}

export const writeText = (pathname, text, type = 'text/html; charset=utf-8') => write(pathname, text, type);
export const writeJson = (pathname, value) => write(pathname, JSON.stringify(value, null, 2), 'application/json');

export function copyBlob(from, to) {
  return copy(from, to, { ...ACCESS, addRandomSuffix: false, allowOverwrite: true });
}

export async function remove(pathnames) {
  const list = [pathnames].flat().filter(Boolean);
  if (list.length) await del(list);
}

export async function listPaths(prefix) {
  const paths = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    paths.push(...page.blobs.map(b => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths;
}
