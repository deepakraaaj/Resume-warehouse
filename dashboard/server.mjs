import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ROOT, HTML_DIR, PDF_DIR, listSources, resolveSource, pdfNameFor,
  compilePdf, measurePdf, measureDraft, extractPdfText, describe, readManifest, writeManifest,
  setCompany, setMeta, setRole, newSourceName,
  readFolders, writeFolders, cleanName, cleanFileName, archiveResume, readMeta,
} from '../scripts/resume-lib.mjs';

const run = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4000;
const PUBLIC_DIR = path.join(ROOT, 'dashboard', 'public');
const MAX_BODY = 2 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// pdf path -> { mtimeMs, metrics }; seeded from the manifest so startup doesn't re-measure unchanged PDFs.
const metricsCache = new Map();
{
  const manifest = readManifest();
  const builtAt = Date.parse(manifest.generatedAt ?? 0);
  for (const r of manifest.resumes) {
    const pdfPath = path.join(PDF_DIR, r.pdf);
    if (r.metrics && fs.existsSync(pdfPath) && fs.statSync(pdfPath).mtimeMs <= builtAt) {
      metricsCache.set(pdfPath, { mtimeMs: fs.statSync(pdfPath).mtimeMs, metrics: r.metrics });
    }
  }
}

async function metricsFor(file) {
  const pdfPath = path.join(PDF_DIR, pdfNameFor(file));
  if (!fs.existsSync(pdfPath)) return null;
  const { mtimeMs } = fs.statSync(pdfPath);
  const hit = metricsCache.get(pdfPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.metrics;
  const metrics = await measurePdf(pdfPath);
  metricsCache.set(pdfPath, { mtimeMs, metrics });
  return metrics;
}

async function uncommitted() {
  try {
    const { stdout } = await run('git', ['status', '--porcelain', '-z', '--', 'HTML', 'PDF', 'data'], { cwd: ROOT });
    return stdout.split('\0').filter(entry => entry.length > 3).map(entry => entry.slice(3));
  } catch {
    return [];
  }
}

async function snapshot() {
  const changes = await uncommitted();
  const resumes = [];
  for (const file of listSources()) {
    const record = describe(file, await metricsFor(file));
    const htmlTime = Date.parse(record.updatedAt);
    record.stale = !record.pdfExists || htmlTime - Date.parse(record.pdfUpdatedAt) > 1000;
    record.changed = changes.includes(`HTML/${file}`) || changes.includes(`PDF/${record.pdf}`);
    resumes.push(record);
  }
  return { mode: 'local', resumes, changes, folders: readFolders() };
}

async function rebuild(files) {
  for (const file of files) await compilePdf(file);
  const state = await snapshot();
  writeManifest(state.resumes);
  return snapshot();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request is too large.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Blocks other websites from driving this server through the browser: JSON forces a CORS preflight we never answer.
function isSameOriginJson(req) {
  const origin = req.headers.origin;
  const jsonBody = (req.headers['content-type'] ?? '').startsWith('application/json');
  return jsonBody && (!origin || origin === `http://${req.headers.host}`);
}

const routes = {
  'GET /api/state': async () => snapshot(),

  'GET /api/history': async (_, query) => {
    const file = resolveSource(query.get('file'));
    const { stdout } = await run('git', ['log', '-n', '40', '--format=%h%x1f%an%x1f%aI%x1f%s', '--', `HTML/${file}`], { cwd: ROOT });
    const commits = stdout.split('\n').filter(Boolean).map(line => {
      const [hash, author, date, subject] = line.split('\x1f');
      return { hash, author, date, subject };
    });
    const changed = (await uncommitted()).includes(`HTML/${file}`);
    return { commits, changed };
  },

  'GET /api/version': async (_, query) => {
    const file = resolveSource(query.get('file'));
    const commit = String(query.get('commit') ?? '');
    if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error('That is not a commit id.');
    const { stdout } = await run('git', ['show', `${commit}:HTML/${file}`], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 });
    return { html: stdout };
  },

  'GET /api/ats': async (_, query) => {
    const file = resolveSource(query.get('file'));
    const result = await extractPdfText(path.join(PDF_DIR, pdfNameFor(file)));
    if (!result) throw new Error('This resume has no PDF yet. Build it first.');
    return result;
  },

  // New and duplicate are the same action: copy a source resume, then set its role and company.
  'POST /api/create': async ({ from, role, company, group }) => {
    const source = resolveSource(from);
    const title = String(role ?? '').trim();
    if (title.length < 2 || title.length > 80) throw new Error('Give the role a name between 2 and 80 characters.');
    let html = fs.readFileSync(path.join(HTML_DIR, source), 'utf8');
    html = setCompany(setRole(html, title), company);
    if (group) html = setMeta(html, 'group', cleanName(group, 'folder'));
    const file = newSourceName(title, company);
    fs.writeFileSync(path.join(HTML_DIR, file), html, 'utf8');
    return { ...(await rebuild([file])), created: file };
  },

  'POST /api/folder': async ({ action, name, to }) => {
    const folders = readFolders();
    const from = cleanName(name, 'folder');
    const members = listSources().filter(f => describe(f, null).group === from);
    if (action === 'create') {
      writeFolders([...folders, from]);
    } else if (action === 'rename') {
      const target = cleanName(to, 'folder');
      for (const f of members) {
        const p = path.join(HTML_DIR, f);
        fs.writeFileSync(p, setMeta(fs.readFileSync(p, 'utf8'), 'group', target), 'utf8');
      }
      writeFolders(folders.map(f => (f === from ? target : f)).filter(f => f !== from || members.length === 0));
      if (members.length) return rebuild(members);
    } else if (action === 'delete') {
      if (members.length) throw new Error(`${from} still has ${members.length} resume${members.length > 1 ? 's' : ''}. Move or archive them first.`);
      writeFolders(folders.filter(f => f !== from));
    } else {
      throw new Error('Unknown folder action.');
    }
    return snapshot();
  },

  'POST /api/company-rename': async ({ name, to }) => {
    const from = cleanName(name, 'company');
    const target = String(to ?? '').trim();
    const members = listSources().filter(f => readMeta(fs.readFileSync(path.join(HTML_DIR, f), 'utf8'), 'company') === from);
    for (const f of members) {
      const p = path.join(HTML_DIR, f);
      fs.writeFileSync(p, setMeta(fs.readFileSync(p, 'utf8'), 'company', target), 'utf8');
    }
    return members.length ? rebuild(members) : snapshot();
  },

  'POST /api/rename': async ({ file, name }) => {
    const from = resolveSource(file);
    const to = cleanFileName(name);
    if (to === from) return snapshot();
    if (listSources().includes(to)) throw new Error(`${to} already exists.`);
    const oldPdf = path.join(PDF_DIR, pdfNameFor(from));
    const newPdf = path.join(PDF_DIR, to.replace(/\.html$/, '.pdf'));
    if (fs.existsSync(newPdf)) throw new Error(`${path.basename(newPdf)} already exists in PDF/.`);
    fs.renameSync(path.join(HTML_DIR, from), path.join(HTML_DIR, to));
    if (fs.existsSync(oldPdf)) fs.renameSync(oldPdf, newPdf);
    return { ...(await rebuild([to])), renamed: to };
  },

  'POST /api/archive': async ({ file }) => {
    const name = resolveSource(file);
    const moved = archiveResume(name);
    const state = await snapshot();
    writeManifest(state.resumes);
    return { ...(await snapshot()), moved };
  },

  'POST /api/details': async ({ file, group, company }) => {
    const name = resolveSource(file);
    const htmlPath = path.join(HTML_DIR, name);
    let html = fs.readFileSync(htmlPath, 'utf8');
    if (group !== undefined) html = setMeta(html, 'group', group);
    if (company !== undefined) html = setMeta(html, 'company', company);
    fs.writeFileSync(htmlPath, html, 'utf8');
    return rebuild([name]);
  },

  'POST /api/save': async ({ file, html }) => {
    const name = resolveSource(file);
    if (typeof html !== 'string' || !html.includes('<html')) throw new Error('The editor sent an empty or broken page, so nothing was saved.');
    fs.writeFileSync(path.join(HTML_DIR, name), html, 'utf8');
    return rebuild([name]);
  },

  'POST /api/check': async ({ html }) => {
    if (typeof html !== 'string' || !html.includes('<html')) throw new Error('Nothing to check.');
    return { metrics: await measureDraft(html) };
  },

  'POST /api/build': async ({ files }) => {
    const names = (Array.isArray(files) && files.length ? files : listSources()).map(resolveSource);
    return rebuild(names);
  },

  'POST /api/commit': async ({ message }) => {
    const text = String(message ?? '').trim() || 'Update resumes';
    await run('git', ['add', '--', 'HTML', 'PDF', 'data'], { cwd: ROOT });
    await run('git', ['commit', '-m', text], { cwd: ROOT });
    return snapshot();
  },
};

function serveStatic(pathname, res) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { decoded = ''; }

  let target;
  if (decoded === '/' || decoded === '/index.html') target = path.join(PUBLIC_DIR, 'index.html');
  else if (/^\/(HTML|PDF|data)\//.test(decoded)) target = path.join(ROOT, decoded);
  else target = path.join(PUBLIC_DIR, decoded);

  const allowed = [PUBLIC_DIR, HTML_DIR, PDF_DIR, path.join(ROOT, 'data')];
  const inside = allowed.some(dir => target === dir || target.startsWith(dir + path.sep));
  if (!inside || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const handler = routes[`${req.method} ${pathname}`];

  if (!handler) {
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint.' });
    return serveStatic(pathname, res);
  }
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')) {
    return send(res, 403, { error: 'Open the dashboard at http://localhost.' });
  }
  if (req.method === 'POST' && !isSameOriginJson(req)) {
    return send(res, 403, { error: 'Requests must come from the dashboard itself.' });
  }
  try {
    const body = req.method === 'POST' ? await readJson(req) : {};
    send(res, 200, await handler(body, searchParams));
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || String(err)).toString().trim().split('\n')[0];
    send(res, 400, { error: detail });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Resume dashboard: http://localhost:${PORT}`);
});
