import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const HTML_DIR = path.join(WORKSPACE_ROOT, 'HTML');
const PDF_DIR = path.join(WORKSPACE_ROOT, 'PDF');
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 4000;

// Mapping of HTML templates to target PDF files
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

// Friendly role labels & tags
function extractMetadata(htmlContent, filename) {
  const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
  const roleMatch = htmlContent.match(/<div class="role-title">([^<]+)<\/div>/i);
  
  let role = roleMatch ? roleMatch[1].trim() : (titleMatch ? titleMatch[1].replace(' - Resume', '') : filename);
  
  // Extract tech chips from project-tech spans
  const techMatches = [...htmlContent.matchAll(/<span class="project-tech">([^<]+)<\/span>/g)].map(m => m[1]);
  const allTechs = new Set();
  techMatches.forEach(t => {
    t.split(',').forEach(item => {
      const clean = item.trim();
      if (clean && clean.length < 24) allTechs.add(clean);
    });
  });

  // Category classifier
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

const metricsCache = new Map();

async function getPdfMetrics(pdfPath) {
  if (!fs.existsSync(pdfPath)) return null;
  const mtime = fs.statSync(pdfPath).mtimeMs;
  if (metricsCache.has(pdfPath)) {
    const cached = metricsCache.get(pdfPath);
    if (cached.mtime === mtime) {
      return cached.data;
    }
  }

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
    const data = JSON.parse(stdout.trim());
    metricsCache.set(pdfPath, { mtime, data });
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function getGitInfoForFile(filePath) {
  try {
    const relPath = path.relative(WORKSPACE_ROOT, filePath);
    const { stdout: logOut } = await execAsync(`git log -n 1 --pretty=format:"%h|%s|%ar|%an" -- "${relPath}"`, { cwd: WORKSPACE_ROOT });
    const { stdout: statusOut } = await execAsync(`git status --porcelain -- "${relPath}"`, { cwd: WORKSPACE_ROOT });
    
    let lastCommit = null;
    if (logOut) {
      const [hash, subject, timeAgo, author] = logOut.split('|');
      lastCommit = { hash, subject, timeAgo, author };
    }
    
    const isModified = statusOut.trim().length > 0;
    const statusCode = isModified ? statusOut.trim().slice(0, 2) : 'clean';

    return { lastCommit, isModified, statusCode };
  } catch {
    return { lastCommit: null, isModified: false, statusCode: 'clean' };
  }
}

async function listAllResumes() {
  if (!fs.existsSync(HTML_DIR)) return [];
  const files = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));

  const resumes = [];
  for (const filename of files) {
    const htmlPath = path.join(HTML_DIR, filename);
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const stats = fs.statSync(htmlPath);
    const metadata = extractMetadata(htmlContent, filename);

    const pdfName = PDF_MAPPINGS[filename] || filename.replace('.html', '.pdf');
    const pdfPath = path.join(PDF_DIR, pdfName);
    const pdfExists = fs.existsSync(pdfPath);
    const pdfStats = pdfExists ? fs.statSync(pdfPath) : null;
    const pdfMetrics = pdfExists ? await getPdfMetrics(pdfPath) : null;
    const gitInfo = await getGitInfoForFile(htmlPath);

    resumes.push({
      id: filename.replace('.html', ''),
      filename,
      htmlUrl: `/HTML/${filename}`,
      pdfName,
      pdfUrl: pdfExists ? `/PDF/${pdfName}` : null,
      pdfExists,
      pdfMetrics,
      fileSize: stats.size,
      updatedAt: stats.mtime,
      isOutOfSync: pdfExists ? stats.mtime > pdfStats.mtime : true,
      metadata,
      gitInfo,
    });
  }

  // Sort by priority (Full Stack & FDE first)
  resumes.sort((a, b) => {
    if (a.filename.includes('Full_Stack')) return -1;
    if (b.filename.includes('Full_Stack')) return 1;
    return b.updatedAt - a.updatedAt;
  });

  return resumes;
}

async function compileResume(filename) {
  const htmlPath = path.join(HTML_DIR, filename);
  if (!fs.existsSync(htmlPath)) throw new Error(`HTML file not found: ${filename}`);

  const pdfName = PDF_MAPPINGS[filename] || filename.replace('.html', '.pdf');
  const pdfPath = path.join(PDF_DIR, pdfName);

  const cmd = `google-chrome --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "file://${htmlPath}"`;
  await execAsync(cmd);

  // If Full Stack, also copy/sync DeepakrajB_Full_STACK.pdf
  if (filename === 'Deepakraj_Full_Stack_Engineer_Resume.html') {
    const altPdf = path.join(PDF_DIR, 'DeepakrajB_Full_STACK.pdf');
    await execAsync(`cp "${pdfPath}" "${altPdf}"`).catch(() => {});
  }

  const metrics = await getPdfMetrics(pdfPath);
  return { pdfName, metrics };
}

async function getGitWorkspaceStatus() {
  const { stdout: branchOut } = await execAsync('git branch --show-current', { cwd: WORKSPACE_ROOT });
  const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd: WORKSPACE_ROOT });
  const { stdout: logOut } = await execAsync('git log -n 5 --pretty=format:"%h%x09%s%x09%ar%x09%an"', { cwd: WORKSPACE_ROOT });

  const dirtyFiles = statusOut
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const code = line.slice(0, 2);
      const file = line.slice(3);
      return { code, file };
    });

  const commits = logOut
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, subject, timeAgo, author] = line.split('\t');
      return { hash, subject, timeAgo, author };
    });

  return {
    branch: branchOut.trim(),
    isDirty: dirtyFiles.length > 0,
    dirtyFiles,
    commits,
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local dev convenience
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API ROUTING ---
  if (pathname === '/api/resumes' && req.method === 'GET') {
    try {
      const resumes = await listAllResumes();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, resumes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/compile' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { filename } = JSON.parse(body || '{}');
        if (!filename) throw new Error('Filename required');
        const result = await compileResume(filename);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/git' && req.method === 'GET') {
    try {
      const gitStatus = await getGitWorkspaceStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...gitStatus }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/git/commit' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, files } = JSON.parse(body || '{}');
        if (!message) throw new Error('Commit message is required');

        const fileArgs = files && files.length > 0 ? files.map(f => `"${f}"`).join(' ') : 'HTML/ PDF/';
        await execAsync(`git add ${fileArgs}`, { cwd: WORKSPACE_ROOT });
        const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: WORKSPACE_ROOT });

        const newStatus = await getGitWorkspaceStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, output: stdout, ...newStatus }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/diff' && req.method === 'GET') {
    try {
      const file = parsedUrl.searchParams.get('file');
      if (!file) throw new Error('File parameter is required');
      const { stdout } = await execAsync(`git diff "${file}" || true`, { cwd: WORKSPACE_ROOT });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, diff: stdout }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // --- STATIC FILE SERVING ---
  let targetPath = null;
  if (pathname === '/' || pathname === '/index.html') {
    targetPath = path.join(PUBLIC_DIR, 'index.html');
  } else if (pathname.startsWith('/HTML/')) {
    targetPath = path.join(WORKSPACE_ROOT, pathname);
  } else if (pathname.startsWith('/PDF/')) {
    targetPath = path.join(WORKSPACE_ROOT, pathname);
  } else {
    // Serve from public directory
    targetPath = path.join(PUBLIC_DIR, pathname);
  }

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(targetPath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Resume Warehouse Dashboard running at:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
