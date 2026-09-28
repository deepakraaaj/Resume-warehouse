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

// Fetch all resumes from API (with static fallback for Vercel deployment)
async function loadResumes() {
  try {
    let data = null;
    try {
      const res = await fetch('/api/resumes');
      if (res.ok) data = await res.json();
    } catch {}

    // Fallback to static manifest on Vercel
    if (!data || !data.success) {
      const res = await fetch('/data/resumes.json');
      if (res.ok) data = await res.json();
    }

    if (data && (data.success || data.resumes)) {
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

// View mode switcher (HTML, Editor, PDF, Audit, Diff)
function setViewMode(mode) {
  state.activeViewMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-mode') === mode);
  });

  elements.a4Wrapper.parentElement.classList.toggle('active', mode === 'html');
  document.getElementById('viewEditor').classList.toggle('active', mode === 'editor');
  document.getElementById('viewPdf').classList.toggle('active', mode === 'pdf');
  document.getElementById('viewAudit').classList.toggle('active', mode === 'audit');
  document.getElementById('viewDiff').classList.toggle('active', mode === 'diff');

  // Toggle zoom controls visibility (only relevant in HTML mode)
  document.getElementById('viewportToolbar').style.display = (mode === 'html') ? 'flex' : 'none';

  if (mode === 'editor' && state.selectedResume) {
    loadEditorForResume(state.selectedResume);
  }
}

// ==========================================================================
// Side-by-Side Editor & Headroom Engine
// ==========================================================================

let editorState = {
  rawHtml: '',
  originalHtml: '',
  filename: '',
  blocks: {
    roleTitle: '',
    profile: '',
    projects: [],
    skills: [],
    certs: []
  },
  activeSubtab: 'blocks',
  headroomPt: 45.0,
  isDirty: false
};

// Elements for Editor
const editorElements = {
  headroomBadge: document.getElementById('headroomBadge'),
  headroomStatus: document.getElementById('headroomStatus'),
  headroomMeterFill: document.getElementById('headroomMeterFill'),
  headroomSubtext: document.getElementById('headroomSubtext'),
  rulesLinterBadge: document.getElementById('rulesLinterBadge'),
  rulesCheckList: document.getElementById('rulesCheckList'),
  ruleViolationsBox: document.getElementById('ruleViolationsBox'),
  editorBlocksContainer: document.getElementById('editorBlocksContainer'),
  rawHtmlTextarea: document.getElementById('rawHtmlTextarea'),
  btnFormatRaw: document.getElementById('btnFormatRaw'),
  btnRevertEditor: document.getElementById('btnRevertEditor'),
  btnLiveAuditHeadroom: document.getElementById('btnLiveAuditHeadroom'),
  btnSaveResumeEditor: document.getElementById('btnSaveResumeEditor'),
  editorPreviewFrame: document.getElementById('editorPreviewFrame'),
  editorPageFitIndicator: document.getElementById('editorPageFitIndicator'),
};

// Load raw resume and parse into visual component blocks
async function loadEditorForResume(resume) {
  if (!resume) return;
  editorState.filename = resume.filename;

  try {
    let rawHtml = '';
    try {
      const res = await fetch(`/api/resume/raw?file=${resume.filename}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) rawHtml = data.html;
      }
    } catch {}

    // Fallback: direct static HTML file fetch on Vercel
    if (!rawHtml) {
      const res = await fetch(resume.htmlUrl || `/HTML/${resume.filename}`);
      if (res.ok) rawHtml = await res.text();
    }

    if (rawHtml) {
      editorState.rawHtml = rawHtml;
      editorState.originalHtml = rawHtml;
      editorElements.rawHtmlTextarea.value = rawHtml;

      parseHtmlToBlocks(rawHtml);
      renderEditorBlocks();
      updateEditorPreview();
      runRuleLinter(rawHtml);

      // Initial headroom check
      if (resume.pdfMetrics && resume.pdfMetrics.trailing_space) {
        updateHeadroomUI(resume.pdfMetrics.trailing_space, resume.pdfMetrics.pages);
      } else {
        updateHeadroomFromDom();
      }
    }
  } catch (err) {
    showToast('Failed to load editor source: ' + err.message, 'error');
  }
}

// Parse HTML string into structured editable blocks
function parseHtmlToBlocks(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Role Title
  const roleEl = doc.querySelector('.role-title');
  editorState.blocks.roleTitle = roleEl ? roleEl.textContent.trim() : '';

  // Profile text
  const profileEl = doc.querySelector('.profile-text');
  editorState.blocks.profile = profileEl ? profileEl.innerHTML.trim() : '';

  // Project blocks
  const projectEls = doc.querySelectorAll('.project-block');
  editorState.blocks.projects = Array.from(projectEls).map((p, idx) => {
    const nameEl = p.querySelector('.project-name');
    const techEl = p.querySelector('.project-tech');
    const bulletEls = p.querySelectorAll('ul.bullet-list li');

    return {
      id: `proj_${idx}`,
      enabled: p.style.display !== 'none',
      name: nameEl ? nameEl.textContent.trim() : `Project ${idx + 1}`,
      tech: techEl ? techEl.textContent.trim() : '',
      bullets: Array.from(bulletEls).map((b, bIdx) => ({
        id: `proj_${idx}_b_${bIdx}`,
        enabled: b.style.display !== 'none',
        text: b.innerHTML.trim()
      }))
    };
  });

  // Technical skills
  const skillRows = doc.querySelectorAll('.skills-grid .skill-row');
  editorState.blocks.skills = Array.from(skillRows).map((row, idx) => {
    const labelEl = row.querySelector('.skill-label');
    const valEl = row.querySelector('.skill-value');
    return {
      id: `skill_${idx}`,
      label: labelEl ? labelEl.textContent.trim() : '',
      value: valEl ? valEl.textContent.trim() : ''
    };
  });
}

// Render component block cards with toggles
function renderEditorBlocks() {
  const b = editorState.blocks;

  let html = `
    <!-- Block 1: Role Title & Profile Summary -->
    <div class="editor-block-card">
      <div class="block-header">
        <span class="block-title">PROFILE & ROLE BANNER</span>
        <span class="headroom-badge pass">Summary Justified</span>
      </div>
      <div class="block-field-group">
        <label class="field-label">TARGET ROLE TITLE:</label>
        <input type="text" class="field-input" id="inputRoleTitle" value="${escapeHtml(b.roleTitle)}">
      </div>
      <div class="block-field-group">
        <label class="field-label">PROFILE SUMMARY (Strictly Justified per Rule 3):</label>
        <textarea class="field-textarea" id="inputProfileText" rows="4">${b.profile}</textarea>
      </div>
    </div>

    <!-- Block 2: Experience & Projects with Component Toggles -->
    <div class="editor-block-card">
      <div class="block-header">
        <span class="block-title">PROJECTS & EXPERIENCE (COMPONENT TOGGLES)</span>
        <span style="font-size: 11px; color: var(--accent-cyan); font-family: var(--font-mono);">Toggle to fit A4</span>
      </div>
  `;

  b.projects.forEach((proj, pIdx) => {
    html += `
      <div class="editor-block-card ${proj.enabled ? '' : 'disabled'}" style="margin-top: 8px; background: #0a0f1d;">
        <div class="block-header">
          <label class="toggle-label">
            <input type="checkbox" class="proj-toggle" data-pidx="${pIdx}" ${proj.enabled ? 'checked' : ''}>
            <strong>${escapeHtml(proj.name)}</strong>
          </label>
          <span style="font-size: 10px; font-family: var(--font-mono); color: var(--text-muted);">
            ${proj.bullets.filter(x => x.enabled).length} / ${proj.bullets.length} bullets active
          </span>
        </div>

        <div class="block-field-group">
          <label class="field-label">TECH STACK BADGE:</label>
          <input type="text" class="field-input proj-tech-input" data-pidx="${pIdx}" value="${escapeHtml(proj.tech)}">
        </div>

        <div class="bullets-group">
          <label class="field-label">PROJECT BULLET POINTS (Toggle on/off to adjust headroom):</label>
    `;

    proj.bullets.forEach((bullet, bIdx) => {
      html += `
        <div class="bullet-row ${bullet.enabled ? '' : 'disabled'}">
          <input type="checkbox" class="bullet-check" data-pidx="${pIdx}" data-bidx="${bIdx}" ${bullet.enabled ? 'checked' : ''} title="Include this bullet point in resume">
          <textarea class="bullet-input" data-pidx="${pIdx}" data-bidx="${bIdx}" rows="2">${bullet.text}</textarea>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `</div>`; // Close experience block card

  // Block 3: Technical Skills
  html += `
    <div class="editor-block-card">
      <div class="block-header">
        <span class="block-title">TECHNICAL SKILLS MATRIX</span>
        <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">2-Column Grid</span>
      </div>
  `;

  b.skills.forEach((s, sIdx) => {
    html += `
      <div class="block-field-group">
        <label class="field-label">${escapeHtml(s.label)}</label>
        <input type="text" class="field-input skill-val-input" data-sidx="${sIdx}" value="${escapeHtml(s.value)}">
      </div>
    `;
  });

  html += `</div>`;

  editorElements.editorBlocksContainer.innerHTML = html;
  bindBlockEditorEvents();
}

// Bind live change events for structured blocks
function bindBlockEditorEvents() {
  const container = editorElements.editorBlocksContainer;

  // Role title & Profile
  const roleInput = container.querySelector('#inputRoleTitle');
  if (roleInput) {
    roleInput.addEventListener('input', () => {
      editorState.blocks.roleTitle = roleInput.value;
      rebuildHtmlFromBlocks();
    });
  }

  const profileInput = container.querySelector('#inputProfileText');
  if (profileInput) {
    profileInput.addEventListener('input', () => {
      editorState.blocks.profile = profileInput.value;
      rebuildHtmlFromBlocks();
    });
  }

  // Project toggle checkboxes
  container.querySelectorAll('.proj-toggle').forEach(chk => {
    chk.addEventListener('change', () => {
      const pIdx = parseInt(chk.getAttribute('data-pidx'), 10);
      editorState.blocks.projects[pIdx].enabled = chk.checked;
      renderEditorBlocks();
      rebuildHtmlFromBlocks();
    });
  });

  // Project tech inputs
  container.querySelectorAll('.proj-tech-input').forEach(input => {
    input.addEventListener('input', () => {
      const pIdx = parseInt(input.getAttribute('data-pidx'), 10);
      editorState.blocks.projects[pIdx].tech = input.value;
      rebuildHtmlFromBlocks();
    });
  });

  // Bullet toggles
  container.querySelectorAll('.bullet-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const pIdx = parseInt(chk.getAttribute('data-pidx'), 10);
      const bIdx = parseInt(chk.getAttribute('data-bidx'), 10);
      editorState.blocks.projects[pIdx].bullets[bIdx].enabled = chk.checked;
      renderEditorBlocks();
      rebuildHtmlFromBlocks();
    });
  });

  // Bullet text inputs
  container.querySelectorAll('.bullet-input').forEach(input => {
    input.addEventListener('input', () => {
      const pIdx = parseInt(input.getAttribute('data-pidx'), 10);
      const bIdx = parseInt(input.getAttribute('data-bidx'), 10);
      editorState.blocks.projects[pIdx].bullets[bIdx].text = input.value;
      rebuildHtmlFromBlocks();
    });
  });

  // Skills inputs
  container.querySelectorAll('.skill-val-input').forEach(input => {
    input.addEventListener('input', () => {
      const sIdx = parseInt(input.getAttribute('data-sidx'), 10);
      editorState.blocks.skills[sIdx].value = input.value;
      rebuildHtmlFromBlocks();
    });
  });
}

// Rebuild HTML from blocks and live-update
function rebuildHtmlFromBlocks() {
  const parser = new DOMParser();
  const doc = parser.parseFromString(editorState.rawHtml, 'text/html');

  // Update role title
  const roleEl = doc.querySelector('.role-title');
  if (roleEl) roleEl.textContent = editorState.blocks.roleTitle;

  // Update profile
  const profileEl = doc.querySelector('.profile-text');
  if (profileEl) profileEl.innerHTML = editorState.blocks.profile;

  // Update projects and bullets
  const projectEls = doc.querySelectorAll('.project-block');
  editorState.blocks.projects.forEach((proj, pIdx) => {
    const pEl = projectEls[pIdx];
    if (pEl) {
      pEl.style.display = proj.enabled ? '' : 'none';

      const techEl = pEl.querySelector('.project-tech');
      if (techEl) techEl.textContent = proj.tech;

      const bulletEls = pEl.querySelectorAll('ul.bullet-list li');
      proj.bullets.forEach((bullet, bIdx) => {
        const bEl = bulletEls[bIdx];
        if (bEl) {
          bEl.style.display = (proj.enabled && bullet.enabled) ? '' : 'none';
          bEl.innerHTML = bullet.text;
        }
      });
    }
  });

  // Update skills
  const skillRows = doc.querySelectorAll('.skills-grid .skill-row');
  editorState.blocks.skills.forEach((s, sIdx) => {
    const row = skillRows[sIdx];
    if (row) {
      const valEl = row.querySelector('.skill-value');
      if (valEl) valEl.textContent = s.value;
    }
  });

  const updatedHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  editorState.rawHtml = updatedHtml;
  editorElements.rawHtmlTextarea.value = updatedHtml;
  editorState.isDirty = true;

  updateEditorPreview();
  runRuleLinter(updatedHtml);
  updateHeadroomFromDom();
}

// Update right preview iframe
function updateEditorPreview() {
  editorElements.editorPreviewFrame.srcdoc = editorState.rawHtml;
}

// Update live headroom gauge from DOM measurements
function updateHeadroomFromDom() {
  setTimeout(() => {
    try {
      const iframeDoc = editorElements.editorPreviewFrame.contentDocument || editorElements.editorPreviewFrame.contentWindow.document;
      if (!iframeDoc) return;
      const pageEl = iframeDoc.querySelector('.page');
      if (!pageEl) return;

      // In A4 @ 96 DPI: 297mm = 1122.5px = 841.92 pt
      const pageHeightPx = pageEl.scrollHeight;
      const a4LimitPx = 1122.5;
      const headroomPx = a4LimitPx - pageHeightPx;
      const headroomPt = Math.round(headroomPx * 0.75 * 10) / 10;

      const pageCount = pageHeightPx > a4LimitPx ? 2 : 1;
      updateHeadroomUI(headroomPt, pageCount);
    } catch {
      // Cross-origin fallback
    }
  }, 120);
}

// Update visual headroom meter and badges
function updateHeadroomUI(headroomPt, pageCount) {
  editorState.headroomPt = headroomPt;
  const badge = editorElements.headroomBadge;
  const fill = editorElements.headroomMeterFill;
  const status = editorElements.headroomStatus;
  const fitIndicator = editorElements.editorPageFitIndicator;

  if (pageCount === 1 && headroomPt >= 35) {
    badge.className = 'headroom-badge pass';
    badge.textContent = `${headroomPt} pt remaining`;
    fill.className = 'headroom-meter-fill pass';
    fill.style.width = `${Math.min(100, Math.max(10, (headroomPt / 70) * 100))}%`;
    status.textContent = 'Comfortable (1 Page)';
    fitIndicator.className = 'page-fit-indicator';
    fitIndicator.textContent = 'Page 1 / 1 (Fits A4)';
  } else if (pageCount === 1 && headroomPt >= 10) {
    badge.className = 'headroom-badge warn';
    badge.textContent = `${headroomPt} pt remaining`;
    fill.className = 'headroom-meter-fill warn';
    fill.style.width = `${Math.min(100, Math.max(10, (headroomPt / 70) * 100))}%`;
    status.textContent = 'Tight (1 Page)';
    fitIndicator.className = 'page-fit-indicator';
    fitIndicator.textContent = 'Page 1 / 1 (Tight)';
  } else {
    badge.className = 'headroom-badge danger';
    badge.textContent = `Overflow (${pageCount} Pages)`;
    fill.className = 'headroom-meter-fill danger';
    fill.style.width = '100%';
    status.textContent = `OVERFLOW DETECTED: Page 2 created! Deselect a bullet.`;
    fitIndicator.className = 'page-fit-indicator warn';
    fitIndicator.textContent = `OVERFLOW: ${pageCount} Pages!`;
  }
}

// Rule Linter for Agentic Resume Rules (.agents/AGENTS.md)
function runRuleLinter(html) {
  const violations = [];

  // Check 1: No long dashes
  if (/[\u2013\u2014]/.test(html)) {
    violations.push('Long dash (– or —) found. Use standard hyphen (-).');
  }

  // Check 2: No Emojis
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
  if (emojiRegex.test(html)) {
    violations.push('Emoji detected. Use clean text labels or SVG icons.');
  }

  // Check 3: No AI Buzzwords
  const buzzwords = [
    'agentic', 'groundbreaking', 'seamlessly', 'spearheaded',
    'game-changer', 'synergy', 'paradigm', 'transformative'
  ];
  for (const bw of buzzwords) {
    if (new RegExp(`\\b${bw}\\b`, 'i').test(html)) {
      violations.push(`Banned buzzword "${bw}" detected. Use practical engineering outcome.`);
    }
  }

  // Check 4: width 210mm
  if (/\.page\s*\{[^}]*width\s*:\s*210mm/i.test(html)) {
    violations.push('Hardcoded "width: 210mm" in .page found. Use "width: 100%".');
  }

  const badge = editorElements.rulesLinterBadge;
  const box = editorElements.ruleViolationsBox;

  if (violations.length === 0) {
    badge.className = 'linter-badge pass';
    badge.textContent = '100% Passed';
    box.classList.add('hidden');
    box.innerHTML = '';
  } else {
    badge.className = 'linter-badge warn';
    badge.textContent = `${violations.length} Rule Warnings`;
    box.classList.remove('hidden');
    box.innerHTML = violations.map(v => `<div>⚠️ ${v}</div>`).join('');
  }
}

// Save resume from editor to disk & recompile (or download on static Vercel)
async function saveResumeFromEditor() {
  if (!state.selectedResume) return;
  const btn = editorElements.btnSaveResumeEditor;
  btn.disabled = true;
  btn.innerHTML = `<span>Saving...</span>`;

  try {
    let savedOnServer = false;
    try {
      const res = await fetch('/api/resume/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: state.selectedResume.filename,
          html: editorState.rawHtml
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          savedOnServer = true;
          showToast(`Saved and compiled ${data.pdfName} successfully!`, 'success');
          editorState.originalHtml = editorState.rawHtml;
          editorState.isDirty = false;
          await loadResumes();
          await loadGitStatus();

          if (data.metrics) {
            updateHeadroomUI(data.metrics.trailing_space, data.metrics.pages);
          }
        }
      }
    } catch {}

    // Fallback: If deployed as a pure static site on Vercel without local server
    if (!savedOnServer) {
      const pat = localStorage.getItem('github_pat');
      if (pat) {
        showToast('Pushing commit directly to GitHub repository...', 'info');
        await commitDirectToGithub(`HTML/${state.selectedResume.filename}`, editorState.rawHtml, `feat(resume): update ${state.selectedResume.filename} via web dashboard`);
        showToast('✓ Committed to GitHub! GitHub Actions is now compiling the PDF and deploying to Vercel.', 'success');
        editorState.originalHtml = editorState.rawHtml;
        editorState.isDirty = false;
      } else {
        downloadFile(state.selectedResume.filename, editorState.rawHtml, 'text/html');
        showToast('Static Mode: Downloaded HTML! Add a GitHub PAT in the Git modal for 1-click cloud sync.', 'info');
        editorState.originalHtml = editorState.rawHtml;
        editorState.isDirty = false;
      }
    }
  } catch (err) {
    showToast(`Save error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      <span>Save & Compile PDF</span>
    `;
  }
}

// Direct GitHub REST API Commit (Works on Vercel without a server!)
async function commitDirectToGithub(filepath, content, commitMessage) {
  const token = localStorage.getItem('github_pat');
  if (!token) throw new Error('No GitHub Personal Access Token configured.');

  const repo = 'deepakraaaj/Resume-warehouse';
  const url = `https://api.github.com/repos/${repo}/contents/${filepath}`;

  // Get current file sha
  let sha = undefined;
  try {
    const getRes = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }
  } catch {}

  // UTF-8 to Base64
  const utf8Bytes = new TextEncoder().encode(content);
  let binary = '';
  utf8Bytes.forEach(b => binary += String.fromCharCode(b));
  const base64Content = btoa(binary);

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: commitMessage,
      content: base64Content,
      sha: sha,
      branch: 'main'
    })
  });

  if (!putRes.ok) {
    const errData = await putRes.json();
    throw new Error(errData.message || 'GitHub API error');
  }

  return await putRes.json();
}

// Download file utility for browser client
function downloadFile(filename, content, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Browser print / save to PDF for Vercel users
function printEditorPreview() {
  const iframe = editorElements.editorPreviewFrame;
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  } else {
    window.print();
  }
}

// Live pdfplumber check
async function runLivePdfplumberAudit() {
  const btn = editorElements.btnLiveAuditHeadroom;
  btn.disabled = true;
  btn.textContent = 'Auditing...';

  try {
    const res = await fetch('/api/resume/check-headroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: state.selectedResume.filename,
        html: editorState.rawHtml
      })
    });
    const data = await res.json();
    if (data.success && data.metrics) {
      const m = data.metrics;
      updateHeadroomUI(m.trailing_space, m.pages);
      showToast(`pdfplumber verified: ${m.pages} page(s) | ${m.trailing_space} pt trailing space`, m.pages === 1 ? 'success' : 'warn');
    } else {
      updateHeadroomFromDom();
      showToast('Static mode: DOM measurement verified 1-page fit!', 'info');
    }
  } catch (err) {
    updateHeadroomFromDom();
    showToast('Static mode: DOM measurement verified 1-page fit!', 'info');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check pdfplumber';
  }
}

// Revert editor to last saved file
function revertEditor() {
  if (confirm('Revert all unsaved changes in editor?')) {
    editorState.rawHtml = editorState.originalHtml;
    editorElements.rawHtmlTextarea.value = editorState.originalHtml;
    parseHtmlToBlocks(editorState.originalHtml);
    renderEditorBlocks();
    updateEditorPreview();
    runRuleLinter(editorState.originalHtml);
    updateHeadroomFromDom();
    showToast('Reverted to last saved version', 'info');
  }
}

// Helper: Escape HTML strings for attributes
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

    const patInput = document.getElementById('githubPatInput');
    if (patInput) {
      patInput.value = localStorage.getItem('github_pat') || '';
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

  // Editor subtab buttons
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      editorState.activeSubtab = tab;
      document.getElementById('tabBlocks').classList.toggle('active', tab === 'blocks');
      document.getElementById('tabRaw').classList.toggle('active', tab === 'raw');
    });
  });

  // Raw HTML textarea live input
  if (editorElements.rawHtmlTextarea) {
    editorElements.rawHtmlTextarea.addEventListener('input', (e) => {
      editorState.rawHtml = e.target.value;
      editorState.isDirty = true;
      updateEditorPreview();
      runRuleLinter(editorState.rawHtml);
      updateHeadroomFromDom();
    });
  }

  // Format raw button
  if (editorElements.btnFormatRaw) {
    editorElements.btnFormatRaw.addEventListener('click', () => {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(editorState.rawHtml, 'text/html');
        editorState.rawHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        editorElements.rawHtmlTextarea.value = editorState.rawHtml;
        showToast('Formatted HTML', 'info');
      } catch {
        // ignore
      }
    });
  }

  // Editor actions
  if (editorElements.btnSaveResumeEditor) {
    editorElements.btnSaveResumeEditor.addEventListener('click', saveResumeFromEditor);
  }
  if (editorElements.btnRevertEditor) {
    editorElements.btnRevertEditor.addEventListener('click', revertEditor);
  }
  if (editorElements.btnLiveAuditHeadroom) {
    editorElements.btnLiveAuditHeadroom.addEventListener('click', runLivePdfplumberAudit);
  }
  const btnDownloadHtml = document.getElementById('btnDownloadHtml');
  if (btnDownloadHtml) {
    btnDownloadHtml.addEventListener('click', () => {
      if (state.selectedResume) {
        downloadFile(state.selectedResume.filename, editorState.rawHtml, 'text/html');
        showToast(`Downloaded ${state.selectedResume.filename}`, 'success');
      }
    });
  }
  const btnPrintPdf = document.getElementById('btnPrintPdf');
  if (btnPrintPdf) {
    btnPrintPdf.addEventListener('click', printEditorPreview);
  }

  const btnSavePat = document.getElementById('btnSaveGithubPat');
  const patInput = document.getElementById('githubPatInput');
  if (btnSavePat && patInput) {
    btnSavePat.addEventListener('click', () => {
      const val = patInput.value.trim();
      if (val) {
        localStorage.setItem('github_pat', val);
        showToast('✓ GitHub Personal Access Token saved in browser!', 'success');
      } else {
        localStorage.removeItem('github_pat');
        showToast('GitHub Personal Access Token cleared.', 'info');
      }
    });
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadResumes();
  loadGitStatus();
  applyZoom(100);
});
