// node scripts/build.mjs          -> refresh data/resumes.json (safe on Vercel: keeps the last measured numbers if pdfplumber is missing)
// node scripts/build.mjs --pdf    -> rebuild every PDF with Chrome, measure it, then refresh the manifest
// node scripts/build.mjs --pdf Deepakraj_Python_Developer_Resume.html   -> rebuild just that one
// node scripts/build.mjs --site   -> also assemble public/ for Vercel (read-only site, only what it needs)
import fs from 'node:fs';
import path from 'node:path';
import { listSources, resolveSource, pdfNameFor, compilePdf, measurePdf, describe, readManifest, writeManifest, PDF_DIR, HTML_DIR, MANIFEST, ROOT } from './resume-lib.mjs';

const args = process.argv.slice(2);
const buildPdfs = args.includes('--pdf');
const only = args.filter(a => !a.startsWith('--')).map(resolveSource);
const previous = new Map(readManifest().resumes.map(r => [r.file, r.metrics]));

let failed = 0;
const resumes = [];

for (const file of listSources()) {
  if (buildPdfs && (only.length === 0 || only.includes(file))) {
    try {
      await compilePdf(file);
    } catch (err) {
      failed++;
      console.error(`x ${file}: Chrome could not build the PDF (${err.message.split('\n')[0]})`);
    }
  }
  const metrics = (await measurePdf(path.join(PDF_DIR, pdfNameFor(file)))) ?? previous.get(file) ?? null;
  const record = describe(file, metrics);
  resumes.push(record);

  const m = record.metrics;
  if (m && m.pages !== 1) failed++;
  const summary = m ? `${m.pages} page${m.pages === 1 ? '' : 's'}, ${m.spare} pt spare, margins ${m.left}/${m.right} pt` : 'not measured';
  const flag = !m ? '?' : m.pages === 1 ? 'ok' : 'x ';
  console.log(`${flag.padEnd(2)} ${record.pdf.padEnd(48)} ${summary}${record.issues.length ? `, ${record.issues.length} rule issue(s)` : ''}`);
}

writeManifest(resumes);
console.log(`\nWrote data/resumes.json (${resumes.length} resumes).`);

if (args.includes('--site')) {
  const out = path.join(ROOT, 'public');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'dashboard', 'public'), out, { recursive: true });
  fs.mkdirSync(path.join(out, 'HTML'), { recursive: true });
  fs.mkdirSync(path.join(out, 'PDF'), { recursive: true });
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });
  for (const r of resumes) {
    fs.copyFileSync(path.join(HTML_DIR, r.file), path.join(out, 'HTML', r.file));
    if (r.pdfExists) fs.copyFileSync(path.join(PDF_DIR, r.pdf), path.join(out, 'PDF', r.pdf));
  }
  fs.copyFileSync(MANIFEST, path.join(out, 'data', 'resumes.json'));
  console.log(`Assembled public/ with ${resumes.length} resumes.`);
}
process.exit(failed ? 1 : 0);
