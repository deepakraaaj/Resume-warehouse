// Prints resume HTML to PDF with a bundled Chromium and measures the result, with no system Chrome or Python.
// Used by the Vercel functions; locally CHROME_PATH can point at an installed Chrome instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');

// Families the resumes and the Design panel ask for, mapped to bundled files. This mirrors what the
// original laptop build printed with (Segoe UI is not installed there, so it fell back to Noto Sans).
const FACES = [
  { families: ['Segoe UI', 'Noto Sans'], regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' },
  { families: ['Arial', 'Helvetica', 'Liberation Sans'], regular: 'LiberationSans-Regular.ttf', bold: 'LiberationSans-Bold.ttf' },
  { families: ['Times New Roman', 'Liberation Serif'], regular: 'LiberationSerif-Regular.ttf', bold: 'LiberationSerif-Bold.ttf' },
  { families: ['Noto Serif', 'Georgia'], regular: 'NotoSerif-Regular.ttf', bold: 'NotoSerif-Bold.ttf' },
  { families: ['Ubuntu Sans'], variable: 'UbuntuSans-Variable.ttf' },
];

function fontCss() {
  const src = file => `url("${pathToFileURL(path.join(FONT_DIR, file)).href}") format("truetype")`;
  const rules = [];
  for (const face of FACES) {
    for (const family of face.families) {
      if (face.variable) {
        rules.push(`@font-face{font-family:"${family}";src:${src(face.variable)};font-weight:100 900;}`);
      } else {
        rules.push(`@font-face{font-family:"${family}";src:${src(face.regular)};font-weight:400;}`);
        rules.push(`@font-face{font-family:"${family}";src:${src(face.bold)};font-weight:700;}`);
      }
    }
  }
  return `<style data-print-fonts>${rules.join('')}</style>`;
}

const withFonts = html => (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + fontCss()) : fontCss() + html);

let browserPromise = null;

async function browser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b?.connected) return b;
  }
  browserPromise = (async () => {
    const { default: puppeteer } = await import('puppeteer-core');
    if (process.env.CHROME_PATH) {
      return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });
    }
    const { default: chromium } = await import('@sparticuz/chromium');
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });
  })();
  return browserPromise;
}

export async function printHtml(html) {
  const b = await browser();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, withFonts(html), 'utf8');
  const page = await b.newPage();
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false }));
  } finally {
    await page.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- Measuring (mirrors the pdfplumber numbers used before) ----------

// pdfplumber boxes each glyph from the font's descent up to one em. Noto, Liberation and Ubuntu Sans
// Noto Sans reports a descent of 0.293 em; this matched pdfplumber to within 0.01 pt on all 8 resumes.
const DESCENT = 0.293;

async function openPdf(buffer) {
  // Loading the worker module directly runs pdf.js on this thread and lets Vercel bundle the file.
  const [{ getDocument }, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]);
  globalThis.pdfjsWorker ??= worker;
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  doc.release = () => task.destroy();
  return doc;
}

async function textBoxes(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const { width, height } = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const boxes = [];
  for (const item of content.items) {
    const text = item.str ?? '';
    if (!text.trim()) continue;
    const [a, b, , , e, f] = item.transform;
    const size = Math.hypot(a, b);
    // Drop the width of trailing spaces so a run's right edge is its last visible glyph.
    const visible = text.replace(/\s+$/, '').length;
    const w = item.width * (visible / text.length);
    const leading = text.length - text.replace(/^\s+/, '').length;
    const x0 = e + item.width * (leading / text.length);
    boxes.push({ text, size, x0, x1: e + w, top: height - (f + (1 - DESCENT) * size), bottom: height - (f - DESCENT * size), baseline: height - f });
  }
  return { width, height, boxes };
}

export async function measurePdfBuffer(buffer) {
  const doc = await openPdf(buffer);
  try {
    const pages = doc.numPages;
    const first = await textBoxes(doc, 1);
    if (!first.boxes.length) return { pages };
    const left = Math.min(...first.boxes.map(b => b.x0));
    const right = first.width - Math.max(...first.boxes.map(b => b.x1));
    let spare = first.height - Math.max(...first.boxes.map(b => b.bottom));
    if (pages > 1) {
      spare = 0;
      for (let n = 2; n <= pages; n++) {
        const { boxes } = await textBoxes(doc, n);
        if (boxes.length) spare -= Math.max(...boxes.map(b => b.bottom)) - Math.min(...boxes.map(b => b.top)) + 4;
      }
    }
    const r2 = v => Math.round(v * 100) / 100;
    return { pages, left: r2(left), right: r2(right), delta: r2(Math.abs(left - right)), spare: r2(spare) };
  } finally {
    await doc.release();
  }
}

// pdf.js spells letter-spaced headings as "P R O F I L E". Rejoin such runs, then split them back into
// words using the resume's own vocabulary ("PROFESSIONALEXPERIENCE" -> "PROFESSIONAL EXPERIENCE").
function unspace(line, vocabulary) {
  // Runs of 1-2 character capitals (kerned pairs like "AT" stay together), mostly single letters.
  return line.replace(/(?:^|(?<= ))(?:[A-Z0-9&]{1,2} ){2,}[A-Z0-9&]{1,2}(?= |$)/g, run => {
    const tokens = run.split(' ');
    if (tokens.filter(t => t.length === 1).length / tokens.length < 0.6) return run;
    const joined = tokens.join('');
    if (!vocabulary.size) return joined;
    const upper = joined.toUpperCase();
    const best = [0];
    const from = [];
    for (let i = 1; i <= upper.length; i++) {
      best[i] = Infinity;
      for (let j = Math.max(0, i - 24); j < i; j++) {
        if (best[j] === Infinity) continue;
        const piece = upper.slice(j, i);
        const cost = best[j] + (vocabulary.has(piece) ? 1 : 10 * piece.length);
        if (cost < best[i]) { best[i] = cost; from[i] = j; }
      }
    }
    const parts = [];
    for (let i = upper.length; i > 0; i = from[i]) parts.unshift(joined.slice(from[i], i));
    return parts.join(' ');
  });
}

// Plain text in reading order, the way an applicant tracking system reads the PDF.
// `sourceText` (the resume's visible text) is only used to restore word breaks in letter-spaced headings.
export async function extractPdfTextBuffer(buffer, sourceText = '') {
  const vocabulary = new Set(sourceText.toUpperCase().match(/[A-Z0-9&+#./-]+/g) ?? []);
  const doc = await openPdf(buffer);
  try {
    const lines = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const { boxes } = await textBoxes(doc, n);
      boxes.sort((p, q) => p.baseline - q.baseline || p.x0 - q.x0);
      let row = [];
      let y = null;
      const flush = () => {
        if (!row.length) return;
        row.sort((p, q) => p.x0 - q.x0);
        let out = '';
        let lastX = null;
        for (const b of row) {
          // Letter-spaced headings leave small gaps between glyphs; only a gap near a space's width splits words.
          if (lastX != null && b.x0 - lastX > Math.max(1.5, 0.22 * b.size) && !out.endsWith(' ')) out += ' ';
          out += b.text;
          lastX = b.x1;
        }
        lines.push(unspace(out.replace(/\s+/g, ' ').trim(), vocabulary));
        row = [];
      };
      for (const b of boxes) {
        if (y != null && Math.abs(b.baseline - y) > 2) flush();
        y = b.baseline;
        row.push(b);
      }
      flush();
    }
    const raw = buffer.toString('latin1');
    const fonts = [...new Set([...raw.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([A-Za-z0-9-]+)/g)].map(m => m[1].split('-')[0]))].sort();
    return { text: lines.join('\n'), fonts };
  } finally {
    await doc.release();
  }
}

export async function closeBrowser() {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}
