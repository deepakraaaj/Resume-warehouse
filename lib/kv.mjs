// JSON storage for the Job Hunt features. The online desk keeps it in private Blob storage; the local
// dashboard keeps it in .data/ next to the repo. Both expose the same get/put/del by key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_DIR = path.join(ROOT, '.data');

const cleanKey = key => {
  const k = String(key).replace(/\\/g, '/');
  if (!/^[\w./-]+$/.test(k) || k.includes('..')) throw new Error(`Bad storage key: ${k}`);
  return k;
};

function localStore() {
  const file = key => path.join(LOCAL_DIR, `${cleanKey(key)}.json`);
  return {
    async get(key, fallback = null) {
      try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); } catch { return fallback; }
    },
    async put(key, value) {
      const f = file(key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(value, null, 2));
    },
    async del(key) {
      fs.rmSync(file(key), { force: true });
    },
  };
}

async function blobStore() {
  const { readJson, writeJson, remove } = await import('./store.mjs');
  const p = key => `${cleanKey(key)}.json`;
  return {
    get: (key, fallback = null) => readJson(p(key), fallback),
    put: (key, value) => writeJson(p(key), value),
    del: key => remove(p(key)),
  };
}

let shared;
// Cloud when running on Vercel with a Blob token, files otherwise.
export async function getStore() {
  if (!shared) shared = process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN ? await blobStore() : localStore();
  return shared;
}

// A store whose keys all live under one user's prefix, so accounts never see each other's data.
export async function userStore(uid) {
  const base = await getStore();
  const prefix = `u/${cleanKey(uid)}/prep/`;
  return {
    get: (key, fallback) => base.get(prefix + key, fallback),
    put: (key, value) => base.put(prefix + key, value),
    del: key => base.del(prefix + key),
  };
}
