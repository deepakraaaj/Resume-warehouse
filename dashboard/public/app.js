import { lint, LIMITS, A4_HEIGHT_PT } from './rules.js';
import { initTools, fitContactLine } from './tools.js';

const PX_PER_PT = 96 / 72;
const PAGE_H = A4_HEIGHT_PT * PX_PER_PT;
const PAGE_W = (210 / 25.4) * 96;

const $ = id => document.getElementById(id);

const state = {
  mode: 'static',
  resumes: [],
  changes: [],
  file: null,
  saved: '',
  editing: false,
  dirty: false,
  showSource: false,
  live: null,
  verified: null,
  preview: null,
  folders: [],
  createGroup: null,
  groupBy: (() => { try { return localStorage.getItem('desk.groupBy') === 'company' ? 'company' : 'group'; } catch { return 'group'; } })(),
  // The browser may pick different fonts than the Chrome that prints the PDF, so the on-screen
  // estimate is shifted by however far it was off for the last measured PDF.
  calibration: null,
  zoom: 'fit',
  pageHeight: PAGE_H,
  scale: 1,
  busy: false,
};

const current = () => state.resumes.find(r => r.file === state.file);
const fmt = n => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');

function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  wrapped.pending = () => t != null;
  wrapped.flush = (...args) => { if (t != null) { clearTimeout(t); t = null; fn(...args); } };
  return wrapped;
}

function relTime(iso) {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  if (Math.abs(mins) < 1440) return rtf.format(Math.round(mins / 60), 'hour');
  return rtf.format(Math.round(mins / 1440), 'day');
}

let toastTimer;
function toast(message, tone = 'ok') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
  return data;
}

// ---------- Data ----------

async function fetchState() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (res.ok && res.headers.get('content-type')?.includes('json')) return await res.json();
  } catch {}
  const res = await fetch('/data/resumes.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('data/resumes.json is missing. Run npm run build.');
  return { mode: 'static', ...(await res.json()) };
}

function applyState(data) {
  state.mode = data.mode === 'local' ? 'local' : 'static';
  state.resumes = data.resumes ?? [];
  state.changes = data.changes ?? [];
  state.folders = data.folders ?? [];
  renderAll();
  loadHistory();
}

function levelOf(r) {
  const m = r.metrics;
  if (!r.pdfExists || (m && m.pages > 1)) return 'fail';
  if (!m) return 'unknown';
  if (r.stale || r.issues.length || m.spare < LIMITS.spareMin || m.delta >= LIMITS.marginDelta) return 'warn';
  return 'ok';
}

const LEVEL_WORDS = { ok: 'Ready to send', warn: 'Needs a look', fail: 'Needs fixing', unknown: 'Not measured' };

// ---------- Rail ----------

function renderRail() {
  const list = state.resumes;
  const over = list.filter(r => r.metrics?.pages > 1).length;
  const missing = list.filter(r => !r.pdfExists).length;
  let summary = `${list.length} resumes. `;
  if (over) summary += `${over} run${over === 1 ? 's' : ''} past one page.`;
  else if (missing) summary += `${missing} ha${missing === 1 ? 's' : 've'} no PDF yet.`;
  else summary += 'All fit on one page.';
  $('summary').textContent = summary;

  const stale = state.mode === 'local' ? list.filter(r => r.stale) : [];
  $('staleBox').hidden = stale.length === 0;
  $('staleText').textContent = stale.length === 1
    ? '1 PDF is older than its HTML.'
    : `${stale.length} PDFs are older than their HTML.`;

  const byCompany = state.groupBy === 'company';
  document.querySelectorAll('[data-group]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.group === state.groupBy)));
  const groups = new Map();
  for (const r of list) {
    const key = byCompany ? (r.company || NO_COMPANY) : (r.group || 'General');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  if (!byCompany) for (const f of state.folders) if (!groups.has(f)) groups.set(f, []);
  const names = [...groups.keys()].sort((a, b) => (a === NO_COMPANY) - (b === NO_COMPANY) || a.localeCompare(b));
  const canMove = state.mode === 'local';

  const icon = path => `<svg class="tree-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const FILE = '<path d="M4 1.75h5.5L12.5 4.75v9.5H4z"/><path d="M9.25 1.75v3.25h3.25"/><path d="M6 8h4.5M6 10.5h4.5"/>';
  const FOLDER = '<path d="M1.75 4.25a1 1 0 0 1 1-1h3.5l1.5 1.5h5.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1z"/>';
  const FOLDER_OPEN = '<path d="M1.75 12.25V4.25a1 1 0 0 1 1-1h3.5l1.5 1.5h4.5a1 1 0 0 1 1 1v1.25"/><path d="M1.75 12.25l1.9-4.75a1 1 0 0 1 .93-.62h9.67l-1.95 5.37z"/>';
  const CHEVRON = '<svg class="chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';

  const renderItem = r => {
    const level = levelOf(r);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'item';
    item.dataset.file = r.file;
    if (r.file === state.file) item.setAttribute('aria-current', 'true');
    item.setAttribute('aria-label', `${r.role}, ${r.pdf}. ${LEVEL_WORDS[level]}.`);
    item.title = `${r.role}${r.company ? ` for ${r.company}` : ''}\n${r.pdf}\n${LEVEL_WORDS[level]}`;
    if (canMove) {
      item.draggable = true;
      item.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', r.file);
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
    }
    item.innerHTML = icon(FILE);
    const name = Object.assign(document.createElement('span'), { className: 'item-role', textContent: r.role });
    const desc = Object.assign(document.createElement('span'), {
      className: 'item-meta',
      textContent: !byCompany && r.company ? `${r.company}, ${r.pdf}` : r.pdf.replace(/\.pdf$/, ''),
    });
    const dot = Object.assign(document.createElement('span'), { className: `dot ${level}` });
    item.append(name, desc, dot, rowMore(() => fileMenu(r)));
    return item;
  };

  const collapsed = readCollapsed();
  $('list').replaceChildren(...names.map(name => {
    const key = `${state.groupBy}:${name}`;
    const members = groups.get(name);
    const open = !collapsed.has(key) || members.some(r => r.file === state.file);

    const section = document.createElement('section');
    section.className = 'list-group';
    const folder = document.createElement('button');
    folder.type = 'button';
    folder.className = 'folder';
    folder.dataset.key = key;
    folder.dataset.name = name;
    folder.dataset.count = String(members.length);
    folder.setAttribute('aria-expanded', String(open));
    folder.innerHTML = CHEVRON + icon(open ? FOLDER_OPEN : FOLDER);
    folder.append(
      Object.assign(document.createElement('span'), { className: 'folder-name', textContent: name }),
      Object.assign(document.createElement('span'), { className: 'folder-count', textContent: String(members.length) }),
      rowMore(() => folderMenu(name, members.length)),
    );
    folder.addEventListener('click', () => toggleFolder(key, !open));

    const children = document.createElement('div');
    children.className = 'folder-items';
    children.hidden = !open;
    children.append(...members.map(renderItem));
    if (!members.length) children.append(Object.assign(document.createElement('p'), { className: 'folder-empty', textContent: 'Empty. Drag a resume here.' }));
    section.append(folder, children);

    if (canMove) {
      section.addEventListener('dragover', e => { e.preventDefault(); section.classList.add('drop'); });
      section.addEventListener('dragleave', e => { if (!section.contains(e.relatedTarget)) section.classList.remove('drop'); });
      section.addEventListener('drop', e => {
        e.preventDefault();
        section.classList.remove('drop');
        const file = e.dataTransfer.getData('text/plain');
        const value = byCompany ? (name === NO_COMPANY ? '' : name) : name;
        moveResume(file, byCompany ? { company: value } : { group: value }, name);
      });
    }
    return section;
  }));
  $('newBtn').hidden = state.mode !== 'local';

  const showCommit = state.mode === 'local' && state.changes.length > 0;
  $('commitBox').hidden = !showCommit;
  $('commitLabel').textContent = `${state.changes.length} changed file${state.changes.length === 1 ? '' : 's'} not committed`;
}

// A "more" handle on each row, for touch screens where there is no right-click.
function rowMore(entries) {
  const more = document.createElement('span');
  more.className = 'row-more';
  more.setAttribute('aria-hidden', 'true');
  more.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>';
  more.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    const box = more.getBoundingClientRect();
    showMenu(box.left, box.bottom + 4, entries());
  });
  return more;
}

const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;

function setRail(open) {
  document.querySelector('.app').classList.toggle('rail-open', open);
  $('scrim').hidden = !open;
  $('railToggle').setAttribute('aria-expanded', String(open));
  if (open) ($('list').querySelector('[aria-current="true"]') ?? $('list').querySelector('.item, .folder'))?.focus();
}

function readCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem('desk.collapsed') ?? '[]')); } catch { return new Set(); }
}

function toggleFolder(key, open) {
  const collapsed = readCollapsed();
  if (open) collapsed.delete(key); else collapsed.add(key);
  try { localStorage.setItem('desk.collapsed', JSON.stringify([...collapsed])); } catch {}
  renderRail();
  document.querySelector(`.folder[data-key="${CSS.escape(key)}"]`)?.focus();
}

// ---------- Header ----------

function renderHeader() {
  const r = current();
  $('title').textContent = r ? r.role : 'No resume selected';
  $('subtitle').textContent = r ? [r.focus || r.pdf, r.company && `for ${r.company}`].filter(Boolean).join(', ') : '';

  const local = state.mode === 'local';
  $('viewActions').hidden = state.editing;
  $('editActions').hidden = !state.editing;
  $('editBtn').hidden = !local || !r || Boolean(state.preview);
  $('duplicateBtn').hidden = !local || !r;
  $('copyLink').hidden = local || !r?.pdfExists;

  for (const id of ['openPdf', 'openPdfEdit', 'downloadPdf']) {
    const link = $(id);
    if (r?.pdfExists) {
      link.href = `/PDF/${encodeURIComponent(r.pdf)}`;
      link.removeAttribute('aria-disabled');
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
    }
  }
  $('downloadPdf').setAttribute('download', r?.pdf ?? '');
  $('downloadPdf').title = r ? `Downloads ${r.pdf}` : '';

  $('dirtyNote').textContent = state.dirty ? 'Unsaved changes' : 'No changes yet';
  $('doneBtn').textContent = state.dirty ? 'Discard changes' : 'Done';
  $('sourceBtn').textContent = state.showSource ? 'Hide source' : 'Show source';
  $('sourceBtn').setAttribute('aria-pressed', String(state.showSource));
  $('saveBtn').disabled = state.busy || !state.dirty;
  $('saveBtn').textContent = state.busy ? 'Saving...' : 'Save and build PDF';
  $('rebuildStale').disabled = state.busy;
  $('editHint').hidden = !state.editing;
}

// ---------- Checks ----------

const ICONS = {
  ok: '<path d="M4 8.5l2.5 2.5L12 5.5"/>',
  warn: '<path d="M8 4.5v4.5M8 11.5v.01"/>',
  fail: '<path d="M5 5l6 6M11 5l-6 6"/>',
  unknown: '<path d="M8 11.5v.01M6.5 6.5a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.7.6-.7 1.2"/>',
};

let openIssues = null;

function checkModel() {
  const r = current();
  if (!r) return { items: [], source: '' };
  const live = state.editing && state.dirty && state.live;
  const checked = live && state.verified;
  const m = checked ? state.verified : r.metrics;
  const pages = live && !checked ? state.live.pages : m?.pages;
  const spare = live && !checked ? state.live.spare : m?.spare;
  const issues = live ? state.live.issues : r.issues;
  const items = [];

  if (pages == null) {
    items.push({ level: 'unknown', text: r.pdfExists ? 'PDF not measured' : 'No PDF yet' });
  } else if (pages > 1) {
    const over = live && !checked ? -state.live.room : -spare;
    items.push({ level: 'fail', text: over > 0 ? `Runs ${fmt(over)} pt onto page 2` : `${pages} pages, must be 1` });
  } else {
    items.push({ level: 'ok', text: 'Fits on one page' });
    if (spare < LIMITS.spareMin) items.push({ level: 'warn', text: `Only ${fmt(spare)} pt spare` });
    else if (spare > LIMITS.spareMax) items.push({ level: 'ok', text: `${fmt(spare)} pt spare, room for more` });
    else items.push({ level: 'ok', text: `${fmt(spare)} pt spare` });
  }

  if (m && m.delta != null) {
    items.push(m.delta >= LIMITS.marginDelta
      ? { level: 'warn', text: `Side margins differ by ${fmt(m.delta)} pt` }
      : { level: 'ok', text: 'Side margins even' });
  }

  const house = issues.filter(i => i.kind !== 'contact');
  const contact = issues.filter(i => i.kind === 'contact');
  items.push(house.length
    ? { level: 'warn', text: `${house.length} house rule issue${house.length === 1 ? '' : 's'}`, issues: house, key: 'house' }
    : { level: 'ok', text: 'House rules followed' });
  items.push(contact.length
    ? { level: 'warn', text: `${contact.length} contact detail${contact.length === 1 ? '' : 's'} off`, issues: contact, key: 'contact' }
    : { level: 'ok', text: 'Contact details current' });

  let source = '';
  if (checked) source = 'Checked with a test print of your changes.';
  else if (live) source = state.mode === 'local' ? 'Estimate while you edit. Checking with a test print...' : 'Estimate while you edit.';
  else if (m) source = `Measured from the PDF built ${relTime(r.pdfUpdatedAt)}.`;

  return { items, source, spare, pages, live };
}

function renderChecks() {
  const model = checkModel();
  const list = $('checks');
  // Only problems get a chip; when everything passes the row disappears and the page band shows the spare space.
  const problems = model.items.filter(item => item.level !== 'ok');
  list.closest('.checks').hidden = problems.length === 0;
  list.replaceChildren(...problems.map(item => {
    const li = document.createElement('li');
    const tag = item.issues ? document.createElement('button') : document.createElement('span');
    tag.className = `check ${item.level}`;
    tag.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[item.level]}</svg>`;
    tag.append(document.createTextNode(item.text));
    if (item.issues) {
      tag.type = 'button';
      tag.setAttribute('aria-expanded', String(openIssues === item.key));
      tag.addEventListener('click', () => {
        openIssues = openIssues === item.key ? null : item.key;
        renderChecks();
      });
    }
    li.append(tag);
    return li;
  }));
  $('checkSource').textContent = model.source;

  const open = model.items.find(i => i.key && i.key === openIssues);
  $('issues').hidden = !open;
  if (open) {
    const ul = document.createElement('ul');
    ul.append(...open.issues.map(issue => {
      const li = document.createElement('li');
      li.textContent = issue.message;
      if (issue.excerpt) {
        const ex = document.createElement('span');
        ex.className = 'excerpt';
        ex.textContent = `"${issue.excerpt}"`;
        li.append(ex);
      }
      return li;
    }));
    $('issues').replaceChildren(ul);
  }

  renderBandNotes();
  renderNotice();
}

function renderNotice() {
  const r = current();
  const box = $('notice');
  if (state.preview) {
    const p = state.preview;
    box.hidden = false;
    box.className = 'notice preview';
    box.replaceChildren(
      Object.assign(document.createElement('p'), { textContent: `Previewing the version from ${relTime(p.date)}: "${p.subject}". Checks above are for the current version.` }),
      Object.assign(document.createElement('span'), { className: 'notice-actions' }),
    );
    box.lastChild.append(
      Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Back to current', onclick: leavePreview }),
      Object.assign(document.createElement('button'), { type: 'button', className: 'btn small primary', textContent: 'Restore this version', onclick: restorePreview }),
    );
    return;
  }
  if (state.mode === 'local' && r && r.stale && !state.editing) {
    box.hidden = false;
    box.className = 'notice';
    box.replaceChildren(
      Object.assign(document.createElement('p'), {
        textContent: r.pdfExists
          ? 'This PDF is older than its HTML, so it may not match the page below.'
          : 'This resume has no PDF yet.',
      }),
      Object.assign(document.createElement('button'), {
        type: 'button', className: 'btn small', textContent: r.pdfExists ? 'Rebuild PDF' : 'Build PDF',
        disabled: state.busy, onclick: () => rebuild([r.file]),
      }),
    );
  } else {
    box.hidden = true;
  }
}

function renderAll() {
  renderRail();
  renderHeader();
  renderChecks();
}

// ---------- The page ----------

const frame = () => $('page');
const pageDoc = () => frame().contentDocument;

function loadPage(html) {
  closeLinkEditor();
  frame().onload = onPageLoad;
  frame().srcdoc = html;
}

function onPageLoad() {
  const doc = pageDoc();
  doc.addEventListener('click', e => {
    const link = e.target.closest?.('a[href]');
    if (!link) return;
    e.preventDefault();
    if (state.editing) openLinkEditor(link);
    else window.open(link.href, '_blank', 'noopener');
  });
  // Icons sit inside editable contact lines; never let a delete or typing remove one.
  doc.addEventListener('beforeinput', e => {
    if (!state.editing) return;
    for (const target of e.getTargetRanges?.() ?? []) {
      const range = doc.createRange();
      range.setStart(target.startContainer, target.startOffset);
      range.setEnd(target.endContainer, target.endOffset);
      if (range.cloneContents().querySelector('svg')) {
        e.preventDefault();
        return;
      }
    }
  });
  doc.addEventListener('keydown', onPageKey);
  doc.addEventListener('input', () => { if (state.editing) changed(); });
  doc.addEventListener('paste', e => {
    if (!state.editing) return;
    e.preventDefault();
    doc.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s+/g, ' '));
  });
  if (state.editing) makeEditable(doc);
  measure();
}

function contentBottom(doc) {
  const root = doc.querySelector('.page') ?? doc.body;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let bottom = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim()) continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.height) bottom = Math.max(bottom, rect.bottom);
  }
  return bottom + doc.documentElement.scrollTop;
}

function measure() {
  const doc = pageDoc();
  if (!doc?.body) return;
  frame().style.height = `${PAGE_H}px`;
  const rawBottom = contentBottom(doc);
  const root = doc.querySelector('.page') ?? doc.body;
  const r = current();
  const rawSpare = (PAGE_H - rawBottom) / PX_PER_PT;
  if (!state.dirty && !state.preview && r?.metrics?.spare != null && !r.stale) state.calibration = r.metrics.spare - rawSpare;
  const spareEstimate = rawSpare + (state.calibration ?? 0);
  // Where the content would end in the printed PDF, in page pixels.
  const bottom = PAGE_H - spareEstimate * PX_PER_PT;
  // The page's bottom padding is part of the "spare" gap but content can't use it: Chrome starts page 2 there.
  const padPx = parseFloat(doc.defaultView.getComputedStyle(root).paddingBottom) || 0;
  const limit = PAGE_H - padPx;
  const room = (limit - bottom) / PX_PER_PT;

  state.pageHeight = Math.max(PAGE_H, Math.ceil(Math.max(rawBottom, bottom) + 28));
  frame().style.height = `${state.pageHeight}px`;
  state.live = {
    bottom,
    room,
    pages: room < 0 ? 1 + Math.ceil(-room / A4_HEIGHT_PT) : 1,
    spare: spareEstimate,
    issues: state.editing ? lint(serialize(doc), root.textContent) : [],
  };

  const printedOver = state.dirty && state.verified?.pages > 1 ? -state.verified.spare : null;
  const fits = printedOver == null && room >= 0;
  $('spare').hidden = !fits;
  $('spill').hidden = fits;
  if (fits) {
    $('spare').style.top = `${bottom}px`;
    $('spare').style.height = `${PAGE_H - bottom}px`;
    $('spare').style.setProperty('--limit', `${limit - bottom}px`);
  } else {
    $('spill').style.top = `${limit}px`;
    const overPx = (printedOver ?? -room) * PX_PER_PT;
    $('spill').style.height = `${Math.max(12, overPx)}px`;
    state.live.over = printedOver ?? -room;
    state.pageHeight = Math.max(state.pageHeight, Math.ceil(limit + overPx + 24));
    frame().style.height = `${state.pageHeight}px`;
  }
  fitSheet();
  renderChecks();
  tools.refresh();
}

function estimateSpare() {
  return (PAGE_H - contentBottom(pageDoc())) / PX_PER_PT + (state.calibration ?? 0);
}

function renderBandNotes() {
  if (!state.live) return;
  const room = Math.max(0, state.live.room);
  $('spareNote').textContent = `${fmt(state.live.spare)} pt spare, ${fmt(room)} pt before page 2`;
  $('spillNote').textContent = `Page 1 ends here. ${fmt(state.live.over ?? -state.live.room)} pt spills over`;
}

function fitSheet() {
  const col = $('sheetCol');
  const byWidth = (col.clientWidth - 8) / PAGE_W;
  const stage = $('stage');
  const byHeight = (stage.clientHeight - 110) / state.pageHeight;
  const fitWhole = state.zoom === 'fit' && window.matchMedia('(min-width: 761px)').matches;
  // Actual size is true 100%: on a phone the page is wider than the screen and scrolls sideways.
  const scale = state.zoom === 'actual' ? 1 : Math.min(1, Math.max(0.3, fitWhole ? Math.min(byWidth, byHeight) : byWidth));
  $('zoomBtn').textContent = state.zoom === 'fit' ? 'Actual size' : 'Fit page';
  const sheet = $('sheet');
  sheet.style.transform = `scale(${scale})`;
  sheet.style.setProperty('--s', scale);
  state.scale = scale;
  positionLinkEditor();
  $('sheetFrame').style.width = `${PAGE_W * scale}px`;
  $('sheetFrame').style.height = `${state.pageHeight * scale}px`;
}

// ---------- Editing in place ----------

const EDIT_CSS = `
  [data-ed] { outline: 1px dashed transparent; outline-offset: 2px; transition: outline-color .12s; cursor: text; }
  [data-ed]:hover { outline-color: rgba(31, 95, 173, .45); }
  [data-ed]:focus { outline: 1.5px solid #1F5FAD; background: rgba(31, 95, 173, .05); }
  li[data-ed]:empty { min-height: 1.3em; }
`;

function makeEditable(doc) {
  if (doc.querySelector('style[data-editor]')) return;
  const style = doc.createElement('style');
  style.dataset.editor = '';
  style.textContent = EDIT_CSS;
  doc.head.append(style);

  const root = doc.querySelector('.page') ?? doc.body;
  for (const node of root.querySelectorAll('*')) {
    if (node.closest('[data-ed]') || node.closest('svg')) continue;
    const hasText = [...node.childNodes].some(c => c.nodeType === Node.TEXT_NODE && c.nodeValue.trim());
    if (!hasText) continue;
    node.setAttribute('contenteditable', 'true');
    node.dataset.ed = '';
    node.querySelectorAll('svg').forEach(svg => {
      svg.setAttribute('contenteditable', 'false');
      svg.dataset.lock = '';
    });
  }
}

const unmark = root => {
  root.querySelectorAll('[data-ed]').forEach(n => { n.removeAttribute('contenteditable'); n.removeAttribute('data-ed'); });
  root.querySelectorAll('[data-lock]').forEach(n => { n.removeAttribute('contenteditable'); n.removeAttribute('data-lock'); });
};

function makeReadOnly(doc) {
  doc.querySelector('style[data-editor]')?.remove();
  unmark(doc);
  closeLinkEditor();
}

function placeCaret(doc, node, atStart) {
  node.focus();
  const range = doc.createRange();
  range.selectNodeContents(node);
  range.collapse(atStart);
  const sel = doc.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function onPageKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
    return;
  }
  if (!state.editing) return;
  const doc = pageDoc();
  const sel = doc.getSelection();
  if (!sel.rangeCount) return;
  const anchor = sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement;
  const host = anchor?.closest('[data-ed]');
  if (!host) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    if (host.tagName !== 'LI') return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tail = doc.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    tail.setEnd(host, host.childNodes.length);
    const next = host.cloneNode(false);
    next.append(tail.extractContents());
    host.after(next);
    placeCaret(doc, next, true);
    changed();
  } else if (e.key === 'Backspace' && host.tagName === 'LI' && sel.isCollapsed && !host.textContent.trim()) {
    e.preventDefault();
    const prev = host.previousElementSibling;
    const next = host.nextElementSibling;
    host.remove();
    if (prev) placeCaret(doc, prev, false);
    else if (next) placeCaret(doc, next, true);
    changed();
  }
}

function serialize(doc) {
  const root = doc.documentElement.cloneNode(true);
  root.querySelectorAll('style[data-editor]').forEach(n => n.remove());
  unmark(root);
  root.querySelectorAll('b').forEach(b => {
    const strong = doc.createElement('strong');
    strong.append(...b.childNodes);
    b.replaceWith(strong);
  });
  return `<!DOCTYPE html>\n${root.outerHTML}\n`;
}

// ---------- Link editor ----------

let editingLink = null;

// Accepts what people naturally type: a bare domain, an email address or a phone number.
function normaliseHref(value) {
  const v = value.trim();
  if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^\+?[\d\s()-]{7,}$/.test(v)) return `tel:${v.replace(/[^\d+]/g, '')}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
  return null;
}

function addressText(href) {
  if (/^mailto:/i.test(href)) return href.slice(7);
  if (/^tel:/i.test(href)) return href.slice(4);
  try {
    const u = new URL(href);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return href;
  }
}

function openLinkEditor(link) {
  editingLink = link;
  $('linkText').value = link.textContent.trim();
  $('linkHref').value = link.getAttribute('href') ?? '';
  $('linkError').hidden = true;
  $('linkEditor').hidden = false;
  positionLinkEditor();
  $('linkHref').focus();
  $('linkHref').select();
}

function positionLinkEditor() {
  const box = $('linkEditor');
  if (!editingLink || box.hidden) return;
  const r = editingLink.getBoundingClientRect();
  const maxLeft = Math.max(0, $('sheetFrame').clientWidth - box.offsetWidth);
  box.style.left = `${Math.min(Math.max(0, r.left * state.scale), maxLeft)}px`;
  box.style.top = `${r.bottom * state.scale + 8}px`;
}

function closeLinkEditor() {
  editingLink = null;
  $('linkEditor').hidden = true;
}

function applyLink(e) {
  e.preventDefault();
  if (!editingLink) return;
  const href = normaliseHref($('linkHref').value);
  if (!href) {
    $('linkError').hidden = false;
    $('linkHref').focus();
    return;
  }
  const text = $('linkText').value.trim() || addressText(href);
  editingLink.setAttribute('href', href);
  if (text !== editingLink.textContent.trim()) editingLink.textContent = text;
  fitContactLine(pageDoc());
  closeLinkEditor();
  changed();
}

function unlink() {
  if (!editingLink) return;
  editingLink.replaceWith(pageDoc().createTextNode(editingLink.textContent));
  closeLinkEditor();
  changed();
}

const remeasure = debounce(measure, 150);
const syncSourceFromPage = debounce(() => {
  if (state.showSource && document.activeElement !== $('source')) $('source').value = serialize(pageDoc());
}, 300);
const applySource = debounce(() => loadPage($('source').value), 400);

// Prints the draft with the same Chrome that builds the PDF, then re-aims the on-screen estimate at that result.
let checkSeq = 0;
const verifyDraft = debounce(async () => {
  if (!state.editing || !state.dirty || state.mode !== 'local') return;
  const seq = ++checkSeq;
  const html = currentHtml();
  const raw = (PAGE_H - contentBottom(pageDoc())) / PX_PER_PT;
  try {
    const metrics = await checkHtml(html);
    if (seq !== checkSeq || !metrics || !state.dirty) return;
    state.verified = metrics;
    // A 2-page print's "spare" is spill length, not trailing space, so it can't calibrate the screen.
    if (metrics.pages === 1) state.calibration = metrics.spare - raw;
    measure();
  } catch {}
}, 1000);

async function checkHtml(html) {
  return (await api('/api/check', { html })).metrics;
}

function changed() {
  state.verified = null;
  checkSeq++;
  verifyDraft();
  if (!state.dirty) {
    state.dirty = true;
    renderHeader();
    renderTimeline();
  }
  remeasure();
  syncSourceFromPage();
}

function currentHtml() {
  if (applySource.pending()) return $('source').value;
  return serialize(pageDoc());
}

function startEditing() {
  state.editing = true;
  state.dirty = false;
  makeEditable(pageDoc());
  renderAll();
}

function stopEditing() {
  const r = current();
  if (state.dirty && !confirm(`Discard your unsaved changes to ${r?.role ?? 'this resume'}?`)) return;
  const wasDirty = state.dirty;
  state.editing = false;
  state.dirty = false;
  setSource(false);
  if (wasDirty) loadPage(state.saved);
  else makeReadOnly(pageDoc());
  renderAll();
}

function setSource(on) {
  state.showSource = on;
  $('source').hidden = !on;
  $('stage').classList.toggle('with-source', on);
  if (on) $('source').value = currentHtml();
  renderHeader();
  fitSheet();
}

async function save() {
  if (!state.editing || state.busy || !state.dirty) return;
  const html = currentHtml();
  state.busy = true;
  renderHeader();
  try {
    const data = await api('/api/save', { file: state.file, html });
    state.saved = html;
    state.dirty = false;
    applyState(data);
    measure();
    const m = current()?.metrics;
    if (!m) toast('Saved. The PDF was built but could not be measured.', 'warn');
    else if (m.pages === 1) toast(`Saved. The PDF fits on one page with ${fmt(m.spare)} pt spare.`, 'ok');
    else toast(`Saved, but the PDF is ${m.pages} pages. Trim some text to get it back to one.`, 'fail');
  } catch (err) {
    toast(`Not saved. ${err.message}`, 'fail');
  } finally {
    state.busy = false;
    renderHeader();
  }
}

async function rebuild(files) {
  if (state.busy) return;
  state.busy = true;
  renderAll();
  try {
    applyState(await api('/api/build', { files }));
    const over = state.resumes.filter(r => files.includes(r.file) && r.metrics?.pages > 1);
    toast(over.length
      ? `Rebuilt. ${over.map(r => r.pdf).join(', ')} runs past one page.`
      : `Rebuilt ${files.length} PDF${files.length === 1 ? '' : 's'}. All fit on one page.`, over.length ? 'fail' : 'ok');
  } catch (err) {
    toast(`Rebuild failed. ${err.message}`, 'fail');
  } finally {
    state.busy = false;
    renderAll();
  }
}

async function commit(e) {
  e.preventDefault();
  if (state.busy) return;
  const count = state.changes.length;
  state.busy = true;
  try {
    applyState(await api('/api/commit', { message: $('commitMessage').value }));
    $('commitMessage').value = '';
    toast(`Committed ${count} file${count === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    toast(`Commit failed. ${err.message}`, 'fail');
  } finally {
    state.busy = false;
  }
}

// ---------- History ----------

let historyKey = null;
let historyData = null;

const GIT_ICONS = {
  commit: '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.5v3.9M8 10.6v3.9"/>',
  working: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
};

async function loadHistory(force = false) {
  const r = current();
  if (!r || $('historyPane').hidden) return;
  if (state.mode !== 'local') {
    $('historyNote').textContent = 'History needs the local dashboard. Run npm start and open http://localhost:4000.';
    $('timeline').replaceChildren();
    return;
  }
  const key = `${r.file}@${r.updatedAt}@${state.changes.join(',')}`;
  if (!force && key === historyKey && historyData) return renderTimeline();
  historyKey = key;
  try {
    const res = await fetch(`/api/history?file=${encodeURIComponent(r.file)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (historyKey === key) { historyData = data; renderTimeline(); }
  } catch (err) {
    $('timeline').replaceChildren(Object.assign(document.createElement('li'), { className: 'hint muted', textContent: `Could not read the git history. ${err.message}` }));
  }
}

function renderTimeline() {
  if (!historyData) return;
  const { commits, changed } = historyData;
  const items = [];
  if (state.dirty) items.push({ kind: 'working', subject: 'Unsaved edits', meta: 'In the editor now' });
  else if (changed) items.push({ kind: 'working', subject: 'Saved, not committed yet', meta: 'Commit from the bottom of the resume list' });
  items.push(...commits.map(c => ({ kind: 'commit', ...c })));

  $('timeline').replaceChildren(...items.map(item => {
    const li = document.createElement('li');
    li.className = `tl-item ${item.kind}`;
    const node = document.createElement('span');
    node.className = 'tl-node';
    node.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GIT_ICONS[item.kind]}</svg>`;

    const body = document.createElement(item.kind === 'commit' ? 'button' : 'div');
    body.className = 'tl-body';
    const title = Object.assign(document.createElement('span'), { className: 'tl-title', textContent: item.subject });
    const meta = document.createElement('span');
    meta.className = 'tl-meta';
    if (item.kind === 'commit') {
      body.type = 'button';
      body.title = 'Preview this version';
      if (state.preview?.hash === item.hash) body.setAttribute('aria-current', 'true');
      body.addEventListener('click', () => previewVersion(item));
      const avatar = Object.assign(document.createElement('span'), { className: 'avatar', textContent: (item.author.trim()[0] ?? '?').toUpperCase(), title: item.author });
      meta.append(avatar,
        Object.assign(document.createElement('span'), { textContent: `${item.author}, ${relTime(item.date)}` }),
        Object.assign(document.createElement('code'), { className: 'hash', textContent: item.hash }));
    } else {
      meta.textContent = item.meta;
    }
    body.append(title, meta);
    li.append(node, body);
    return li;
  }));
  if (!commits.length) {
    $('timeline').append(Object.assign(document.createElement('li'), { className: 'hint muted', textContent: 'No commits for this file yet.' }));
  }
}

async function previewVersion(commit) {
  if (state.dirty && !confirm('Discard your unsaved changes to preview an older version?')) return;
  try {
    const res = await fetch(`/api/version?file=${encodeURIComponent(state.file)}&commit=${commit.hash}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.editing = false;
    state.dirty = false;
    setSource(false);
    state.preview = { ...commit, html: data.html };
    loadPage(data.html);
    renderAll();
    renderTimeline();
  } catch (err) {
    toast(`Could not open that version. ${err.message}`, 'fail');
  }
}

function leavePreview() {
  state.preview = null;
  loadPage(state.saved);
  renderAll();
  renderTimeline();
}

function restorePreview() {
  const html = state.preview.html;
  state.preview = null;
  state.editing = true;
  state.dirty = true;
  loadPage(html);
  renderAll();
  renderTimeline();
  verifyDraft();
  toast('That version is now in the editor. Save to make it current, or Discard changes to go back.');
}

// ---------- New, duplicate and company ----------

function openCreate(mode, opts = {}) {
  const r = state.resumes.find(x => x.file === opts.from) ?? current();
  const duplicate = mode === 'duplicate';
  state.createGroup = opts.group ?? null;
  $('createTitle').textContent = duplicate ? 'Duplicate resume' : 'New resume';
  $('createSubmit').textContent = duplicate ? 'Create copy' : 'Create resume';
  $('createFrom').replaceChildren(...state.resumes.map(x => new Option(`${x.role}${x.company ? ` for ${x.company}` : ''} (${x.pdf})`, x.file)));
  $('createFrom').value = r?.file ?? state.resumes[0]?.file ?? '';
  $('createRole').value = duplicate && r ? r.role : '';
  $('createCompany').value = opts.company ?? '';
  $('createDialog').showModal();
  $(duplicate ? 'createCompany' : 'createRole').focus();
}

async function submitCreate(e) {
  e.preventDefault();
  if (state.busy) return;
  if (state.dirty && !confirm(`Discard your unsaved changes to ${current()?.role ?? 'this resume'}?`)) return;
  state.busy = true;
  $('createSubmit').disabled = true;
  $('createSubmit').textContent = 'Creating...';
  try {
    const data = await api('/api/create', { from: $('createFrom').value, role: $('createRole').value, company: $('createCompany').value, group: state.createGroup });
    state.dirty = false;
    state.editing = false;
    applyState(data);
    $('createDialog').close();
    await select(data.created);
    toast(`Created ${current()?.pdf ?? data.created}. Click Edit to tailor it.`);
  } catch (err) {
    toast(`Not created. ${err.message}`, 'fail');
  } finally {
    state.busy = false;
    $('createSubmit').disabled = false;
    $('createSubmit').textContent = $('createTitle').textContent === 'Duplicate resume' ? 'Create copy' : 'Create resume';
  }
}

const NO_COMPANY = 'No company yet';

async function moveResume(file, details, label) {
  const r = state.resumes.find(x => x.file === file);
  if (!r || state.busy) return;
  if (('group' in details && details.group === r.group) || ('company' in details && details.company === (r.company ?? ''))) return;
  if (state.editing && state.dirty && file === state.file) {
    toast('Save or discard your edits to this resume before moving it.', 'warn');
    return;
  }
  state.busy = true;
  try {
    applyState(await api('/api/details', { file, ...details }));
    toast(`Moved ${r.role} to ${label}.`);
  } catch (err) {
    toast(`Not moved. ${err.message}`, 'fail');
  } finally {
    state.busy = false;
  }
}

// ---------- Text prompt ----------

function ask({ title, label, value = '', hint = '', confirm = 'Save', options = [] }) {
  $('askTitle').textContent = title;
  $('askLabel').textContent = label;
  $('askInput').value = value;
  $('askHint').textContent = hint;
  $('askHint').hidden = !hint;
  $('askOk').textContent = confirm;
  $('askOptions').replaceChildren(...options.map(o => new Option(o)));
  const dialog = $('askDialog');
  dialog.showModal();
  $('askInput').focus();
  $('askInput').select();
  return new Promise(resolve => {
    const done = value => {
      $('askForm').removeEventListener('submit', onSubmit);
      $('askCancel').removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    // Cancel resolves null; an empty answer resolves '' (used to clear a value).
    const onSubmit = e => { e.preventDefault(); done($('askInput').value.trim()); };
    const onCancel = () => done(null);
    $('askForm').addEventListener('submit', onSubmit);
    $('askCancel').addEventListener('click', onCancel);
    dialog.addEventListener('close', onCancel);
  });
}

// ---------- Explorer actions ----------

const folderNames = () => [...new Set([...state.folders, ...state.resumes.map(r => r.group || 'General')])].sort((a, b) => a.localeCompare(b));
const companyNames = () => [...new Set(state.resumes.map(r => r.company).filter(Boolean))].sort();

async function run(fn, doneMessage) {
  if (state.busy) return null;
  state.busy = true;
  try {
    const data = await fn();
    applyState(data);
    if (doneMessage) toast(typeof doneMessage === 'function' ? doneMessage(data) : doneMessage);
    return data;
  } catch (err) {
    toast(err.message, 'fail');
    return null;
  } finally {
    state.busy = false;
  }
}

const blockedByEdits = file => {
  if (state.dirty && file === state.file) {
    toast('Save or discard your edits to this resume first.', 'warn');
    return true;
  }
  return false;
};

async function newFolder() {
  const name = await ask({ title: 'New folder', label: 'Folder name', hint: 'Drag resumes into it, or right-click it and choose New resume here.', confirm: 'Create folder' });
  if (!name) return;
  if (folderNames().includes(name)) return toast(`${name} already exists.`, 'warn');
  if (state.groupBy !== 'group') { state.groupBy = 'group'; try { localStorage.setItem('desk.groupBy', 'group'); } catch {} }
  await run(() => api('/api/folder', { action: 'create', name }), `Created folder ${name}.`);
}

async function renameFolder(name) {
  const to = await ask({ title: 'Rename folder', label: 'Folder name', value: name, confirm: 'Rename' });
  if (!to || to === name) return;
  if (state.dirty && state.resumes.some(r => r.group === name && r.file === state.file)) return blockedByEdits(state.file);
  await run(() => api('/api/folder', { action: 'rename', name, to }), `Renamed ${name} to ${to}.`);
}

async function deleteFolder(name) {
  await run(() => api('/api/folder', { action: 'delete', name }), `Deleted folder ${name}.`);
}

async function renameCompany(name) {
  const to = await ask({ title: 'Rename company', label: 'Company name', value: name, hint: 'Updates every resume marked for this company. Leave empty to clear it.', confirm: 'Rename' });
  if (to === null || to === name) return;
  await run(() => api('/api/company-rename', { name, to }), `Renamed ${name} to ${to}.`);
}

async function renameFile(r) {
  if (blockedByEdits(r.file)) return;
  const name = await ask({
    title: 'Rename file',
    label: 'File name',
    value: r.file.replace(/\.html$/, ''),
    hint: `The PDF will be renamed to match. Links you already sent to ${r.pdf} will stop working.`,
    confirm: 'Rename',
  });
  if (!name) return;
  const data = await run(() => api('/api/rename', { file: r.file, name }), d => `Renamed to ${d.renamed}.`);
  if (data?.renamed && state.file === r.file) {
    state.file = data.renamed;
    const url = new URL(location.href);
    url.searchParams.set('r', data.renamed.replace(/\.html$/, ''));
    history.replaceState(null, '', url);
    renderAll();
  }
}

async function moveToFolder(r) {
  const to = await ask({ title: 'Move to folder', label: 'Folder', value: r.group, options: folderNames(), hint: 'Pick a folder or type a new name.', confirm: 'Move' });
  if (to) await moveResume(r.file, { group: to }, to);
}

async function setCompanyFor(r) {
  const to = await ask({ title: 'Target company', label: 'Company this resume is for', value: r.company ?? '', options: companyNames(), hint: 'Not printed on the resume. Leave empty for a general resume.', confirm: 'Save' });
  if (to === null) return;
  await moveResume(r.file, { company: to }, to || NO_COMPANY);
}

async function archive(r) {
  if (blockedByEdits(r.file)) return;
  if (!confirm(`Move "${r.role}" (${r.file}) to the archive?\n\nIts HTML and PDF move to "Archieve Resumes/". Nothing is deleted.`)) return;
  const wasCurrent = r.file === state.file;
  const data = await run(() => api('/api/archive', { file: r.file }), 'Moved to Archieve Resumes.');
  if (data && wasCurrent) {
    state.file = null;
    if (state.resumes[0]) select(state.resumes[0].file);
  }
}

function setAllFolders(open) {
  const keys = [...document.querySelectorAll('.folder')].map(f => f.dataset.key);
  const collapsed = readCollapsed();
  keys.forEach(k => (open ? collapsed.delete(k) : collapsed.add(k)));
  try { localStorage.setItem('desk.collapsed', JSON.stringify([...collapsed])); } catch {}
  renderRail();
}

// ---------- Context menu ----------

let menuReturnFocus = null;

function showMenu(x, y, entries) {
  const menu = $('contextMenu');
  menu.replaceChildren(...entries.filter(Boolean).map(entry => {
    if (entry === '-') return Object.assign(document.createElement('div'), { className: 'menu-sep', role: 'separator' });
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = `menu-item${entry.danger ? ' danger' : ''}`;
    b.disabled = Boolean(entry.disabled);
    b.append(Object.assign(document.createElement('span'), { textContent: entry.label }));
    if (entry.key) b.append(Object.assign(document.createElement('kbd'), { textContent: entry.key }));
    b.addEventListener('click', () => { hideMenu(); entry.run(); });
    return b;
  }));
  menu.hidden = false;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.min(x, innerWidth - w - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - h - 8)}px`;
  menuReturnFocus = document.activeElement;
  menu.querySelector('.menu-item:not(:disabled)')?.focus();
}

function hideMenu() {
  const menu = $('contextMenu');
  if (menu.hidden) return;
  menu.hidden = true;
  menuReturnFocus?.focus?.();
}

function fileMenu(r) {
  const local = state.mode === 'local';
  return [
    { label: 'Open', run: () => select(r.file) },
    local && { label: 'Edit', run: async () => { await select(r.file); if (state.file === r.file) startEditing(); } },
    r.pdfExists && { label: 'Open PDF', run: () => window.open(`/PDF/${encodeURIComponent(r.pdf)}`, '_blank', 'noopener') },
    local && '-',
    local && { label: 'Duplicate...', run: () => openCreate('duplicate', { from: r.file, company: r.company, group: r.group }) },
    local && { label: 'Rename file...', key: 'F2', run: () => renameFile(r) },
    local && { label: 'Move to folder...', run: () => moveToFolder(r) },
    local && { label: 'Set target company...', run: () => setCompanyFor(r) },
    '-',
    { label: 'Copy file name', run: () => navigator.clipboard?.writeText(r.file).then(() => toast('File name copied.')) },
    local && '-',
    local && { label: 'Move to archive', key: 'Del', danger: true, run: () => archive(r) },
  ];
}

function folderMenu(name, count) {
  if (state.mode !== 'local') return [{ label: 'Collapse all', run: () => setAllFolders(false) }, { label: 'Expand all', run: () => setAllFolders(true) }];
  if (state.groupBy === 'company') {
    const none = name === NO_COMPANY;
    return [
      { label: none ? 'New resume...' : `New resume for ${name}...`, run: () => openCreate('new', { company: none ? '' : name }) },
      !none && { label: 'Rename company...', key: 'F2', run: () => renameCompany(name) },
      '-',
      { label: 'Collapse all', run: () => setAllFolders(false) },
      { label: 'Expand all', run: () => setAllFolders(true) },
    ];
  }
  return [
    { label: 'New resume here...', run: () => openCreate('new', { group: name }) },
    { label: 'New folder...', run: newFolder },
    '-',
    { label: 'Rename folder...', key: 'F2', run: () => renameFolder(name) },
    { label: count ? 'Delete folder (move its resumes first)' : 'Delete folder', disabled: count > 0, danger: true, run: () => deleteFolder(name) },
    '-',
    { label: 'Collapse all', run: () => setAllFolders(false) },
    { label: 'Expand all', run: () => setAllFolders(true) },
  ];
}

function blankMenu() {
  const local = state.mode === 'local';
  return [
    local && { label: 'New resume...', run: () => openCreate('new') },
    local && state.groupBy === 'group' && { label: 'New folder...', run: newFolder },
    local && '-',
    { label: 'Collapse all', run: () => setAllFolders(false) },
    { label: 'Expand all', run: () => setAllFolders(true) },
  ];
}

function menuFor(target) {
  const item = target.closest('.item');
  if (item) return fileMenu(state.resumes.find(r => r.file === item.dataset.file));
  const folder = target.closest('.folder');
  if (folder) return folderMenu(folder.dataset.name, Number(folder.dataset.count));
  return blankMenu();
}

// ---------- Selection ----------

async function select(file) {
  if (isNarrow()) setRail(false);
  if (file === state.file) return;
  if (state.dirty && !confirm(`Discard your unsaved changes to ${current()?.role ?? 'this resume'}?`)) return;
  state.file = file;
  state.editing = false;
  state.dirty = false;
  state.live = null;
  state.verified = null;
  state.preview = null;
  state.calibration = null;
  openIssues = null;
  setSource(false);
  renderAll();

  const url = new URL(location.href);
  url.searchParams.set('r', file.replace(/\.html$/, ''));
  history.replaceState(null, '', url);

  try {
    const res = await fetch(`/HTML/${encodeURIComponent(file)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTML/${file} could not be loaded (${res.status}).`);
    const html = await res.text();
    if (state.file !== file) return;
    state.saved = html;
    loadPage(html);
    loadHistory();
  } catch (err) {
    toast(err.message, 'fail');
  }
}

// ---------- Wiring ----------

$('list').addEventListener('click', e => {
  const item = e.target.closest('.item');
  if (item) select(item.dataset.file);
});
$('list').addEventListener('keydown', e => {
  const rows = [...$('list').querySelectorAll('.folder, .folder-items:not([hidden]) .item')];
  const i = rows.indexOf(document.activeElement);
  if (i < 0) return;
  const row = rows[i];
  const r = row.classList.contains('item') ? state.resumes.find(x => x.file === row.dataset.file) : null;
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    const box = row.getBoundingClientRect();
    showMenu(box.left + 24, box.bottom, menuFor(row));
    return;
  }
  if (state.mode === 'local' && e.key === 'F2') {
    e.preventDefault();
    if (r) renameFile(r);
    else if (state.groupBy === 'company') { if (row.dataset.name !== NO_COMPANY) renameCompany(row.dataset.name); }
    else renameFolder(row.dataset.name);
    return;
  }
  if (state.mode === 'local' && e.key === 'Delete' && r) {
    e.preventDefault();
    archive(r);
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  } else if (row.classList.contains('folder') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const open = row.getAttribute('aria-expanded') === 'true';
    if (open !== (e.key === 'ArrowRight')) toggleFolder(row.dataset.key, e.key === 'ArrowRight');
    else if (open) rows[i + 1]?.focus();
  } else if (row.classList.contains('item') && e.key === 'ArrowLeft') {
    e.preventDefault();
    row.closest('.list-group').querySelector('.folder').focus();
  }
});

$('linkEditor').addEventListener('submit', applyLink);
$('linkEditor').addEventListener('keydown', e => { if (e.key === 'Escape') closeLinkEditor(); });
$('linkCancel').addEventListener('click', closeLinkEditor);
$('linkUnlink').addEventListener('click', unlink);
$('linkShowAddress').addEventListener('click', () => {
  const href = normaliseHref($('linkHref').value);
  if (href) $('linkText').value = addressText(href);
  else $('linkError').hidden = false;
});
$('linkOpen').addEventListener('click', () => {
  const href = normaliseHref($('linkHref').value);
  if (href) window.open(href, '_blank', 'noopener');
});

$('tabHistory').addEventListener('click', () => loadHistory());
$('railToggle').addEventListener('click', () => setRail(!document.querySelector('.app').classList.contains('rail-open')));
$('scrim').addEventListener('click', () => setRail(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.app').classList.contains('rail-open')) setRail(false); });
$('moreBtn').addEventListener('click', () => {
  const r = current();
  if (!r) return;
  const box = $('moreBtn').getBoundingClientRect();
  const local = state.mode === 'local';
  showMenu(box.left, box.bottom + 4, [
    r.pdfExists && { label: 'Open PDF', run: () => window.open(`/PDF/${encodeURIComponent(r.pdf)}`, '_blank', 'noopener') },
    !local && r.pdfExists && { label: 'Copy PDF link', run: () => $('copyLink').click() },
    local && { label: 'Duplicate...', run: () => openCreate('duplicate', { from: r.file, company: r.company, group: r.group }) },
    local && { label: 'Move to folder...', run: () => moveToFolder(r) },
    local && { label: 'Set target company...', run: () => setCompanyFor(r) },
    local && { label: 'Rename file...', run: () => renameFile(r) },
    local && '-',
    local && { label: 'Move to archive', danger: true, run: () => archive(r) },
  ]);
});
$('list').addEventListener('contextmenu', e => {
  e.preventDefault();
  showMenu(e.clientX, e.clientY, menuFor(e.target));
});
$('contextMenu').addEventListener('keydown', e => {
  const items = [...$('contextMenu').querySelectorAll('.menu-item:not(:disabled)')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); hideMenu(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
});
document.addEventListener('pointerdown', e => { if (!$('contextMenu').contains(e.target)) hideMenu(); });
window.addEventListener('blur', hideMenu);
window.addEventListener('resize', hideMenu);
$('list').addEventListener('scroll', hideMenu);
$('newBtn').addEventListener('click', () => openCreate('new'));
$('duplicateBtn').addEventListener('click', () => openCreate('duplicate'));
$('createForm').addEventListener('submit', submitCreate);
$('createCancel').addEventListener('click', () => $('createDialog').close());
document.querySelectorAll('[data-group]').forEach(b => b.addEventListener('click', () => {
  state.groupBy = b.dataset.group;
  try { localStorage.setItem('desk.groupBy', state.groupBy); } catch {}
  renderRail();
}));

$('zoomBtn').addEventListener('click', () => {
  state.zoom = state.zoom === 'fit' ? 'actual' : 'fit';
  fitSheet();
});
$('editBtn').addEventListener('click', startEditing);
$('doneBtn').addEventListener('click', stopEditing);
$('saveBtn').addEventListener('click', save);
$('sourceBtn').addEventListener('click', () => setSource(!state.showSource));
$('source').addEventListener('input', () => {
  if (!state.dirty) { state.dirty = true; renderHeader(); }
  applySource();
});
$('rebuildStale').addEventListener('click', () => rebuild(state.resumes.filter(r => r.stale).map(r => r.file)));
$('commitBox').addEventListener('submit', commit);
$('copyLink').addEventListener('click', async () => {
  const r = current();
  if (!r) return;
  try {
    await navigator.clipboard.writeText(new URL(`/PDF/${encodeURIComponent(r.pdf)}`, location.href).href);
    toast('PDF link copied.');
  } catch {
    toast('Your browser blocked clipboard access. Use Open PDF and copy the address instead.', 'warn');
  }
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.editing) {
    e.preventDefault();
    save();
  }
});
window.addEventListener('beforeunload', e => {
  if (state.dirty) e.preventDefault();
});
new ResizeObserver(fitSheet).observe($('sheetCol'));

const tools = initTools({
  doc: pageDoc,
  resume: current,
  canEdit: () => state.mode === 'local',
  isLocal: () => state.mode === 'local',
  isDirty: () => state.dirty,
  ensureEditing: () => { if (!state.editing) startEditing(); },
  changed,
  estimateSpare,
  currentHtml,
  checkHtml: html => (state.mode === 'local' ? checkHtml(html) : Promise.resolve(null)),
  setCalibration: metrics => {
    if (metrics.pages === 1) state.calibration = metrics.spare - (PAGE_H - contentBottom(pageDoc())) / PX_PER_PT;
    state.verified = metrics;
    measure();
  },
  toast,
});

try {
  applyState(await fetchState());
  const wanted = new URLSearchParams(location.search).get('r');
  const first = state.resumes.find(r => r.file === `${wanted}.html`) ?? state.resumes[0];
  if (first) select(first.file);
  else $('summary').textContent = 'No resumes found in HTML/.';
} catch (err) {
  $('summary').textContent = err.message;
}
