import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lint } from '../dashboard/public/rules.js';

const run = promisify(execFile);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HTML_DIR = path.join(ROOT, 'HTML');
export const PDF_DIR = path.join(ROOT, 'PDF');
export const MANIFEST = path.join(ROOT, 'data', 'resumes.json');

// These PDF names are already shared in job applications, so they stay fixed even where they differ from the source name.
const PDF_NAMES = {
  'Deepakraj_Forward_Deployed_Engineer_Resume01.html': 'Deepakraj_FDE.pdf',
  'Deepakraj_ERPNext_Developer_Resume.html': 'Deepakraj_B_Resume_ERPNext.pdf',
};
const EXTRA_COPIES = {
  'Deepakraj_Full_Stack_Engineer_Resume.html': ['DeepakrajB_Full_STACK.pdf'],
};

const MEASURE_PY = `
import sys, json, pdfplumber
with pdfplumber.open(sys.argv[1]) as pdf:
    page = pdf.pages[0]
    words = page.extract_words()
    if not words:
        print(json.dumps({"pages": len(pdf.pages)})); sys.exit()
    left = min(w["x0"] for w in words)
    right = page.width - max(w["x1"] for w in words)
    bottom = max(w["bottom"] for w in words)
    spare = page.height - bottom
    if len(pdf.pages) > 1:
        # Negative spare: roughly how much content spilled past page 1.
        spare = 0
        for extra in pdf.pages[1:]:
            ws = extra.extract_words()
            if ws:
                spare -= max(w["bottom"] for w in ws) - min(w["top"] for w in ws) + 4
    print(json.dumps({
        "pages": len(pdf.pages),
        "left": round(left, 2),
        "right": round(right, 2),
        "delta": round(abs(left - right), 2),
        "spare": round(spare, 2),
    }))
`;

export function listSources() {
  return fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html')).sort();
}

export function resolveSource(name) {
  const file = path.basename(String(name ?? ''));
  if (!listSources().includes(file)) throw new Error(`There is no resume called ${file} in HTML/.`);
  return file;
}

export function pdfNameFor(file) {
  return PDF_NAMES[file] ?? file.replace(/\.html$/, '.pdf');
}

const WORD_CASE = {
  ERPNEXT: 'ERPNext', GENAI: 'GenAI', AI: 'AI', AWS: 'AWS', TYPESCRIPT: 'TypeScript',
  LANGGRAPH: 'LangGraph', FASTAPI: 'FastAPI', 'MULTI-STEP': 'Multi-step',
};

function titleCase(s) {
  return s.trim().split(/(\s+|[(),/&])/).map(w => {
    if (!/[A-Z]/.test(w)) return w;
    return WORD_CASE[w] ?? w[0] + w.slice(1).toLowerCase();
  }).join('');
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return named[e.toLowerCase()] ?? m;
  });
}

export function visibleText(html) {
  return decodeEntities(html
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function describeRole(html, file) {
  const raw = html.match(/<div class="role-title">([^<]+)<\/div>/i)?.[1] ?? file.replace(/_/g, ' ').replace(/\.html$/, '');
  const [role, ...focus] = decodeEntities(raw).split('|');
  const roleName = titleCase(role);
  return {
    role: roleName,
    focus: titleCase(focus.join('|')),
    company: readMeta(html, 'company'),
    group: readMeta(html, 'group') || defaultGroup(roleName),
  };
}

// ---------- Creating and labelling resumes ----------

// Group and target company live in <meta name="resume:..."> tags: they travel with the file and git, and never print.
const metaRe = name => new RegExp(`<meta name="resume:${name}" content="([^"]*)">\\n?`, 'i');
const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function readMeta(html, name) {
  const m = html.match(metaRe(name));
  return m ? decodeEntities(m[1]) : '';
}

export function setMeta(html, name, value) {
  const clean = String(value ?? '').trim().slice(0, 60);
  const without = html.replace(metaRe(name), '');
  if (!clean) return without;
  const tag = `<meta name="resume:${name}" content="${escapeAttr(clean)}">\n`;
  return /<meta charset[^>]*>\n?/i.test(without)
    ? without.replace(/(<meta charset[^>]*>\n?)/i, m => m + tag)
    : without.replace(/<head>\n?/i, m => m + tag);
}

export const setCompany = (html, company) => setMeta(html, 'company', company);

// Starting folder for a resume that has not been placed in one yet.
export function defaultGroup(role) {
  const r = role.toLowerCase();
  if (r.includes('forward deployed')) return 'Forward Deployed';
  if (r.includes('full stack')) return 'Full Stack';
  if (/\b(genai|ai|ml|llm)\b/.test(r)) return 'AI & GenAI';
  if (/erp|frappe/.test(r)) return 'ERP';
  if (/backend|python|java|kotlin|developer/.test(r)) return 'Backend';
  return 'General';
}

export function setRole(html, role) {
  const clean = escapeText(role.trim().toUpperCase());
  const out = html.replace(/(<div class="role-title">)([^<]*)(<\/div>)/i, (m, a, text, b) => {
    const focus = text.split('|').slice(1).join('|');
    return a + clean + (focus ? ` |${focus}` : '') + b;
  });
  return out.replace(/(<title>[^<]*?-\s*)([^<]*?)(\s*Resume<\/title>)/i, (m, a, _, b) => `${a}${escapeText(titleCase(role.trim().toUpperCase()))}${b}`);
}

const slug = s => s.trim().split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('_');

export function newSourceName(role, company) {
  const base = `Deepakraj_${slug(role)}${company?.trim() ? `_${slug(company)}` : ''}_Resume`;
  const taken = new Set(listSources());
  let name = `${base}.html`;
  for (let i = 2; taken.has(name) || fs.existsSync(path.join(PDF_DIR, name.replace(/\.html$/, '.pdf'))); i++) name = `${base}_${i}.html`;
  return name;
}

// ---------- Folders, renaming and archiving ----------

export const FOLDERS_FILE = path.join(ROOT, 'data', 'folders.json');
export const ARCHIVE_DIR = path.join(ROOT, 'Archieve Resumes');

// Folders normally come from the resumes inside them; this file only remembers folders that are empty.
export function readFolders() {
  try {
    const list = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')).folders;
    return Array.isArray(list) ? list.filter(f => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

export function writeFolders(list) {
  fs.mkdirSync(path.dirname(FOLDERS_FILE), { recursive: true });
  const unique = [...new Set(list.map(f => f.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify({ folders: unique }, null, 2) + '\n');
}

export function cleanName(value, what) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 60) throw new Error(`Give the ${what} a name up to 60 characters.`);
  return name;
}

// A new HTML file name typed by the user: letters, digits, spaces, dots, dashes and underscores only.
export function cleanFileName(value) {
  const base = String(value ?? '').trim().replace(/\.(html|pdf)$/i, '').replace(/\s+/g, '_');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,90}$/.test(base)) throw new Error('Use letters, numbers, dashes and underscores for the file name.');
  return `${base}.html`;
}

// Moves a resume out of HTML/ and PDF/ into the archive folder. Nothing is deleted.
export function archiveResume(file) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const moved = [];
  const move = (from) => {
    if (!fs.existsSync(from)) return;
    let target = path.join(ARCHIVE_DIR, path.basename(from));
    if (fs.existsSync(target)) target = path.join(ARCHIVE_DIR, `${stamp}_${path.basename(from)}`);
    fs.renameSync(from, target);
    moved.push(path.relative(ROOT, target));
  };
  move(path.join(HTML_DIR, file));
  move(path.join(PDF_DIR, pdfNameFor(file)));
  return moved;
}

function printPdf(htmlPath, pdfPath) {
  return run('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
  ], { timeout: 60_000 });
}

export async function compilePdf(file) {
  const pdfName = pdfNameFor(file);
  const pdfPath = path.join(PDF_DIR, pdfName);
  fs.mkdirSync(PDF_DIR, { recursive: true });
  await printPdf(path.join(HTML_DIR, file), pdfPath);
  for (const copy of EXTRA_COPIES[file] ?? []) fs.copyFileSync(pdfPath, path.join(PDF_DIR, copy));
  return pdfPath;
}

// Prints unsaved HTML to a throwaway PDF and measures it, so drafts are checked with the real print engine.
export async function measureDraft(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-check-'));
  try {
    const htmlPath = path.join(dir, 'draft.html');
    const pdfPath = path.join(dir, 'draft.pdf');
    fs.writeFileSync(htmlPath, html, 'utf8');
    await printPdf(htmlPath, pdfPath);
    return await measurePdf(pdfPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function measurePdf(pdfPath) {
  if (!fs.existsSync(pdfPath)) return null;
  try {
    const { stdout } = await run('python3', ['-c', MEASURE_PY, pdfPath], { timeout: 30_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

const EXTRACT_PY = `
import sys, json, re, pdfplumber
with pdfplumber.open(sys.argv[1]) as pdf:
    text = "\\n".join((p.extract_text() or "") for p in pdf.pages)
    fonts = sorted({re.sub(r"^[A-Z]{6}\\+", "", c["fontname"]).split("-")[0] for p in pdf.pages for c in p.chars})
    print(json.dumps({"text": text, "fonts": fonts}))
`;

// Plain text in reading order, roughly what an applicant tracking system parses out of the PDF.
export async function extractPdfText(pdfPath) {
  if (!fs.existsSync(pdfPath)) return null;
  const { stdout } = await run('python3', ['-c', EXTRACT_PY, pdfPath], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export function describe(file, metrics) {
  const htmlPath = path.join(HTML_DIR, file);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const pdf = pdfNameFor(file);
  const pdfPath = path.join(PDF_DIR, pdf);
  const pdfStat = fs.existsSync(pdfPath) ? fs.statSync(pdfPath) : null;
  return {
    file,
    pdf,
    pdfExists: Boolean(pdfStat),
    ...describeRole(html, file),
    updatedAt: fs.statSync(htmlPath).mtime.toISOString(),
    pdfUpdatedAt: pdfStat ? pdfStat.mtime.toISOString() : null,
    metrics: pdfStat ? metrics : null,
    issues: lint(html, visibleText(html)),
  };
}

export function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return { resumes: [] };
  }
}

export function writeManifest(resumes) {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  const publicFields = resumes.map(({ stale, changed, ...r }) => r);
  fs.writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), resumes: publicFields }, null, 2) + '\n');
}
