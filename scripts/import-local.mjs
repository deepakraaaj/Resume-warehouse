// npm run import-local -- you@example.com
// Copies the resumes in HTML/ and PDF/ on this machine into that account, keeping PDF names and measurements.
import fs from 'node:fs';
import path from 'node:path';
import { loadUsers, normaliseEmail } from '../lib/auth.mjs';
import { importResume, loadState } from '../lib/cloud.mjs';
import { listSources, pdfNameFor, readManifest, readFolders, HTML_DIR, PDF_DIR } from './resume-lib.mjs';

const email = normaliseEmail(process.argv[2]);
const user = (await loadUsers()).find(u => u.email === email);
if (!user) {
  console.error(`No account for "${email}". Create it first with npm run add-user.`);
  process.exit(1);
}
const existing = await loadState(user.id);
const metrics = new Map(readManifest().resumes.map(r => [r.file, r.metrics]));
for (const file of listSources()) {
  if (existing.resumes[file]) {
    console.log(`skip ${file} (already in the account)`);
    continue;
  }
  const pdf = pdfNameFor(file);
  const pdfFile = path.join(PDF_DIR, pdf);
  await importResume(user.id, {
    file,
    pdf,
    html: fs.readFileSync(path.join(HTML_DIR, file), 'utf8'),
    pdfBuffer: fs.existsSync(pdfFile) ? fs.readFileSync(pdfFile) : null,
    metrics: metrics.get(file),
    message: 'Imported from the laptop',
  });
  console.log(`imported ${file} -> ${pdf}`);
}
const folders = readFolders();
if (folders.length) console.log(`Note: empty folders (${folders.join(', ')}) are not imported; recreate them online.`);
console.log(`Done. ${email} now has ${Object.keys((await loadState(user.id)).resumes).length} resumes.`);
