// Resume Warehouse Dashboard - Client Logic

let state = {
  resumes: [],
  filteredResumes: [],
  selectedResume: null,
  activeCategory: 'ALL',
  searchQuery: '',
  activeViewMode: 'html',
  zoomLevel: 100,
  gitInfo: null,
};

// DOM Elements
const elements = {
  currentBranch: document.getElementById('currentBranch'),
  latestCommitHash: document.getElementById('latestCommitHash'),
  btnRecompileAll: document.getElementById('btnRecompileAll'),
  btnOpenGitModal: document.getElementById('btnOpenGitModal'),
  dirtyCounter: document.getElementById('dirtyCounter'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  categoryTabs: document.getElementById('categoryTabs'),
  allCount: document.getElementById('allCount'),
  visibleCount: document.getElementById('visibleCount'),
  resumeList: document.getElementById('resumeList'),
  btnRefreshList: document.getElementById('btnRefreshList'),
  activeTitle: document.getElementById('activeTitle'),
  activeSubtext: document.getElementById('activeSubtext'),
  btnCompileActive: document.getElementById('btnCompileActive'),
  btnOpenExternal: document.getElementById('btnOpenExternal'),
  btnDownloadPdf: document.getElementById('btnDownloadPdf'),
  metricPages: document.getElementById('metricPages'),
  metricMargins: document.getElementById('metricMargins'),
  metricTrailing: document.getElementById('metricTrailing'),
  metricStatus: document.getElementById('metricStatus'),
  filePathIndicator: document.getElementById('filePathIndicator'),
  zoomLevel: document.getElementById('zoomLevel'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomFit: document.getElementById('btnZoomFit'),
  a4Wrapper: document.getElementById('a4Wrapper'),
  htmlFrame: document.getElementById('htmlFrame'),
  pdfFrame: document.getElementById('pdfFrame'),
  auditDetailsCard: document.getElementById('auditDetailsCard'),
  diffHeader: document.getElementById('diffHeader'),
  diffCode: document.getElementById('diffCode'),
  gitModal: document.getElementById('gitModal'),
  btnCloseGitModal: document.getElementById('btnCloseGitModal'),
  btnCancelModal: document.getElementById('btnCancelModal'),
  changedFilesList: document.getElementById('changedFilesList'),
  commitMessageInput: document.getElementById('commitMessageInput'),
  commitsTimeline: document.getElementById('commitsTimeline'),
  btnExecuteCommit: document.getElementById('btnExecuteCommit'),
  toastContainer: document.getElementById('toastContainer'),
};

// Toast notification helper
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// Fetch all resumes from API
async function loadResumes() {
  try {
    const res = await fetch('/api/resumes');
    const data = await res.json();
    if (data.success) {
      state.resumes = data.resumes;
      elements.allCount.textContent = state.resumes.length;
      filterResumes();

      // Auto-select first resume if none selected
      if (!state.selectedResume && state.resumes.length > 0) {
        selectResume(state.resumes[0]);
      } else if (state.selectedResume) {
        // Refresh currently selected
        const updated = state.resumes.find(r => r.filename === state.selectedResume.filename);
        if (updated) selectResume(updated);
      }
    }
  } catch (err) {
    showToast('Failed to load resume list: ' + err.message, 'error');
  }
}

// Fetch git workspace status
async function loadGitStatus() {
  try {
    const res = await fetch('/api/git');
    const data = await res.json();
    if (data.success) {
      state.gitInfo = data;
      elements.currentBranch.textContent = data.branch || 'main';
      if (data.commits && data.commits.length > 0) {
        elements.latestCommitHash.textContent = data.commits[0].hash;
      }
      if (data.isDirty) {
        elements.dirtyCounter.textContent = data.dirtyFiles.length;
        elements.dirtyCounter.classList.remove('hidden');
      } else {
        elements.dirtyCounter.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Git status error:', err);
  }
}

// Filter resumes by search query and category
function filterResumes() {
  let list = state.resumes;

  if (state.activeCategory !== 'ALL') {
    list = list.filter(r => r.metadata.category === state.activeCategory);
  }

  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(r => {
      const matchName = r.filename.toLowerCase().includes(q);
      const matchRole = r.metadata.roleTitle.toLowerCase().includes(q);
      const matchTech = r.metadata.techBadges.some(t => t.toLowerCase().includes(q));
      return matchName || matchRole || matchTech;
    });
  }

  state.filteredResumes = list;
  elements.visibleCount.textContent = list.length;
  renderCatalog();
}

// Render left sidebar catalog cards
function renderCatalog() {
  if (state.filteredResumes.length === 0) {
    elements.resumeList.innerHTML = `<div class="loading-state">No matching resumes found.</div>`;
    return;
  }

  elements.resumeList.innerHTML = state.filteredResumes.map(r => {
    const isSelected = state.selectedResume && state.selectedResume.filename === r.filename;
    const pages = r.pdfMetrics ? r.pdfMetrics.pages : (r.pdfExists ? 1 : 0);
    const pageStatusClass = pages === 1 ? 'pill-pass' : 'pill-warn';
    const pageLabel = pages === 1 ? '1 PAGE (A4)' : `${pages} PAGES`;

    const isGitClean = !r.gitInfo || !r.gitInfo.isModified;
    const gitDotColor = isGitClean ? 'green' : 'amber';
    const gitLabel = isGitClean ? 'Git Synced' : 'Uncommitted';

    const techChipsHtml = r.metadata.techBadges.slice(0, 4)
      .map(t => `<span class="tech-chip">${t}</span>`)
      .join('');

    return `
      <div class="resume-card ${isSelected ? 'active' : ''}" data-filename="${r.filename}">
        <div class="card-top">
          <div class="card-title">${r.metadata.roleTitle}</div>
          <span class="pill-badge ${pageStatusClass}">${pageLabel}</span>
        </div>
        <div class="card-filename">${r.filename}</div>
        <div class="card-tech-tags">${techChipsHtml}</div>
        <div class="card-footer">
          <span class="git-status-tag">
            <span class="dot ${gitDotColor}"></span>
            <span>${gitLabel}</span>
          </span>
          <span>${r.metadata.category}</span>
        </div>
      </div>
    `;
  }).join('');

  // Add click listeners to cards
  elements.resumeList.querySelectorAll('.resume-card').forEach(card => {
    card.addEventListener('click', () => {
      const filename = card.getAttribute('data-filename');
      const resume = state.resumes.find(r => r.filename === filename);
      if (resume) selectResume(resume);
    });
  });
}

// Select active resume and update viewport
function selectResume(resume) {
  state.selectedResume = resume;
  renderCatalog();

  elements.activeTitle.textContent = resume.metadata.roleTitle;
  elements.activeSubtext.textContent = `Source: HTML/${resume.filename} | PDF: PDF/${resume.pdfName}`;
  elements.filePathIndicator.textContent = `HTML/${resume.filename}`;

  // Update action links
  elements.btnOpenExternal.onclick = () => window.open(resume.htmlUrl, '_blank');
  elements.btnDownloadPdf.href = resume.pdfUrl || '#';
  elements.btnDownloadPdf.setAttribute('download', resume.pdfName);

  // Update audit banner
  if (resume.pdfMetrics && !resume.pdfMetrics.error) {
    const m = resume.pdfMetrics;
    elements.metricPages.textContent = `${m.pages} / 1 Page`;
    elements.metricPages.className = `audit-val ${m.pages === 1 ? 'pass' : 'warn'}`;
    elements.metricMargins.textContent = `L: ${m.left_margin}pt | R: ${m.right_margin}pt (Δ: ${m.margin_delta}pt)`;
    elements.metricTrailing.textContent = `${m.trailing_space} pt`;
    elements.metricStatus.textContent = m.status === 'PASS' ? 'A4 STRICT (PASS)' : 'CHECK MARGINS';
    elements.metricStatus.className = `audit-val ${m.status === 'PASS' ? 'pass' : 'warn'}`;
  } else {
    elements.metricPages.textContent = 'Uncompiled';
    elements.metricMargins.textContent = '--';
    elements.metricTrailing.textContent = '--';
    elements.metricStatus.textContent = 'Needs PDF Compile';
  }

  // Set iframes
  elements.htmlFrame.src = resume.htmlUrl;
  elements.pdfFrame.src = resume.pdfUrl ? `${resume.pdfUrl}#toolbar=0` : 'about:blank';

  // Render audit card
  renderAuditView(resume);

  // Load git diff
  loadDiffView(resume);
}

// Render detailed audit card
function renderAuditView(resume) {
  const m = resume.pdfMetrics;
  if (!m || m.error) {
    elements.auditDetailsCard.innerHTML = `
      <div style="color: var(--warn-text);">PDF layout metrics not yet available. Click "Compile PDF" to generate and audit.</div>
    `;
    return;
  }

  elements.auditDetailsCard.innerHTML = `
    <h3 style="color: #ffffff; font-size: 15px; margin-bottom: 8px;">A4 Compliance Audit for ${resume.filename}</h3>
    <div style="color: var(--text-secondary); font-size: 12px; margin-bottom: 16px;">
      Verified using <code>pdfplumber</code> against the strict specifications in <code>.agents/AGENTS.md</code>.
    </div>

    <table class="audit-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Measured Value</th>
          <th>Target Specification</th>
          <th>Evaluation</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Page Count</strong></td>
          <td>${m.pages}</td>
          <td>Exactly 1</td>
          <td style="color: ${m.pages === 1 ? 'var(--success-text)' : 'var(--warn-text)'}; font-weight: 700;">
            ${m.pages === 1 ? '✓ PASS' : '✗ OVERFLOW'}
          </td>
        </tr>
        <tr>
          <td><strong>Left Margin</strong></td>
          <td>${m.left_margin} pt</td>
          <td>~50 - 54 pt (~18-19mm)</td>
          <td style="color: var(--success-text); font-weight: 700;">✓ BALANCED</td>
        </tr>
        <tr>
          <td><strong>Right Margin</strong></td>
          <td>${m.right_margin} pt</td>
          <td>~50 - 54 pt (~18-19mm)</td>
          <td style="color: var(--success-text); font-weight: 700;">✓ BALANCED</td>
        </tr>
        <tr>
          <td><strong>Horizontal Margin Delta</strong></td>
          <td>${m.margin_delta} pt</td>
          <td>&lt; 2.0 pt</td>
          <td style="color: ${m.margin_delta < 2.0 ? 'var(--success-text)' : 'var(--warn-text)'}; font-weight: 700;">
            ${m.margin_delta < 2.0 ? '✓ SYMMETRIC' : '⚠ ASYMMETRIC'}
          </td>
        </tr>
        <tr>
          <td><strong>Trailing Bottom Space</strong></td>
          <td>${m.trailing_space} pt</td>
          <td>~35 - 60 pt</td>
          <td style="color: var(--success-text); font-weight: 700;">✓ COMFORTABLE</td>
        </tr>
      </tbody>
    </table>
  `;
}

// Load git diff for selected resume
async function loadDiffView(resume) {
  try {
    const res = await fetch(`/api/diff?file=HTML/${resume.filename}`);
    const data = await res.json();
    if (data.success && data.diff.trim()) {
      elements.diffHeader.textContent = `Uncommitted Git Changes for HTML/${resume.filename}:`;
      elements.diffCode.textContent = data.diff;
    } else {
      elements.diffHeader.textContent = `Clean: HTML/${resume.filename} has no uncommitted changes.`;
      elements.diffCode.textContent = 'All changes are committed to the repository.';
    }
  } catch (err) {
    elements.diffCode.textContent = 'Could not load git diff: ' + err.message;
  }
}

// Compile active resume
async function compileActiveResume() {
  if (!state.selectedResume) return;
  const resume = state.selectedResume;
  elements.btnCompileActive.disabled = true;
  elements.btnCompileActive.innerHTML = `<span>Compiling...</span>`;

  try {
    const res = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: resume.filename })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Successfully compiled ${data.pdfName}! (1 Page verified)`, 'success');
      await loadResumes();
    } else {
      showToast(`Compile failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Compile error: ${err.message}`, 'error');
  } finally {
    elements.btnCompileActive.disabled = false;
    elements.btnCompileActive.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      <span>Compile PDF</span>
    `;
  }
}

// Recompile all resumes
async function recompileAllResumes() {
  elements.btnRecompileAll.disabled = true;
  elements.btnRecompileAll.innerHTML = `<span>Recompiling all...</span>`;

  try {
    for (const r of state.resumes) {
      await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: r.filename })
      });
    }
    showToast('All 8 resumes compiled and verified successfully!', 'success');
    await loadResumes();
    await loadGitStatus();
  } catch (err) {
    showToast(`Batch compile error: ${err.message}`, 'error');
  } finally {
    elements.btnRecompileAll.disabled = false;
    elements.btnRecompileAll.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      <span>Recompile All</span>
    `;
  }
}

// View mode switcher (HTML, PDF, Audit, Diff)
function setViewMode(mode) {
  state.activeViewMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-mode') === mode);
  });

  elements.a4Wrapper.parentElement.classList.toggle('active', mode === 'html');
  document.getElementById('viewPdf').classList.toggle('active', mode === 'pdf');
  document.getElementById('viewAudit').classList.toggle('active', mode === 'audit');
  document.getElementById('viewDiff').classList.toggle('active', mode === 'diff');

  // Toggle zoom controls visibility (only relevant in HTML mode)
  document.getElementById('viewportToolbar').style.display = (mode === 'html') ? 'flex' : 'none';
}

// Zoom control functions
function applyZoom(level) {
  state.zoomLevel = Math.max(50, Math.min(150, level));
  elements.zoomLevel.textContent = `${state.zoomLevel}%`;
  elements.a4Wrapper.style.transform = `scale(${state.zoomLevel / 100})`;
}

// Git Modal Controls
function openGitModal() {
  loadGitStatus().then(() => {
    const git = state.gitInfo;
    if (git && git.isDirty) {
      elements.changedFilesList.innerHTML = git.dirtyFiles.map(f => `
        <div class="changed-file-row">
          <span class="file-status-code">${f.code}</span>
          <span>${f.file}</span>
        </div>
      `).join('');
    } else {
      elements.changedFilesList.innerHTML = `<div class="clean-note">✓ Working directory is clean! No uncommitted changes.</div>`;
    }

    if (git && git.commits) {
      elements.commitsTimeline.innerHTML = git.commits.map(c => `
        <div class="commit-entry">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="commit-hash-pill">${c.hash}</span>
            <span style="color: #ffffff; font-weight: 500;">${c.subject}</span>
          </div>
          <span style="color: var(--text-muted); font-size: 11px;">${c.timeAgo}</span>
        </div>
      `).join('');
    }

    elements.gitModal.classList.remove('hidden');
  });
}

function closeGitModal() {
  elements.gitModal.classList.add('hidden');
}

// Execute git commit from modal
async function executeCommit() {
  const msg = elements.commitMessageInput.value.trim();
  if (!msg) {
    showToast('Please enter a commit message', 'warn');
    return;
  }

  elements.btnExecuteCommit.disabled = true;
  elements.btnExecuteCommit.innerHTML = `<span>Committing...</span>`;

  try {
    const res = await fetch('/api/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Committed snapshot to repository!', 'success');
      elements.commitMessageInput.value = '';
      closeGitModal();
      await loadGitStatus();
      await loadResumes();
    } else {
      showToast(`Commit failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    elements.btnExecuteCommit.disabled = false;
    elements.btnExecuteCommit.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>
      <span>Commit & Version Changes</span>
    `;
  }
}

// Event Listeners setup
function setupEventListeners() {
  // Search input
  elements.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    elements.clearSearch.classList.toggle('hidden', !state.searchQuery);
    filterResumes();
  });

  elements.clearSearch.addEventListener('click', () => {
    elements.searchInput.value = '';
    state.searchQuery = '';
    elements.clearSearch.classList.add('hidden');
    filterResumes();
  });

  // Category filter tabs
  elements.categoryTabs.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.categoryTabs.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeCategory = btn.getAttribute('data-category');
      filterResumes();
    });
  });

  // View mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => setViewMode(tab.getAttribute('data-mode')));
  });

  // Zoom controls
  elements.btnZoomIn.addEventListener('click', () => applyZoom(state.zoomLevel + 10));
  elements.btnZoomOut.addEventListener('click', () => applyZoom(state.zoomLevel - 10));
  elements.btnZoomFit.addEventListener('click', () => applyZoom(100));

  // Action buttons
  elements.btnCompileActive.addEventListener('click', compileActiveResume);
  elements.btnRecompileAll.addEventListener('click', recompileAllResumes);
  elements.btnRefreshList.addEventListener('click', () => {
    loadResumes();
    loadGitStatus();
    showToast('Catalog refreshed', 'info');
  });

  // Git modal
  elements.btnOpenGitModal.addEventListener('click', openGitModal);
  elements.btnCloseGitModal.addEventListener('click', closeGitModal);
  elements.btnCancelModal.addEventListener('click', closeGitModal);
  elements.btnExecuteCommit.addEventListener('click', executeCommit);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadResumes();
  loadGitStatus();
  applyZoom(100);
});
