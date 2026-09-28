// node scripts/build.mjs          -> refresh data/resumes.json (safe on Vercel: keeps the last measured numbers if pdfplumber is missing)
// node scripts/build.mjs --pdf    -> rebuild every PDF with Chrome, measure it, then refresh the manifest
// node scripts/build.mjs --pdf Deepakraj_Python_Developer_Resume.html   -> rebuild just that one
import path from 'node:path';
import { listSources, resolveSource, pdfNameFor, compilePdf, measurePdf, describe, readManifest, writeManifest, PDF_DIR } from './resume-lib.mjs';

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
process.exit(failed ? 1 : 0);
