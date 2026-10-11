// @ts-nocheck
// The resume engine: design controls, ATS checks and in-page editing for the resume shown in the
// editor. Every control edits the resume's own <style> or DOM, so what is saved is exactly what was
// previewed. Ported unchanged from the original desk (dashboard/public/tools.js and app.js).

export const FONTS = [
  { label: 'Noto Sans', stack: '"Noto Sans", Arial, sans-serif' },
  { label: 'Arial', stack: 'Arial, "Liberation Sans", Helvetica, sans-serif' },
  { label: 'Ubuntu Sans', stack: '"Ubuntu Sans", "Noto Sans", Arial, sans-serif' },
  { label: 'Times New Roman', stack: '"Times New Roman", "Liberation Serif", serif' },
  { label: 'Noto Serif', stack: '"Noto Serif", Georgia, serif' },
];

export const ACCENTS = [
  { hex: '#0369a1', name: 'Blue' },
  { hex: '#1e3a5f', name: 'Navy' },
  { hex: '#0f766e', name: 'Teal' },
  { hex: '#166534', name: 'Green' },
  { hex: '#7f1d1d', name: 'Burgundy' },
  { hex: '#374151', name: 'Charcoal' },
];

export const FIT_TARGET_PT = 42;

// ---------- CSS helpers ----------

export const mainStyle = doc => [...doc.head.querySelectorAll('style')].find(s => !s.hasAttribute('data-editor'));
const round = n => Math.round(n * 100) / 100;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function editCss(doc, fn) {
  const style = mainStyle(doc);
  if (!style) return false;
  const next = fn(style.textContent);
  if (next === style.textContent) return false;
  style.textContent = next;
  return true;
}

export const scaleFontSizes = (css, f) =>
  css.replace(/(font-size\s*:\s*)([\d.]+)(pt|px)/g, (m, p, v, u) => `${p}${round(v * f)}${u}`);

export const scaleLineHeights = (css, f) =>
  css.replace(/(line-height\s*:\s*)([\d.]+)(?=\s*[;}])/g, (m, p, v) => `${p}${round(v * f)}`);

export const scaleSpacing = (css, f) => css
  .replace(/((?:margin-top|margin-bottom)\s*:\s*)([\d.]+)pt/g, (m, p, v) => `${p}${round(v * f)}pt`)
  .replace(/(\bgap\s*:\s*)([\d.]+)pt/g, (m, p, v) => `${p}${round(v * f)}pt`);

export function setRuleValue(css, selector, prop, value) {
  const re = new RegExp(`(${escapeRe(selector)}\\s*\\{[^}]*?${prop}\\s*:\\s*)([^;}]+)`);
  if (re.test(css)) return css.replace(re, (m, p) => p + value);
  return `${css}\n  ${selector} { ${prop}: ${value}; }\n`;
}

export function setFont(css, stack) {
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

export function hexToHsl(hex) {
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

export function hslToHex(h, s, l) {
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
export function detectAccent(doc) {
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
export function setAccent(doc, to) {
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

export function sectionsOf(doc) {
  const page = doc.querySelector('.page') ?? doc.body;
  return [...page.children]
    .filter(el => el.classList.contains('section'))
    .map(el => ({ el, title: (el.querySelector('.section-header, .section-title, h2, h3')?.textContent ?? 'Section').trim() }));
}

export function normaliseLastSection(doc) {
  const list = sectionsOf(doc);
  if (!list.some(s => s.el.style.marginBottom)) return;
  list.forEach(s => s.el.style.removeProperty('margin-bottom'));
  list.forEach(s => { if (!s.el.getAttribute('style')) s.el.removeAttribute('style'); });
  list.at(-1)?.el.style.setProperty('margin-bottom', '0');
}

export function gridColumns(doc, selector) {
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

export function jdKeywords(jd) {
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

export function containsTerm(haystack, term) {
  const t = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${t}($|[^a-z0-9])`, 'i').test(haystack);
}

export function atsChecks(doc, extracted, resume) {
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


const px2pt = v => parseFloat(v) * 0.75;
const px2mm = v => (parseFloat(v) * 25.4) / 96;
const fmt = n => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export { px2pt, px2mm, fmt, clamp };

// ---------- Design: steppers, columns, padding, fitting ----------

export function adjustPadding(doc, fn) {
  const page = doc.querySelector('.page');
  if (!page) return false;
  const cs = doc.defaultView.getComputedStyle(page);
  const [t, s, b] = fn(px2mm(cs.paddingTop), px2mm(cs.paddingLeft), px2mm(cs.paddingBottom)).map(v => Math.round(v * 100) / 100);
  return editCss(doc, css => setRuleValue(css, '.page', 'padding', `${t}mm ${s}mm ${b}mm ${s}mm`));
}
export const STEPS = {
  text: (doc, dir) => editCss(doc, css => scaleFontSizes(css, dir > 0 ? 1.02 : 1 / 1.02)),
  line: (doc, dir) => editCss(doc, css => scaleLineHeights(css, dir > 0 ? 1.03 : 1 / 1.03)),
  space: (doc, dir) => editCss(doc, css => scaleSpacing(css, dir > 0 ? 1.12 : 1 / 1.12)),
  side: (doc, dir) => adjustPadding(doc, (t, s, b) => [t, clamp(s + dir * 0.5, 8, 30), b]),
  vert: (doc, dir) => adjustPadding(doc, (t, s, b) => [clamp(t + dir * 0.5, 4, 25), s, clamp(b + dir * 0.5, 4, 25)]),
};
export const setColumns = (doc, n) => editCss(doc, css => setRuleValue(setRuleValue(css, '.skills-grid', 'grid-template-columns', n === 1 ? '1fr' : '1fr 1fr'), '.cert-grid', 'grid-template-columns', n === 1 ? '1fr' : '1fr 1fr'));
export function moveSection(doc, i, dir) {
  const el = sectionsOf(doc)[i]?.el;
  if (!el) return false;
  if (dir < 0 && el.previousElementSibling) el.previousElementSibling.before(el);
  else if (dir > 0 && el.nextElementSibling) el.nextElementSibling.after(el);
  normaliseLastSection(doc);
  return true;
}
export function removeSection(doc, i) {
  const el = sectionsOf(doc)[i]?.el;
  if (!el) return false;
  el.remove();
  normaliseLastSection(doc);
  return true;
}

// Current values for the design panel.
export function readDesign(doc) {
  if (!doc?.body) return null;
  const view = doc.defaultView;
  const body = view.getComputedStyle(doc.body);
  const page = doc.querySelector('.page');
  const ps = page ? view.getComputedStyle(page) : null;
  const first = doc.querySelector('.section');
  const familyName = body.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  return {
    text: `${fmt(px2pt(body.fontSize))} pt`,
    line: body.lineHeight === 'normal' ? 'Auto' : (parseFloat(body.lineHeight) / parseFloat(body.fontSize)).toFixed(2),
    space: first ? `${fmt(px2pt(view.getComputedStyle(first).marginBottom))} pt` : '-',
    side: ps ? `${fmt(px2mm(ps.paddingLeft))} mm` : '-',
    vert: ps ? `${fmt(px2mm(ps.paddingTop))} mm` : '-',
    family: familyName,
    font: FONTS.find(f => f.label.toLowerCase() === familyName.toLowerCase())?.stack ?? '',
    accent: detectAccent(doc),
    columns: gridColumns(doc, '.skills-grid'),
    sections: sectionsOf(doc).map(s => s.title.charAt(0) + s.title.slice(1).toLowerCase()),
  };
}

// Binary-searches the largest text size whose real test print fits one page with FIT_TARGET_PT spare.
export async function fitToOnePage(doc, check, html) {
  const style = mainStyle(doc);
  if (!style) return { ok: false, message: 'This resume has no stylesheet to adjust.' };
  const base = style.textContent;
  const apply = f => { style.textContent = scaleFontSizes(base, f); };
  const passes = m => m && m.pages === 1 && m.spare >= FIT_TARGET_PT;
  let best = null, bestMetrics = null;
  apply(1);
  const now = await check(html());
  if (!now) { apply(1); return { ok: false, message: 'Fitting needs test prints, which this desk cannot make right now.' }; }
  let lo = passes(now) ? 1 : 0.75, hi = passes(now) ? 1.15 : 1;
  if (passes(now)) { best = 1; bestMetrics = now; }
  else { apply(lo); const floor = await check(html()); if (passes(floor)) { best = lo; bestMetrics = floor; } }
  if (best != null) {
    for (let i = 0; i < 7 && hi - lo > 0.004; i++) {
      const mid = (lo + hi) / 2;
      apply(mid);
      const m = await check(html());
      if (passes(m)) { best = mid; bestMetrics = m; lo = mid; } else hi = mid;
    }
  }
  if (best == null) { apply(1); return { ok: false, message: 'Even at 75% text size this does not fit on one page. Remove a bullet or a section first.' }; }
  apply(best);
  const pct = Math.round(best * 100);
  return { ok: true, metrics: bestMetrics, message: pct === 100 ? `Already the best fit. A test print has ${fmt(bestMetrics.spare)} pt spare.` : `Text set to ${pct}%. A test print fits on one page with ${fmt(bestMetrics.spare)} pt spare.` };
}

// ---------- The page: measuring, editing in place, serialising ----------

export const PX_PER_PT = 96 / 72;

export function contentBottom(doc) {
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

const EDIT_CSS = `
  [data-ed] { outline: 1px dashed transparent; outline-offset: 2px; transition: outline-color .12s; cursor: text; }
  [data-ed]:hover { outline-color: rgba(139, 124, 255, .55); }
  [data-ed]:focus { outline: 1.5px solid #8B7CFF; background: rgba(139, 124, 255, .07); }
  li[data-ed]:empty { min-height: 1.3em; }
`;
export function makeEditable(doc) {
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
    node.querySelectorAll('svg').forEach(svg => { svg.setAttribute('contenteditable', 'false'); svg.dataset.lock = ''; });
  }
}
const unmark = root => {
  root.querySelectorAll('[data-ed]').forEach(n => { n.removeAttribute('contenteditable'); n.removeAttribute('data-ed'); });
  root.querySelectorAll('[data-lock]').forEach(n => { n.removeAttribute('contenteditable'); n.removeAttribute('data-lock'); });
};
export function makeReadOnly(doc) {
  doc.querySelector('style[data-editor]')?.remove();
  unmark(doc);
}
export function serialize(doc) {
  const root = doc.documentElement.cloneNode(true);
  root.querySelectorAll('style[data-editor]').forEach(n => n.remove());
  unmark(root);
  root.querySelectorAll('b').forEach(b => { const strong = doc.createElement('strong'); strong.append(...b.childNodes); b.replaceWith(strong); });
  return `<!DOCTYPE html>\n${root.outerHTML}\n`;
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
// Enter splits a bullet, Backspace on an empty bullet removes it. Returns true when the page changed.
export function handlePageKey(doc, e) {
  const sel = doc.getSelection();
  if (!sel.rangeCount) return false;
  const anchor = sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement;
  const host = anchor?.closest('[data-ed]');
  if (!host) return false;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (host.tagName !== 'LI') return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tail = doc.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    tail.setEnd(host, host.childNodes.length);
    const next = host.cloneNode(false);
    next.append(tail.extractContents());
    host.after(next);
    placeCaret(doc, next, true);
    return true;
  }
  if (e.key === 'Backspace' && host.tagName === 'LI' && sel.isCollapsed && !host.textContent.trim()) {
    e.preventDefault();
    const prev = host.previousElementSibling, next = host.nextElementSibling;
    host.remove();
    if (prev) placeCaret(doc, prev, false); else if (next) placeCaret(doc, next, true);
    return true;
  }
  return false;
}
// Icons sit inside editable contact lines; never let a delete or typing remove one.
export function guardIcons(doc, e) {
  for (const target of e.getTargetRanges?.() ?? []) {
    const range = doc.createRange();
    range.setStart(target.startContainer, target.startOffset);
    range.setEnd(target.endContainer, target.endOffset);
    if (range.cloneContents().querySelector('svg')) { e.preventDefault(); return; }
  }
}

// ---------- Links ----------

export function normaliseHref(value) {
  const v = value.trim();
  if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^\+?[\d\s()-]{7,}$/.test(v)) return `tel:${v.replace(/[^\d+]/g, '')}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
  return null;
}
export function addressText(href) {
  if (/^mailto:/i.test(href)) return href.slice(7);
  if (/^tel:/i.test(href)) return href.slice(4);
  try { const u = new URL(href); return `${u.hostname.replace(/^www\./, '')}${u.pathname}`.replace(/\/$/, ''); } catch { return href; }
}
