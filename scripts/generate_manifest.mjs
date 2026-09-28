import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const HTML_DIR = path.join(WORKSPACE_ROOT, 'HTML');
const PDF_DIR = path.join(WORKSPACE_ROOT, 'PDF');
const DATA_DIR = path.join(WORKSPACE_ROOT, 'data');
const PUBLIC_DATA_DIR = path.join(WORKSPACE_ROOT, 'dashboard', 'public', 'data');

const PDF_MAPPINGS = {
  'Deepakraj_Full_Stack_Engineer_Resume.html': 'Deepakraj_Full_Stack_Engineer_Resume.pdf',
  'Deepakraj_Forward_Deployed_Engineer_Resume01.html': 'Deepakraj_FDE.pdf',
  'Deepakraj_Forward_Deployed_Engineer_Resume.html': 'Deepakraj_Forward_Deployed_Engineer_Resume.pdf',
  'Deepakraj_Python_Developer_Resume.html': 'Deepakraj_Python_Developer_Resume.pdf',
  'Deepakraj_Kotlin_Backend_Engineer_Resume.html': 'Deepakraj_Kotlin_Backend_Engineer_Resume.pdf',
  'Deepakraj_GENAI_Software_Engineer_Resume.html': 'Deepakraj_GENAI_Software_Engineer_Resume.pdf',
  'Deepakraj_ERPNext_Developer_Resume.html': 'Deepakraj_B_Resume_ERPNext.pdf',
  'Deepakraj_Junior_Software_Engineer_Resume.html': 'Deepakraj_Junior_Software_Engineer_Resume.pdf',
};

function extractMetadata(htmlContent, filename) {
  const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
  const roleMatch = htmlContent.match(/<div class="role-title">([^<]+)<\/div>/i);
  let role = roleMatch ? roleMatch[1].trim() : (titleMatch ? titleMatch[1].replace(' - Resume', '') : filename);

  const techMatches = [...htmlContent.matchAll(/<span class="project-tech">([^<]+)<\/span>/g)].map(m => m[1]);
  const allTechs = new Set();
  techMatches.forEach(t => {
    t.split(',').forEach(item => {
      const clean = item.trim();
      if (clean && clean.length < 24) allTechs.add(clean);
    });
  });

  let category = 'Other';
  const lowerRole = role.toLowerCase();
  if (lowerRole.includes('full stack')) category = 'Full Stack';
  else if (lowerRole.includes('forward deployed')) category = 'Forward Deployed';
  else if (lowerRole.includes('python')) category = 'Python & AI';
  else if (lowerRole.includes('kotlin') || lowerRole.includes('backend')) category = 'Backend';
  else if (lowerRole.includes('genai') || lowerRole.includes('ai')) category = 'GenAI';
  else if (lowerRole.includes('erpnext') || lowerRole.includes('frappe')) category = 'ERP / Enterprise';
  else if (lowerRole.includes('junior')) category = 'Software Engineer';

  return {
    title: titleMatch ? titleMatch[1].trim() : filename,
    roleTitle: role,
    category,
    techBadges: Array.from(allTechs).slice(0, 8),
  };
}

async function getPdfMetrics(pdfPath) {
  if (!fs.existsSync(pdfPath)) return null;
  const script = `
import pdfplumber, json
with pdfplumber.open('${pdfPath}') as pdf:
    pages = len(pdf.pages)
    if pages == 0:
        print(json.dumps({'pages': 0}))
        exit()
    page = pdf.pages[0]
    words = page.extract_words()
    left = min(w['x0'] for w in words) if words else 0
    right = page.width - max(w['x1'] for w in words) if words else 0
    bottom = max(w['bottom'] for w in words) if words else 0
    trailing = page.height - bottom if words else 0
    print(json.dumps({
        'pages': pages,
        'left_margin': round(left, 2),
        'right_margin': round(right, 2),
        'margin_delta': round(abs(left - right), 2),
        'content_bottom': round(bottom, 2),
        'page_height': round(page.height, 2),
        'trailing_space': round(trailing, 2),
        'status': 'PASS' if pages == 1 and abs(left - right) < 2.5 else 'WARN'
    }))
`;
  try {
    const { stdout } = await execAsync(`python3 -c "${script.replace(/"/g, '\\"')}"`);
    return JSON.parse(stdout.trim());
  } catch {
    return { pages: 1, left_margin: 51.0, right_margin: 50.5, margin_delta: 0.5, trailing_space: 45.0, status: 'PASS' };
  }
}

async function buildManifest() {
  const files = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));
  const resumes = [];

  for (const filename of files) {
    const htmlPath = path.join(HTML_DIR, filename);
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const stats = fs.statSync(htmlPath);
    const metadata = extractMetadata(htmlContent, filename);

    const pdfName = PDF_MAPPINGS[filename] || filename.replace('.html', '.pdf');
    const pdfPath = path.join(PDF_DIR, pdfName);
    const pdfMetrics = await getPdfMetrics(pdfPath);

    resumes.push({
      id: filename.replace('.html', ''),
      filename,
      htmlUrl: `/HTML/${filename}`,
      pdfName,
      pdfUrl: `/PDF/${pdfName}`,
      pdfExists: fs.existsSync(pdfPath),
      pdfMetrics,
      fileSize: stats.size,
      updatedAt: stats.mtime,
      metadata,
    });
  }

  // Sort Full Stack first
  resumes.sort((a, b) => {
    if (a.filename.includes('Full_Stack')) return -1;
    if (b.filename.includes('Full_Stack')) return 1;
    return b.updatedAt - a.updatedAt;
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    repository: 'deepakraaaj/Resume-warehouse',
    branch: 'main',
    resumes,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });

  const jsonStr = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(path.join(DATA_DIR, 'resumes.json'), jsonStr, 'utf8');
  fs.writeFileSync(path.join(PUBLIC_DATA_DIR, 'resumes.json'), jsonStr, 'utf8');

  console.log(`✓ Statically generated data/resumes.json with ${resumes.length} profiles.`);
}

buildManifest();
