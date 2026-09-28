// Per-user resume storage for the online desk. Every path is under u/<userId>/, so one account can never
// read or write another's files. The shapes returned match what the dashboard already expects.
import crypto from 'node:crypto';
import { readText, readBuffer, readJson, writeText, writeJson, write, copyBlob, remove } from './store.mjs';
import { printHtml, measurePdfBuffer, extractPdfTextBuffer } from './print.mjs';
import {
  describeHtml, visibleText, setMeta, setRole, setCompany, readMeta, cleanName, cleanFileName, baseSourceName,
} from '../scripts/resume-lib.mjs';

const MAX_VERSIONS = 50;
const MAX_HTML = 2 * 1024 * 1024;

const root = uid => `u/${uid}`;
const statePath = uid => `${root(uid)}/state.json`;
const htmlPath = (uid, file) => `${root(uid)}/html/${file}`;
const pdfPath = (uid, pdf) => `${root(uid)}/pdf/${pdf}`;
const versionPath = (uid, id, vid) => `${root(uid)}/versions/${id}/${vid}.html`;
const now = () => new Date().toISOString();
const newId = prefix => `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

export async function loadState(uid) {
  const state = await readJson(statePath(uid), null);
  return {
    resumes: state?.resumes ?? {},
    folders: state?.folders ?? [],
    archived: state?.archived ?? [],
  };
}

const saveState = (uid, state) => writeJson(statePath(uid), state);

export function snapshot(state) {
  const resumes = Object.entries(state.resumes)
    .map(([file, e]) => ({
      file,
      pdf: e.pdf,
      pdfExists: Boolean(e.pdfUpdatedAt),
      role: e.role,
      focus: e.focus,
      company: e.company,
      group: e.group,
      updatedAt: e.updatedAt,
      pdfUpdatedAt: e.pdfUpdatedAt,
      metrics: e.metrics ?? null,
      issues: e.issues ?? [],
      stale: false,
      changed: false,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
  return { mode: 'cloud', resumes, changes: [], folders: state.folders };
}

function entryFor(state, file) {
  const name = String(file ?? '');
  const entry = state.resumes[name];
  if (!entry) throw new Error(`There is no resume called ${name}.`);
  return [name, entry];
}

function checkHtml(html) {
  if (typeof html !== 'string' || !html.includes('<html')) throw new Error('The editor sent an empty or broken page, so nothing was saved.');
  if (Buffer.byteLength(html) > MAX_HTML) throw new Error('That page is larger than 2 MB.');
  return html;
}

function applyDescription(entry, html, file) {
  const d = describeHtml(html, file);
  Object.assign(entry, { role: d.role, focus: d.focus, company: d.company, group: d.group, issues: d.issues, updatedAt: now() });
}

async function addVersion(uid, entry, html, message) {
  const vid = newId('v');
  await writeText(versionPath(uid, entry.id, vid), html);
  entry.versions = [{ id: vid, date: now(), message }, ...(entry.versions ?? [])];
  const dropped = entry.versions.slice(MAX_VERSIONS);
  entry.versions = entry.versions.slice(0, MAX_VERSIONS);
  await remove(dropped.map(v => versionPath(uid, entry.id, v.id)));
}

// Writes the HTML, prints and measures the PDF, and records a version.
async function publish(uid, entry, file, html, message) {
  const pdf = await printHtml(html);
  const metrics = await measurePdfBuffer(pdf);
  await Promise.all([writeText(htmlPath(uid, file), html), write(pdfPath(uid, entry.pdf), pdf, 'application/pdf')]);
  applyDescription(entry, html, file);
  entry.metrics = metrics;
  entry.pdfUpdatedAt = now();
  await addVersion(uid, entry, html, message);
}

// Changes that do not affect the printed page (folder, company) skip printing and versioning.
async function writeHtmlOnly(uid, entry, file, html) {
  await writeText(htmlPath(uid, file), html);
  applyDescription(entry, html, file);
}

function uniqueFile(state, base) {
  let name = `${base}.html`;
  const pdfs = new Set(Object.values(state.resumes).map(e => e.pdf));
  for (let i = 2; state.resumes[name] || pdfs.has(name.replace(/\.html$/, '.pdf')); i++) name = `${base}_${i}.html`;
  return name;
}

// ---------- Actions ----------

export async function readHtml(uid, file) {
  const state = await loadState(uid);
  const [name] = entryFor(state, file);
  return readText(htmlPath(uid, name));
}

export async function readPdf(uid, pdfName) {
  const state = await loadState(uid);
  const found = Object.values(state.resumes).find(e => e.pdf === pdfName);
  if (!found) return null;
  return readBuffer(pdfPath(uid, found.pdf));
}

export async function save(uid, { file, html, message }) {
  const state = await loadState(uid);
  const [name, entry] = entryFor(state, file);
  await publish(uid, entry, name, checkHtml(html), String(message ?? '').trim().slice(0, 120) || 'Edited');
  await saveState(uid, state);
  return snapshot(state);
}

export async function check(html) {
  return { metrics: await measurePdfBuffer(await printHtml(checkHtml(html))) };
}

export async function build(uid, { files }) {
  const state = await loadState(uid);
  const names = Array.isArray(files) && files.length ? files : Object.keys(state.resumes);
  for (const file of names) {
    const [name, entry] = entryFor(state, file);
    const html = await readText(htmlPath(uid, name));
    const pdf = await printHtml(html);
    entry.metrics = await measurePdfBuffer(pdf);
    await write(pdfPath(uid, entry.pdf), pdf, 'application/pdf');
    entry.pdfUpdatedAt = now();
  }
  await saveState(uid, state);
  return snapshot(state);
}

export async function create(uid, { from, role, company, group }) {
  const state = await loadState(uid);
  const [source] = entryFor(state, from);
  const title = String(role ?? '').trim();
  if (title.length < 2 || title.length > 80) throw new Error('Give the role a name between 2 and 80 characters.');
  let html = setCompany(setRole(await readText(htmlPath(uid, source)), title), company);
  if (group) html = setMeta(html, 'group', cleanName(group, 'folder'));
  const file = uniqueFile(state, baseSourceName(title, company));
  const entry = { id: newId('r'), pdf: file.replace(/\.html$/, '.pdf'), versions: [] };
  state.resumes[file] = entry;
  await publish(uid, entry, file, html, `Created from ${source}`);
  await saveState(uid, state);
  return { ...snapshot(state), created: file };
}

export async function details(uid, { file, group, company }) {
  const state = await loadState(uid);
  const [name, entry] = entryFor(state, file);
  let html = await readText(htmlPath(uid, name));
  if (group !== undefined) html = setMeta(html, 'group', cleanName(group, 'folder'));
  if (company !== undefined) html = setMeta(html, 'company', company);
  await writeHtmlOnly(uid, entry, name, html);
  await saveState(uid, state);
  return snapshot(state);
}

export async function folder(uid, { action, name, to }) {
  const state = await loadState(uid);
  const from = cleanName(name, 'folder');
  const members = Object.entries(state.resumes).filter(([, e]) => e.group === from);
  if (action === 'create') {
    if (!state.folders.includes(from)) state.folders.push(from);
  } else if (action === 'rename') {
    const target = cleanName(to, 'folder');
    for (const [file, entry] of members) {
      await writeHtmlOnly(uid, entry, file, setMeta(await readText(htmlPath(uid, file)), 'group', target));
    }
    state.folders = [...new Set(state.folders.map(f => (f === from ? target : f)))];
  } else if (action === 'delete') {
    if (members.length) throw new Error(`${from} still has ${members.length} resume${members.length > 1 ? 's' : ''}. Move or archive them first.`);
    state.folders = state.folders.filter(f => f !== from);
  } else {
    throw new Error('Unknown folder action.');
  }
  state.folders.sort((a, b) => a.localeCompare(b));
  await saveState(uid, state);
  return snapshot(state);
}

export async function renameCompany(uid, { name, to }) {
  const state = await loadState(uid);
  const from = cleanName(name, 'company');
  const target = String(to ?? '').trim();
  for (const [file, entry] of Object.entries(state.resumes)) {
    if (entry.company !== from) continue;
    const html = await readText(htmlPath(uid, file));
    if (readMeta(html, 'company') === from) await writeHtmlOnly(uid, entry, file, setMeta(html, 'company', target));
  }
  await saveState(uid, state);
  return snapshot(state);
}

export async function rename(uid, { file, name }) {
  const state = await loadState(uid);
  const [from, entry] = entryFor(state, file);
  const to = cleanFileName(name);
  if (to === from) return snapshot(state);
  if (state.resumes[to]) throw new Error(`${to} already exists.`);
  const newPdf = to.replace(/\.html$/, '.pdf');
  if (Object.values(state.resumes).some(e => e !== entry && e.pdf === newPdf)) throw new Error(`${newPdf} already exists.`);
  await copyBlob(htmlPath(uid, from), htmlPath(uid, to));
  if (entry.pdfUpdatedAt) await copyBlob(pdfPath(uid, entry.pdf), pdfPath(uid, newPdf));
  await remove([htmlPath(uid, from), entry.pdfUpdatedAt && entry.pdf !== newPdf ? pdfPath(uid, entry.pdf) : null]);
  delete state.resumes[from];
  entry.pdf = newPdf;
  state.resumes[to] = entry;
  await saveState(uid, state);
  return { ...snapshot(state), renamed: to };
}

export async function archive(uid, { file }) {
  const state = await loadState(uid);
  const [name, entry] = entryFor(state, file);
  const stamp = now().replace(/[:.]/g, '-');
  const moved = [`${root(uid)}/archive/${stamp}_${name}`];
  await copyBlob(htmlPath(uid, name), moved[0]);
  if (entry.pdfUpdatedAt) {
    moved.push(`${root(uid)}/archive/${stamp}_${entry.pdf}`);
    await copyBlob(pdfPath(uid, entry.pdf), moved[1]);
  }
  await remove([htmlPath(uid, name), entry.pdfUpdatedAt ? pdfPath(uid, entry.pdf) : null]);
  delete state.resumes[name];
  state.archived.push({ file: name, pdf: entry.pdf, id: entry.id, date: now(), paths: moved });
  await saveState(uid, state);
  return { ...snapshot(state), moved };
}

export async function ats(uid, file) {
  const state = await loadState(uid);
  const [name, entry] = entryFor(state, file);
  if (!entry.pdfUpdatedAt) throw new Error('This resume has no PDF yet. Build it first.');
  const [pdf, html] = await Promise.all([readBuffer(pdfPath(uid, entry.pdf)), readText(htmlPath(uid, name))]);
  return extractPdfTextBuffer(pdf, visibleText(html ?? ''));
}

export async function history(uid, file, authorName) {
  const state = await loadState(uid);
  const [, entry] = entryFor(state, file);
  return {
    commits: (entry.versions ?? []).map(v => ({ hash: v.id, author: authorName, date: v.date, subject: v.message })),
    changed: false,
  };
}

export async function version(uid, file, vid) {
  const state = await loadState(uid);
  const [, entry] = entryFor(state, file);
  if (!(entry.versions ?? []).some(v => v.id === vid)) throw new Error('That version does not exist.');
  return { html: await readText(versionPath(uid, entry.id, vid)) };
}

export async function exportFiles(uid) {
  const state = await loadState(uid);
  const files = [];
  for (const [name, entry] of Object.entries(state.resumes)) {
    const html = await readBuffer(htmlPath(uid, name));
    if (html) files.push({ name: `HTML/${name}`, data: html });
    if (entry.pdfUpdatedAt) {
      const pdf = await readBuffer(pdfPath(uid, entry.pdf));
      if (pdf) files.push({ name: `PDF/${entry.pdf}`, data: pdf });
    }
  }
  return files;
}

// Used by the import script: adds a resume with an existing PDF and measurements, without reprinting.
export async function importResume(uid, { file, pdf, html, pdfBuffer, metrics, message }) {
  const state = await loadState(uid);
  const entry = state.resumes[file] ?? { id: newId('r'), versions: [] };
  entry.pdf = pdf;
  await writeText(htmlPath(uid, file), html);
  if (pdfBuffer) {
    await write(pdfPath(uid, pdf), pdfBuffer, 'application/pdf');
    entry.pdfUpdatedAt = now();
    entry.metrics = metrics ?? await measurePdfBuffer(pdfBuffer);
  }
  applyDescription(entry, html, file);
  await addVersion(uid, entry, html, message);
  state.resumes[file] = entry;
  await saveState(uid, state);
}
