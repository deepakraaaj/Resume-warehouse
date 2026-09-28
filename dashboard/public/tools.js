// Design controls and ATS checks for the resume shown on the desk. Every design control edits the
// resume's own <style> or DOM, so what is saved is exactly what was previewed.

const FONTS = [
  { label: 'Noto Sans', stack: '"Noto Sans", Arial, sans-serif' },
  { label: 'Arial', stack: 'Arial, "Liberation Sans", Helvetica, sans-serif' },
  { label: 'Ubuntu Sans', stack: '"Ubuntu Sans", "Noto Sans", Arial, sans-serif' },
  { label: 'Times New Roman', stack: '"Times New Roman", "Liberation Serif", serif' },
  { label: 'Noto Serif', stack: '"Noto Serif", Georgia, serif' },
];

const ACCENTS = [
  { hex: '#0369a1', name: 'Blue' },
  { hex: '#1e3a5f', name: 'Navy' },
  { hex: '#0f766e', name: 'Teal' },
  { hex: '#166534', name: 'Green' },
  { hex: '#7f1d1d', name: 'Burgundy' },
  { hex: '#374151', name: 'Charcoal' },
];

const FIT_TARGET_PT = 42;

// ---------- CSS helpers ----------

const mainStyle = doc => [...doc.head.querySelectorAll('style')].find(s => !s.hasAttribute('data-editor'));
const round = n => Math.round(n * 100) / 100;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function editCss(doc, fn) {
  const style = mainStyle(doc);
  if (!style) return false;
  const next = fn(style.textContent);
  if (next === style.textContent) return false;
  style.textContent = next;
  return true;
}

const scaleFontSizes = (css, f) =>
  css.replace(/(font-size\s*:\s*)([\d.]+)(pt|px)/g, (m, p, v, u) => `${p}${round(v * f)}${u}`);

const scaleLineHeights = (css, f) =>
  css.replace(/(line-height\s*:\s*)([\d.]+)(?=\s*[;}])/g, (m, p, v) => `${p}${round(v * f)}`);

const scaleSpacing = (css, f) => css
  .replace(/((?:margin-top|margin-bottom)\s*:\s*)([\d.]+)pt/g, (m, p, v) => `${p}${round(v * f)}pt`)
  .replace(/(\bgap\s*:\s*)([\d.]+)pt/g, (m, p, v) => `${p}${round(v * f)}pt`);

function setRuleValue(css, selector, prop, value) {
  const re = new RegExp(`(${escapeRe(selector)}\\s*\\{[^}]*?${prop}\\s*:\\s*)([^;}]+)`);
  if (re.test(css)) return css.replace(re, (m, p) => p + value);
  return `${css}\n  ${selector} { ${prop}: ${value}; }\n`;
}

function setFont(css, stack) {
  const re = /((?:html\s*,\s*body|body)\s*\{[^}]*?font-family\s*:\s*)([^;}]+)/;
  if (re.test(css)) return css.replace(re, (m, p) => p + stack);
  return `${css}\n  body { font-family: ${stack}; }\n`;
}

// Longer link text can push a no-wrap contact line past the right margin; let it take a second line instead.
export function fitContactLine(doc) {
  const bar = doc.querySelector('.contact-bar');
  if (!bar || bar.scrollWidth <= bar.clientWidth + 1) return false;
  return editCss(doc, css => setRuleValue(setRuleValue(css, '.contact-bar', 'flex-wrap', 'wrap'), '.contact-bar', 'row-gap', '3pt'));
}

// ---------- Colour helpers ----------

function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function colourUses(doc) {
  const found = [...(mainStyle(doc)?.textContent.match(/#[0-9a-f]{6}\b/gi) ?? [])];
  doc.querySelectorAll('[stroke], [fill]').forEach(el => {
    for (const v of [el.getAttribute('stroke'), el.getAttribute('fill')]) if (/^#[0-9a-f]{6}$/i.test(v ?? '')) found.push(v);
  });
  return found.map(h => h.toLowerCase());
}

const rgbToHex = rgb => {
  const m = rgb.match(/\d+/g);
  return m ? `#${m.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : null;
};

// The role title and section rules carry the accent in these templates, so read it from there first.
function detectAccent(doc) {
  const view = doc.defaultView;
  const role = doc.querySelector('.role-title');
  if (role) return rgbToHex(view.getComputedStyle(role).color);
  const header = doc.querySelector('.section-header, .section-title');
  if (header) return rgbToHex(view.getComputedStyle(header).borderBottomColor);
  const counts = new Map();
  for (const hex of colourUses(doc)) {
    const [, s, l] = hexToHsl(hex);
    if (s < 0.5 || l < 0.2 || l > 0.6) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// Recolours the accent and its tints (same hue family) while keeping each tint's lightness.
function setAccent(doc, to) {
  const from = detectAccent(doc);
  if (!from) return false;
  const [fromH, fromS] = hexToHsl(from);
  const [toH, toS] = hexToHsl(to);
  const map = new Map();
  for (const hex of new Set(colourUses(doc))) {
    if (hex === from) {
      map.set(hex, to.toLowerCase());
      continue;
    }
    // Only strong tints of the accent (badge fills, borders); the slate text greys share its hue but not its saturation.
    const [h, s, l] = hexToHsl(hex);
    if (s < 0.5 || hueDistance(h, fromH) > 25) continue;
    map.set(hex, hslToHex(toH, clamp((s * toS) / Math.max(0.01, fromS), 0, 1), l));
  }
  const swap = str => str.replace(/#[0-9a-f]{6}\b/gi, m => map.get(m.toLowerCase()) ?? m);
  editCss(doc, swap);
  doc.querySelectorAll('[stroke], [fill]').forEach(el => {
    for (const attr of ['stroke', 'fill']) {
      const v = el.getAttribute(attr);
      if (v && map.has(v.toLowerCase())) el.setAttribute(attr, map.get(v.toLowerCase()));
    }
  });
  return true;
}

// ---------- Layout helpers ----------

function sectionsOf(doc) {
  const page = doc.querySelector('.page') ?? doc.body;
  return [...page.children]
    .filter(el => el.classList.contains('section'))
    .map(el => ({ el, title: (el.querySelector('.section-header, .section-title, h2, h3')?.textContent ?? 'Section').trim() }));
}

function normaliseLastSection(doc) {
  const list = sectionsOf(doc);
  if (!list.some(s => s.el.style.marginBottom)) return;
  list.forEach(s => s.el.style.removeProperty('margin-bottom'));
  list.forEach(s => { if (!s.el.getAttribute('style')) s.el.removeAttribute('style'); });
  list.at(-1)?.el.style.setProperty('margin-bottom', '0');
}

function gridColumns(doc, selector) {
  const el = doc.querySelector(selector);
  if (!el) return null;
  return doc.defaultView.getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
}

// ---------- ATS ----------

const STANDARD_HEADINGS = /^(profile|summary|professional summary|profile summary|career summary|objective|experience|professional experience|work experience|employment|skills|technical skills|core skills|key skills|education|certifications?|licenses?|training|projects|key projects|achievements|awards|publications|languages|volunteering|interests)\b/i;
const SAFE_FONTS = /^(arial|helvetica|calibri|cambria|georgia|garamond|times new roman|noto sans|noto serif|liberation sans|liberation serif|segoe ui|roboto|lato|open sans|source sans pro|verdana|tahoma|ubuntu sans|dejavu sans|inter)$/i;
const WEAK_OPENERS = /^(responsible for|worked on|helped|assisted|involved in|participated in|tasked with|duties included)\b/i;

const TECH = new Set(`java kotlin python javascript typescript go golang rust ruby php scala swift c c++ c# .net sql nosql html css sass
react angular vue svelte next.js nextjs node node.js nodejs express nestjs django flask fastapi spring springboot hibernate
postgresql postgres mysql mariadb mongodb redis cassandra dynamodb elasticsearch kafka rabbitmq graphql rest grpc websockets
aws azure gcp docker kubernetes k8s terraform ansible jenkins git github gitlab ci/cd linux nginx microservices serverless lambda s3 ec2
llm llms rag langchain langgraph openai pytorch tensorflow nlp ml ai genai embeddings vector chromadb pinecone
erpnext frappe android ios flutter jira agile scrum tdd junit pytest selenium cypress oauth jwt sso rbac etl airflow spark pandas numpy`.split(/\s+/));

const STOP = new Set(`a an and or the of to in on for with by as at from is are be been being this that these those it its we you our your
they their he she them us will would can could should may might must shall do does did done have has had having not no yes
about above after again against all also am any because before below between both but during each few further here how into
more most other over own same so some such than then there through too under until up very what when where which while who whom
why work working team teams role roles experience experiences year years strong ability able skills skill knowledge understanding
including include includes etc using use used join looking candidate candidates responsibilities requirements required preferred plus
good great excellent new build building develop developing development engineer engineers engineering software company business
across within based well across help ensure make day time part high level best practices environment opportunity job apply
must-have nice-to-have minimum degree bachelor bachelors related field equivalent communication written verbal`.split(/\s+/));

function jdKeywords(jd) {
  const matches = [...jd.matchAll(/[A-Za-z][A-Za-z0-9+#.]*(?:[-/][A-Za-z0-9+#.]+)*/g)];
  const tokens = matches.map(m => m[0]);
  // Two words only form a phrase when nothing but a space separates them ("Spring Boot", not "Python, FastAPI").
  const adjacent = i => matches[i + 1] && /^ +$/.test(jd.slice(matches[i].index + matches[i][0].length, matches[i + 1].index)) && !/\.$/.test(matches[i][0]);
  const counts = new Map();
  const add = (display, weight = 1) => {
    const key = display.toLowerCase().replace(/\.$/, '');
    if (key.length < 2 && key !== 'c') return;
    const entry = counts.get(key) ?? { display: display.replace(/\.$/, ''), n: 0 };
    entry.n += weight;
    counts.set(key, entry);
  };
  tokens.forEach((raw, i) => {
    const t = raw.replace(/\.$/, '');
    const lc = t.toLowerCase();
    if (STOP.has(lc)) return;
    const looksTech = TECH.has(lc) || /[A-Z].*[A-Z]/.test(t) || /[+#\d]/.test(t) || /\.[a-z]/i.test(t);
    if (looksTech) add(t);
    const next = tokens[i + 1]?.replace(/\.$/, '');
    if (next && adjacent(i) && /^[A-Z]/.test(t) && /^[A-Z]/.test(next) && !STOP.has(next.toLowerCase()) && !STOP.has(lc)) add(`${t} ${next}`);
  });
  const all = [...counts.values()];
  const kept = all.filter(e => TECH.has(e.display.toLowerCase()) || e.n >= 2 || /[A-Z].*[A-Z]|[+#\d.]/.test(e.display));
  return kept.sort((a, b) => b.n - a.n).slice(0, 36);
}

function containsTerm(haystack, term) {
  const t = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${t}($|[^a-z0-9])`, 'i').test(haystack);
}

function atsChecks(doc, extracted, resume) {
  const page = doc.querySelector('.page') ?? doc.body;
  const items = [];
  const push = (level, title, detail, fix) => items.push({ level, title, detail, fix });

  if (extracted) {
    push(extracted.text.trim().length > 300 ? 'ok' : 'fail',
      extracted.text.trim().length > 300 ? 'Text is selectable in the PDF' : 'The PDF has almost no readable text',
      extracted.text.trim().length > 300 ? null : 'An ATS cannot read text inside images. Rebuild the PDF from HTML.');
  }

  const headings = [...page.querySelectorAll('.section-header, .section-title, h2, h3')].map(h => h.textContent.trim());
  const odd = headings.filter(h => !STANDARD_HEADINGS.test(h));
  push(odd.length ? 'warn' : 'ok',
    odd.length ? `Unusual heading${odd.length > 1 ? 's' : ''}: ${odd.join(', ')}` : 'Section headings are standard',
    odd.length ? 'ATS parsers look for names like Experience, Skills and Education. Rename these so they are filed correctly.' : null);

  const has = re => headings.some(h => re.test(h));
  const missing = [['Experience', /experience|employment/i], ['Skills', /skills/i], ['Education', /education/i]]
    .filter(([, re]) => !has(re)).map(([name]) => name);
  if (missing.length) push('warn', `No ${missing.join(' or ')} section`, 'Most ATS forms expect these sections to exist.');

  const labels = [...page.querySelectorAll('.skill-label')].map(l => l.textContent.trim()).filter(Boolean);
  const twoCol = gridColumns(doc, '.skills-grid') > 1 || gridColumns(doc, '.cert-grid') > 1;
  if (twoCol) {
    const mergedLines = extracted && labels.length
      ? extracted.text.split('\n').filter(line => labels.filter(l => line.includes(l)).length >= 2)
      : [];
    const pair = mergedLines.length ? labels.filter(l => mergedLines[0].includes(l)).slice(0, 2).map(l => l.replace(/:$/, '')) : [];
    push('warn',
      mergedLines.length ? `${mergedLines.length} skill line${mergedLines.length > 1 ? 's are' : ' is'} read side by side` : 'Skills are laid out in two columns',
      mergedLines.length
        ? `In the PDF text, "${pair[0]}" and "${pair[1]}" share one line, so an ATS can file skills under the wrong group. One column reads cleanly.`
        : 'Some ATS read two columns across, mixing the groups. One column is the safest layout.',
      { label: 'Use one column', run: d => editCss(d, css => setRuleValue(setRuleValue(css, '.skills-grid', 'grid-template-columns', '1fr'), '.cert-grid', 'grid-template-columns', '1fr')) });
  } else {
    push('ok', 'Single-column layout', null);
  }

  const bareLinks = [...page.querySelectorAll('a[href^="http"]')].filter(a => {
    try { return !a.textContent.toLowerCase().includes(new URL(a.href).hostname.replace(/^www\./, '')); } catch { return false; }
  });
  if (bareLinks.length) {
    push('warn', `${bareLinks.map(a => a.textContent.trim()).join(', ')} show${bareLinks.length === 1 ? 's' : ''} only as words`,
      'An ATS keeps the text and drops the link, so the recruiter never sees your URLs. Print the addresses instead.',
      {
        label: 'Show the addresses',
        run: d => {
          [...(d.querySelector('.page') ?? d.body).querySelectorAll('a[href^="http"]')].forEach(a => {
            const u = new URL(a.href);
            const host = u.hostname.replace(/^www\./, '');
            if (!a.textContent.toLowerCase().includes(host)) a.textContent = `${host}${u.pathname}`.replace(/\/$/, '');
          });
          fitContactLine(d);
          return true;
        },
      });
  } else {
    push('ok', 'Profile links are written out', null);
  }

  const images = page.querySelectorAll('img').length;
  const tables = page.querySelectorAll('table').length;
  if (images || tables) push('warn', `${images ? `${images} image${images > 1 ? 's' : ''}` : ''}${images && tables ? ' and ' : ''}${tables ? `${tables} table${tables > 1 ? 's' : ''}` : ''} on the page`, 'Text inside images is invisible to an ATS, and tables are often read out of order.');
  else push('ok', 'No images or tables', null);

  const family = doc.defaultView.getComputedStyle(doc.body).fontFamily.split(',')[0].replace(/["']/g, '').trim();
  const printed = extracted?.fonts?.filter(f => !/symbol|dingbat/i.test(f)) ?? [];
  const printedFamily = printed[0]?.replace(/([a-z])([A-Z])/g, '$1 $2');
  if (!SAFE_FONTS.test(family)) push('warn', `${family} is an unusual font`, 'Stick to common fonts so text extracts cleanly everywhere.');
  else if (printedFamily && !printed.some(f => f.toLowerCase().replace(/\s/g, '') === family.toLowerCase().replace(/\s/g, ''))) {
    push('warn', `Asks for ${family}, prints as ${printedFamily}`,
      `${family} is not installed on this machine, so the PDF falls back to ${printedFamily}. Pick a font in Design so the PDF matches what you chose.`);
  } else push('ok', `${family} is a safe font`, null);

  const bullets = [...page.querySelectorAll('li')].map(li => li.textContent.trim()).filter(Boolean);
  if (bullets.length) {
    const withNumbers = bullets.filter(b => /\d/.test(b)).length;
    const share = withNumbers / bullets.length;
    push(share >= 0.4 ? 'ok' : 'warn', `${withNumbers} of ${bullets.length} bullets include a number`,
      share >= 0.4 ? null : 'Results with numbers (users, time saved, percentages) rank better with ATS scoring and read stronger to recruiters.');
    const weak = bullets.filter(b => WEAK_OPENERS.test(b));
    if (weak.length) push('warn', `${weak.length} bullet${weak.length > 1 ? 's start' : ' starts'} with a weak phrase`, `Start with what you did, for example "Built" or "Reduced". First one: "${weak[0].slice(0, 60)}..."`);
  }

  if (resume && !/deepakraj/i.test(resume.pdf)) push('warn', 'The PDF file name does not include your name', 'Recruiters search downloads by name.');

  return items;
}

// ---------- Panel ----------

const $ = id => document.getElementById(id);
const px2pt = v => parseFloat(v) * 0.75;
const px2mm = v => (parseFloat(v) * 25.4) / 96;
const fmt = n => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');

const ICON = {
  ok: '<path d="M4 8.5l2.5 2.5L12 5.5"/>',
  warn: '<path d="M8 4.5v4.5M8 11.5v.01"/>',
  fail: '<path d="M5 5l6 6M11 5l-6 6"/>',
};
const svgIcon = level => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[level]}</svg>`;

export function initTools(ctx) {
  let extracted = null;
  let extractedKey = null;

  const act = fn => {
    if (!ctx.canEdit()) return;
    ctx.ensureEditing();
    const doc = ctx.doc();
    if (!doc?.body) return;
    if (fn(doc) !== false) ctx.changed();
    refresh();
  };

  // Tabs
  const tabs = [['tabDesign', 'designPane'], ['tabAts', 'atsPane'], ['tabHistory', 'historyPane']];
  tabs.forEach(([tabId, paneId]) => {
    $(tabId).addEventListener('click', () => {
      tabs.forEach(([t, p]) => {
        $(t).setAttribute('aria-selected', String(t === tabId));
        $(p).hidden = p !== paneId;
      });
      try { localStorage.setItem('desk.tab', tabId); } catch {}
      if (paneId === 'atsPane') loadExtracted();
    });
  });
  try {
    const saved = localStorage.getItem('desk.tab');
    if (saved === 'tabAts' || saved === 'tabHistory') queueMicrotask(() => $(saved).click());
  } catch {}

  // Fonts and colours
  $('fontSel').replaceChildren(...FONTS.map(f => Object.assign(document.createElement('option'), { value: f.stack, textContent: f.label })));
  $('fontSel').addEventListener('change', e => act(doc => editCss(doc, css => setFont(css, e.target.value))));

  $('swatches').replaceChildren(...ACCENTS.map(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.setProperty('--c', a.hex);
    b.dataset.hex = a.hex;
    b.setAttribute('aria-label', a.name);
    b.title = a.name;
    b.addEventListener('click', () => act(doc => setAccent(doc, a.hex)));
    return b;
  }));
  // In-panel picker: the browser's own colour dialog opens off-screen next to the panel edge.
  let colourTimer;
  const previewCustom = hex => {
    $('customSwatch').style.setProperty('--c', hex);
    $('customSwatch').classList.add('picked');
  };
  const applySoon = hex => {
    previewCustom(hex);
    clearTimeout(colourTimer);
    colourTimer = setTimeout(() => act(doc => setAccent(doc, hex)), 120);
  };
  const fromSliders = () => hslToHex(Number($('hueRange').value), 0.8, Number($('depthRange').value) / 100);
  const paintTracks = () => {
    const h = Number($('hueRange').value);
    $('depthRange').style.setProperty('--track', `linear-gradient(90deg, ${hslToHex(h, 0.8, 0.15)}, ${hslToHex(h, 0.8, 0.48)})`);
  };
  $('customSwatch').addEventListener('click', () => {
    const open = $('customColour').hidden;
    $('customColour').hidden = !open;
    $('customSwatch').setAttribute('aria-expanded', String(open));
    if (open) $('hueRange').focus();
  });
  for (const id of ['hueRange', 'depthRange']) {
    $(id).addEventListener('input', () => {
      const hex = fromSliders();
      $('hexInput').value = hex;
      paintTracks();
      applySoon(hex);
    });
  }
  $('hexInput').addEventListener('input', () => {
    const v = $('hexInput').value.trim();
    const hex = (v.startsWith('#') ? v : `#${v}`).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    syncSliders(hex);
    applySoon(hex);
  });
  function syncSliders(hex) {
    const [h, , l] = hexToHsl(hex);
    $('hueRange').value = Math.round(h);
    $('depthRange').value = Math.round(clamp(l * 100, 15, 48));
    paintTracks();
  }

  // Steppers
  const steps = {
    text: (doc, dir) => editCss(doc, css => scaleFontSizes(css, dir > 0 ? 1.02 : 1 / 1.02)),
    line: (doc, dir) => editCss(doc, css => scaleLineHeights(css, dir > 0 ? 1.03 : 1 / 1.03)),
    space: (doc, dir) => editCss(doc, css => scaleSpacing(css, dir > 0 ? 1.12 : 1 / 1.12)),
    side: (doc, dir) => adjustPadding(doc, (t, s, b) => [t, clamp(s + dir * 0.5, 8, 30), b]),
    vert: (doc, dir) => adjustPadding(doc, (t, s, b) => [clamp(t + dir * 0.5, 4, 25), s, clamp(b + dir * 0.5, 4, 25)]),
  };
  document.querySelectorAll('.stepper').forEach(row => {
    const [down, up] = row.querySelectorAll('button');
    down.addEventListener('click', () => act(doc => steps[row.dataset.tool](doc, -1)));
    up.addEventListener('click', () => act(doc => steps[row.dataset.tool](doc, 1)));
  });

  document.querySelectorAll('[data-columns]').forEach(btn => btn.addEventListener('click', () => {
    const cols = btn.dataset.columns === '1' ? '1fr' : '1fr 1fr';
    act(doc => editCss(doc, css => setRuleValue(setRuleValue(css, '.skills-grid', 'grid-template-columns', cols), '.cert-grid', 'grid-template-columns', cols)));
  }));

  $('fitBtn').addEventListener('click', async () => {
    if (!ctx.canEdit()) return;
    ctx.ensureEditing();
    const doc = ctx.doc();
    const style = doc && mainStyle(doc);
    if (!style) return;
    const btn = $('fitBtn');
    btn.disabled = true;
    btn.textContent = 'Fitting...';
    const base = style.textContent;
    const apply = f => { style.textContent = scaleFontSizes(base, f); };
    const passes = m => m && m.pages === 1 && m.spare >= FIT_TARGET_PT;

    // Content can jump to page 2 as whole blocks, so the fit is a step function of text size.
    // Bigger text never frees space, so a binary search on real test prints converges safely.
    let best = null;
    let bestMetrics = null;
    try {
      apply(1);
      const now = await ctx.checkHtml(ctx.currentHtml());
      if (!now) {
        apply(1);
        ctx.toast('Fit needs the local dashboard to make test prints.', 'warn');
      } else {
        let lo = passes(now) ? 1 : 0.75;
        let hi = passes(now) ? 1.15 : 1;
        if (passes(now)) { best = 1; bestMetrics = now; }
        if (!passes(now)) {
          apply(lo);
          const floor = await ctx.checkHtml(ctx.currentHtml());
          if (passes(floor)) { best = lo; bestMetrics = floor; }
        }
        if (best != null) {
          for (let i = 0; i < 7 && hi - lo > 0.004; i++) {
            const mid = (lo + hi) / 2;
            apply(mid);
            const m = await ctx.checkHtml(ctx.currentHtml());
            if (passes(m)) { best = mid; bestMetrics = m; lo = mid; } else hi = mid;
          }
        }
      }
    } catch (err) {
      ctx.toast(`Could not make a test print. ${err.message}`, 'warn');
    }

    if (best == null) {
      apply(1);
      if (bestMetrics === null) ctx.toast('Even at 75% text size this does not fit on one page. Remove a bullet or a section first.', 'warn');
    } else {
      apply(best);
      ctx.changed();
      ctx.setCalibration(bestMetrics);
      const pct = Math.round(best * 100);
      ctx.toast(pct === 100
        ? `Already the best fit. A test print has ${fmt(bestMetrics.spare)} pt spare.`
        : `Text set to ${pct}%. A test print fits on one page with ${fmt(bestMetrics.spare)} pt spare.`);
    }
    btn.disabled = false;
    btn.textContent = 'Fit to one page';
    refresh();
  });

  function adjustPadding(doc, fn) {
    const page = doc.querySelector('.page');
    if (!page) return false;
    const cs = doc.defaultView.getComputedStyle(page);
    const [t, s, b] = fn(px2mm(cs.paddingTop), px2mm(cs.paddingLeft), px2mm(cs.paddingBottom)).map(v => round(v));
    return editCss(doc, css => setRuleValue(css, '.page', 'padding', `${t}mm ${s}mm ${b}mm ${s}mm`));
  }

  // Job match
  try { $('jdInput').value = localStorage.getItem('desk.jd') ?? ''; } catch {}
  let jdTimer;
  $('jdInput').addEventListener('input', () => {
    clearTimeout(jdTimer);
    jdTimer = setTimeout(() => {
      try { localStorage.setItem('desk.jd', $('jdInput').value); } catch {}
      renderMatch();
    }, 250);
  });

  function renderMatch() {
    const box = $('jdResult');
    const jd = $('jdInput').value.trim();
    const doc = ctx.doc();
    if (!jd || !doc?.body) { box.replaceChildren(); return; }
    const text = (doc.querySelector('.page') ?? doc.body).textContent;
    const words = jdKeywords(jd);
    if (!words.length) {
      box.replaceChildren(Object.assign(document.createElement('p'), { className: 'hint muted', textContent: 'No skills or tools found in that text yet.' }));
      return;
    }
    const found = words.filter(w => containsTerm(text, w.display));
    const missing = words.filter(w => !containsTerm(text, w.display));
    const summary = Object.assign(document.createElement('p'), {
      className: 'match-summary',
      textContent: `${found.length} of ${words.length} keywords are on this resume.`,
    });
    const chips = (list, cls) => {
      const wrap = document.createElement('div');
      wrap.className = 'chips';
      wrap.append(...list.map(w => Object.assign(document.createElement('span'), { className: `chip ${cls}`, textContent: w.display })));
      return wrap;
    };
    const parts = [summary];
    if (missing.length) {
      parts.push(Object.assign(document.createElement('h4'), { textContent: 'Missing' }), chips(missing, 'missing'));
      parts.push(Object.assign(document.createElement('p'), { className: 'hint muted', textContent: 'Add the ones you have really used, in a bullet that shows where.' }));
    }
    if (found.length) parts.push(Object.assign(document.createElement('h4'), { textContent: 'Already there' }), chips(found, 'found'));
    box.replaceChildren(...parts);
  }

  async function loadExtracted() {
    const r = ctx.resume();
    if (!r) return;
    const key = `${r.file}@${r.pdfUpdatedAt}`;
    if (key === extractedKey) return;
    extractedKey = key;
    extracted = null;
    if (ctx.isLocal() && r.pdfExists) {
      try {
        const res = await fetch(`/api/ats?file=${encodeURIComponent(r.file)}`, { cache: 'no-store' });
        if (res.ok) extracted = await res.json();
      } catch {}
    }
    if (extractedKey === key) refresh();
  }

  function renderAts() {
    const doc = ctx.doc();
    if (!doc?.body) return;
    const r = ctx.resume();
    $('atsChecks').replaceChildren(...atsChecks(doc, extracted, r).map(item => {
      const li = document.createElement('li');
      li.className = `ats-item ${item.level}`;
      li.innerHTML = svgIcon(item.level);
      const body = document.createElement('div');
      body.append(Object.assign(document.createElement('p'), { className: 'ats-title', textContent: item.title }));
      if (item.detail) body.append(Object.assign(document.createElement('p'), { className: 'hint muted', textContent: item.detail }));
      if (item.fix && ctx.canEdit()) {
        const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: item.fix.label });
        btn.addEventListener('click', () => act(item.fix.run));
        body.append(btn);
      }
      li.append(body);
      return li;
    }));

    if (extracted) {
      $('atsText').textContent = extracted.text;
      $('atsTextNote').textContent = ctx.isDirty()
        ? 'From the last saved PDF. Save to see your changes here.'
        : 'Pulled from the PDF the same way most ATS do. Read it top to bottom: this is the order they see.';
    } else {
      $('atsText').textContent = (doc.querySelector('.page') ?? doc.body).innerText;
      $('atsTextNote').textContent = ctx.isLocal()
        ? 'No PDF yet, so this is the text on the page.'
        : 'Built from the page text. Run the local dashboard to read the real PDF.';
    }
    renderMatch();
  }

  function renderDesign() {
    const doc = ctx.doc();
    const canEdit = ctx.canEdit();
    $('designNote').hidden = canEdit;
    $('designNote').textContent = 'Design tools work in the local dashboard. Run npm start and open http://localhost:4000.';
    $('designPane').querySelectorAll('button, select, input').forEach(el => { el.disabled = !canEdit; });
    if (!doc?.body) return;

    const view = doc.defaultView;
    const bodyStyle = view.getComputedStyle(doc.body);
    const page = doc.querySelector('.page');
    const pageStyle = page ? view.getComputedStyle(page) : null;
    const firstSection = doc.querySelector('.section');

    $('textOut').textContent = `${fmt(px2pt(bodyStyle.fontSize))} pt`;
    $('lineOut').textContent = bodyStyle.lineHeight === 'normal' ? 'Auto' : (parseFloat(bodyStyle.lineHeight) / parseFloat(bodyStyle.fontSize)).toFixed(2);
    $('spaceOut').textContent = firstSection ? `${fmt(px2pt(view.getComputedStyle(firstSection).marginBottom))} pt` : '-';
    $('sideOut').textContent = pageStyle ? `${fmt(px2mm(pageStyle.paddingLeft))} mm` : '-';
    $('vertOut').textContent = pageStyle ? `${fmt(px2mm(pageStyle.paddingTop))} mm` : '-';

    const family = bodyStyle.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const match = FONTS.find(f => f.label.toLowerCase() === family);
    const sel = $('fontSel');
    sel.querySelector('option[data-current]')?.remove();
    if (match) sel.value = match.stack;
    else {
      const opt = Object.assign(document.createElement('option'), { value: '', textContent: `${bodyStyle.fontFamily.split(',')[0].replace(/["']/g, '')} (current)`, disabled: true });
      opt.dataset.current = '';
      sel.prepend(opt);
      sel.value = '';
    }

    const accent = detectAccent(doc);
    $('swatches').querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-pressed', String(s.dataset.hex === accent)));
    if (accent && !$('customColour').contains(document.activeElement)) {
      $('hexInput').value = accent;
      syncSliders(accent);
      if (!ACCENTS.some(a => a.hex === accent)) previewCustom(accent);
      else $('customSwatch').classList.remove('picked');
    }
    $('customSwatch').setAttribute('aria-pressed', String(Boolean(accent) && !ACCENTS.some(a => a.hex === accent)));

    const cols = gridColumns(doc, '.skills-grid');
    document.querySelectorAll('[data-columns]').forEach(b => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.columns) === cols));
      b.disabled = !canEdit || cols == null;
    });

    const list = sectionsOf(doc);
    $('sectionList').replaceChildren(...list.map((s, i) => {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('span'), { className: 'section-name', textContent: s.title.charAt(0) + s.title.slice(1).toLowerCase() }));
      const mk = (label, path, disabled, run) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn';
        b.setAttribute('aria-label', `${label} ${s.title}`);
        b.title = label;
        b.disabled = disabled || !canEdit;
        b.innerHTML = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
        b.addEventListener('click', () => act(d => { run(sectionsOf(d)[i].el, d); normaliseLastSection(d); return true; }));
        return b;
      };
      li.append(
        mk('Move up', '<path d="M4 10l4-4 4 4"/>', i === 0, el => el.previousElementSibling.before(el)),
        mk('Move down', '<path d="M4 6l4 4 4-4"/>', i === list.length - 1, el => el.nextElementSibling.after(el)),
        mk('Remove', '<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5"/>', false, el => {
          ctx.toast(`Removed ${s.title.toLowerCase()}. Use Discard changes to bring it back.`);
          el.remove();
        }),
      );
      return li;
    }));
  }

  function refresh() {
    renderDesign();
    if (!$('atsPane').hidden) {
      loadExtracted();
      renderAts();
    }
  }

  return { refresh };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
