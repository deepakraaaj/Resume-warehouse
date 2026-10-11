// Job Hunt: a home that says what to do next, a journey per company (research → apply → prepare →
// practice), flashcards, a practice room for mock interviews and explanations, and AI status.
// Talks only to /api/prep/*; every AI call runs on the server with the keys kept there.
import { START_DEFAULT, TARGETS as GOALS, WEEKS, DAYS, CAT_NAME } from './hunt-plan.js';

// ---------- Helpers ----------

const $ = id => document.getElementById(id);
const main = $('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = v => (Array.isArray(v) ? v : []);
const safeUrl = u => (/^https?:\/\//i.test(String(u ?? '')) ? String(u) : '');
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (d, o) => d.toLocaleDateString('en-IN', o ?? { weekday: 'short', day: 'numeric', month: 'short' });
const ago = t => { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const dur = ms => { if (ms == null) return ''; const s = Math.ceil(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`; };
const daysUntil = d => { if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((parseDate(d) - t) / 864e5); };
const local = { get(k, f) { try { const v = localStorage.getItem(`hunt-${k}`); return v ? JSON.parse(v) : f; } catch { return f; } }, set(k, v) { try { localStorage.setItem(`hunt-${k}`, JSON.stringify(v)); } catch { /* optional */ } } };
const hour = new Date().getHours();
const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

let toastTimer;
function toast(text, bad = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast${bad ? ' bad' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), bad ? 6500 : 2600);
}

async function call(method, route, payload) {
  const url = method === 'GET' ? `/api/prep/${route}${payload ? `?${new URLSearchParams(payload)}` : ''}` : `/api/prep/${route}`;
  const res = await fetch(url, method === 'GET' ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/'; throw new Error('Sign in first.'); }
  if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
  if (method === 'POST') refreshStatusSoon();
  return data;
}
const get = (r, q) => call('GET', r, q);
const post = (r, b) => call('POST', r, b);

// Runs an action with a busy button; errors become a toast.
async function busy(button, label, fn) {
  const old = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = `<span class="spinner"></span>${esc(label)}`; }
  try { return await fn(); }
  catch (err) { toast(err.message, true); return undefined; }
  finally { if (button?.isConnected) { button.disabled = false; button.innerHTML = old; } }
}

// Light markdown: paragraphs, bullets, bold, and [S#] citations linked to their sources.
function md(text, sources = []) {
  const byN = new Map(arr(sources).map(s => [String(s.n), s]));
  const cite = s => s.replace(/\[((?:S?\d+\s*,?\s*)+)\]/g, (m, ids) => ids.split(',').map(x => x.trim().replace(/^S/, '')).filter(Boolean).map(n => {
    const src = byN.get(n);
    return src && safeUrl(src.url) ? `<a class="ref" href="${esc(src.url)}" target="_blank" rel="noopener" title="${esc(src.title || src.site)}">${esc(n)}</a>` : `<span class="ref">${esc(n)}</span>`;
  }).join(''));
  let html = '', list = false;
  for (const raw of esc(text).split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)/);
    if (bullet) { if (!list) { html += '<ul>'; list = true; } html += `<li>${bullet[1]}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (line && !/^\|?[-: |]+\|?$/.test(line)) html += `<p>${line.replace(/^#+\s*/, '').replace(/^\||\|$/g, '').replace(/\s\|\s/g, ' — ')}</p>`;
  }
  if (list) html += '</ul>';
  return cite(html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'));
}
const refs = (list, sources) => md(arr(list).map(r => `[${String(r).replace(/[[\]]/g, '')}]`).join(''), sources).replace(/<\/?p>/g, '');
const labelChip = l => `<span class="chip ${esc(l)}">${esc({ official: 'Official', 'candidate-reported': 'Candidate reports', unverified: 'Unverified' }[l] ?? 'Unverified')}</span>`;
// Progress bars: amber while early, pine once solid. Usage gauges pass 'use' to go pine → amber → red as they fill.
const bar = (pct, cls = '') => {
  const tone = cls === 'use' ? (pct > 85 ? 'hi' : pct > 60 ? 'mid' : '') : cls || (pct < 40 ? 'lo' : '');
  return `<div class="bar ${tone}"><i style="width:${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))}%"></i></div>`;
};
function sourcesList(sources) {
  if (!arr(sources).length) return '<p class="muted small">No sources.</p>';
  return `<ol class="sources">${arr(sources).map(s => `<li><span class="faint">${s.n}</span><span>${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.site)}</a>` : esc(s.title)} <span class="faint">${esc(s.site || '')}</span></span></li>`).join('')}</ol>`;
}

// ---------- Voice ----------

// Records with the mic, transcribes with Whisper on the server, and appends to a textarea.
// Falls back to the browser's speech recognition if recording or transcription isn't available.
function attachVoice(button, textarea, hint, { idle = '🎙 Speak', recording = '■ Stop' } = {}) {
  let rec = null, chunks = [], timer = null, started = 0, recog = null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const say = t => { if (hint) hint.textContent = t; };
  const append = text => { textarea.value = `${textarea.value.trim()} ${text}`.trim(); textarea.dispatchEvent(new Event('input')); };
  const reset = () => { clearInterval(timer); button.classList.remove('rec'); button.innerHTML = idle; button.setAttribute('aria-label', 'Start speaking'); };
  reset();
  function browserVoice() {
    if (!SR) { say('Voice input is not available in this browser. Type your answer instead.'); return; }
    recog = new SR();
    recog.lang = 'en-IN';
    recog.continuous = true;
    recog.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) append(e.results[i][0].transcript); };
    recog.onend = () => { reset(); say(''); recog = null; };
    recog.onerror = () => { reset(); say('Voice input stopped.'); };
    recog.start();
    button.classList.add('rec'); button.innerHTML = recording; button.setAttribute('aria-label', 'Stop');
    say('Listening. Press stop when you finish.');
  }
  button.addEventListener('click', async () => {
    if (recog) { recog.stop(); return; }
    if (rec?.state === 'recording') { rec.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return browserVoice();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { say('The microphone is blocked. Allow it in your browser, or type.'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) ?? '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      reset();
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      say('Turning your answer into text…');
      try {
        const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
        const { text } = await post('transcribe', { audio: b64, mime: blob.type });
        append(text);
        say('Check the text, then submit.');
      } catch (err) { say(`${err.message} Switching to browser voice.`); browserVoice(); }
    };
    rec.start(1000);
    started = Date.now();
    button.classList.add('rec'); button.innerHTML = recording; button.setAttribute('aria-label', 'Stop');
    timer = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      say(`Recording ${Math.floor(s / 60)}:${pad(s % 60)} of 3:00`);
      if (s >= 180) rec.stop();
    }, 500);
  });
}

// ---------- State ----------

const S = { targets: [], profile: null, sprint: null, status: null, resumes: null, sections: {} };
const STAGES = ['Researching', 'Preparing', 'Applied', 'Recruiter call', 'Online test', 'Tech round', 'Manager round', 'HR round', 'Offer', 'Joined', 'Rejected', 'Ghosted'];
const INTERVIEW_STAGES = ['Online test', 'Tech round', 'Manager round', 'HR round', 'Offer', 'Joined'];
const APPLIED_STAGES = ['Applied', 'Recruiter call', ...INTERVIEW_STAGES, 'Rejected', 'Ghosted'];

async function loadTargets() {
  S.targets = await get('targets').catch(err => { toast(err.message, true); return []; });
  renderSideTargets();
}
async function loadProfile() { S.profile = await get('profile').catch(() => null); return S.profile; }
async function loadSprint() {
  if (!S.sprint) S.sprint = { v: 1, start: START_DEFAULT, done: {}, checkins: {}, refs: 0, ...((await get('sprint').catch(() => null)) ?? {}) };
  return S.sprint;
}

function renderSideTargets() {
  const cur = location.hash.match(/^#t\/([\w-]+)/)?.[1];
  $('sideTargets').innerHTML = S.targets.slice(0, 8).map(t => `<a href="#t/${esc(t.id)}" ${t.id === cur ? 'aria-current="page"' : ''}><span>${esc(t.company)}</span><span>${t.readiness ?? 0}%</span></a>`).join('');
}

// ---------- Router ----------

let teardown = null;
async function route() {
  teardown?.();
  teardown = null;
  const parts = (location.hash.slice(1) || 'today').split('/');
  const view = parts[0];
  const navKey = view === 't' || view === 'new' ? 'targets' : view;
  document.querySelectorAll('[data-nav]').forEach(a => (a.dataset.nav === navKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (view === 't') document.querySelectorAll('.side-nav > [data-nav="targets"]').forEach(a => a.removeAttribute('aria-current'));
  renderSideTargets();
  window.scrollTo(0, 0);
  main.innerHTML = '<div class="page"><p class="muted"><span class="spinner"></span> Loading…</p></div>';
  try {
    if (view === 't' && parts[1]) await viewCompany(parts[1], parts[2] || 'auto', parts[3]);
    else if (view === 'targets') viewCompanies();
    else if (view === 'new') viewNew();
    else if (view === 'practice') await viewPractice();
    else if (view === 'ask') viewAsk();
    else if (view === 'sprint') await viewSprint(parts[1] || 'today');
    else if (view === 'profile') await viewProfile();
    else if (view === 'offers') viewOffers();
    else if (view === 'settings') await viewSettings();
    else if (view === 'more') viewMore();
    else await viewToday();
  } catch (err) {
    main.innerHTML = `<div class="page"><div class="callout warn">${esc(err.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- AI status (sidebar) ----------

let statusTimer;
async function refreshStatus() {
  try {
    S.status = await (await fetch('/api/prep/status', { cache: 'no-store' })).json();
    const llm = arr(S.status.budgets).filter(b => !b.id.startsWith('search:') && !b.id.includes('whisper'));
    const ready = llm.filter(b => b.state === 'ready').length;
    const searchOk = arr(S.status.budgets).some(b => (b.id.startsWith('search:') || /^groq:openai\/gpt-oss/.test(b.id)) && b.state === 'ready');
    const tone = !ready ? 'bad' : ready < llm.length / 2 || !searchOk ? 'warn' : 'ok';
    $('aiStatus').innerHTML = `<span class="dot ${tone}"></span>${ready} of ${llm.length} AI models ready${searchOk ? '' : ', search paused'}`;
  } catch { $('aiStatus').innerHTML = '<span class="dot"></span>AI status unavailable'; }
}
function refreshStatusSoon() { clearTimeout(statusTimer); statusTimer = setTimeout(refreshStatus, 1500); }

// ---------- Sprint helpers ----------

const dayDate = n => { const d = parseDate(S.sprint.start); d.setDate(d.getDate() + n - 1); return d; };
const todayIndex = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t - parseDate(S.sprint.start)) / 864e5) + 1; };
const clampDay = n => Math.max(1, Math.min(30, n));
const tid = (d, i) => `d${d}-${i}`;
const dayPct = n => { const k = DAYS[n - 1].k; return k.filter((_, i) => S.sprint.done[tid(n, i)]).length / k.length; };
const problems = () => DAYS.reduce((s, d, di) => s + d.k.reduce((x, t, i) => x + (t[3] && S.sprint.done[tid(di + 1, i)] ? t[3] : 0), 0), 0);
function streak() {
  let n = Math.min(todayIndex(), 30), s = 0;
  if (n >= 1 && dayPct(n) < 0.7) n--;
  for (; n >= 1; n--) { if (dayPct(n) >= 0.7) s++; else break; }
  return s;
}
let sprintSave;
function saveSprint() {
  clearTimeout(sprintSave);
  sprintSave = setTimeout(() => post('sprint', { state: S.sprint }).catch(err => toast(`Couldn't save your sprint: ${err.message}`, true)), 600);
}
function taskList(day) {
  const d = DAYS[day - 1];
  return `<ul class="task-list">${d.k.map((t, i) => { const id = tid(day, i), on = Boolean(S.sprint.done[id]); return `<li class="task ${on ? 'done' : ''}"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><label for="${id}"><span class="kind">${CAT_NAME[t[0]]}</span>${esc(t[1])}${t[4] ? `<span class="faint small" style="display:block">${esc(t[4])}</span>` : ''}</label><span class="mins">${t[2] ? `${t[2]} min` : ''}</span></li>`; }).join('')}</ul>`;
}
function wireTasks(root) {
  root.querySelectorAll('.task-list').forEach(ul => ul.addEventListener('change', e => {
    if (e.target.checked) S.sprint.done[e.target.id] = true; else delete S.sprint.done[e.target.id];
    e.target.closest('.task').classList.toggle('done', e.target.checked);
    saveSprint();
  }));
}

// ---------- Today ----------

// The single most useful thing to do now.
function nextAction() {
  const p = S.profile;
  if (!p || !arr(p.facts).length) return { kicker: 'Start here', title: 'Build your profile from your resumes', body: 'Every answer the app writes comes from your real experience. It takes about a minute, then you check what it found.', href: '#profile', label: 'Build my profile' };
  if (!S.targets.length) return { kicker: 'Next step', title: 'Add the first company you are applying to', body: 'Type the company and role. The app researches their interview rounds, pay and questions, with sources.', href: '#new', label: 'Add a company' };
  const upcoming = S.targets.filter(t => { const d = daysUntil(t.interviewDate); return d != null && d >= 0 && d <= 21; }).sort((a, b) => daysUntil(a.interviewDate) - daysUntil(b.interviewDate));
  const pool = upcoming.length ? upcoming : [...S.targets].filter(t => !['Rejected', 'Ghosted', 'Joined'].includes(t.stage)).sort((a, b) => (a.readiness ?? 0) - (b.readiness ?? 0));
  for (const t of pool) {
    const d = daysUntil(t.interviewDate);
    const kicker = d == null ? `Next step for ${t.company}` : d === 0 ? `${t.company} interview is today` : `${t.company} interview in ${d} day${d === 1 ? '' : 's'}`;
    const base = `#t/${t.id}`;
    if (!t.researched) return { kicker, title: `Research how ${t.company} interviews`, body: 'Four real web searches: rounds, questions candidates were asked, pay, and the company. Every claim gets a source.', href: `${base}/research`, label: 'Research now' };
    if (!arr(t.kit).includes('technical')) return { kicker, title: `Build your ${t.company} prep kit`, body: 'Likely questions with answers written from your own projects, plus HR answers and a salary script.', href: `${base}/prepare`, label: 'Build the kit' };
    const c = t.cards ?? { total: 0, known: 0 };
    if (c.total && c.known / c.total < 0.6) return { kicker, title: `Practise ${c.total - c.known} ${t.company} questions out loud`, body: `You have ${c.known} of ${c.total} down. Say each answer, then check it against the model answer.`, href: `${base}/prepare/cards`, label: 'Start flashcards' };
    const stale = !t.lastMockAt || Date.now() - Date.parse(t.lastMockAt) > 2 * 864e5;
    if (stale) return { kicker, title: `Run a mock ${t.company} interview`, body: t.mockCount ? `Your best mock so far is ${t.mockBest}/10. One more round finds the next weak spot.` : 'A 15-minute interview that behaves like their real rounds, with a score after every answer.', href: `${base}/practice/mock`, label: 'Start the mock' };
    if (t.fit == null && !APPLIED_STAGES.includes(t.stage)) return { kicker, title: `Check your fit and apply to ${t.company}`, body: 'See what matches, what to fix, and get a tailored summary and referral message.', href: `${base}/apply`, label: 'Check my fit' };
  }
  const day = clampDay(todayIndex());
  const left = DAYS[day - 1].k.filter((_, i) => !S.sprint.done[tid(day, i)]).length;
  if (left) return { kicker: 'Keep the streak', title: `Finish today's sprint: ${left} task${left === 1 ? '' : 's'} left`, body: DAYS[day - 1].t, href: '#sprint/today', label: 'Open today' };
  return { kicker: 'All caught up', title: 'Add another company to keep your pipeline full', body: 'More conversations mean more leverage when the offers come in.', href: '#new', label: 'Add a company' };
}

async function viewToday() {
  await Promise.all([loadSprint(), S.profile ? null : loadProfile()]);
  const n = nextAction();
  const ti = todayIndex();
  const day = clampDay(ti);
  const upcoming = S.targets.map(t => ({ t, d: daysUntil(t.interviewDate) })).filter(x => x.d != null && x.d >= 0).sort((a, b) => a.d - b.d);
  const active = S.targets.filter(t => !['Rejected', 'Ghosted'].includes(t.stage));
  const applied = S.targets.filter(t => APPLIED_STAGES.includes(t.stage)).length;
  const name = (S.profile?.name || '').split(' ')[0];
  main.innerHTML = `<div class="page">
    <header><h1>${greeting}${name ? `, ${esc(name)}` : ''}</h1><p class="muted" style="margin-top:8px;font-size:17px">${ti < 1 ? `Your 30-day sprint starts ${esc(fmtDate(parseDate(S.sprint.start), { weekday: 'long', day: 'numeric', month: 'long' }))}.` : ti > 30 ? 'Your 30-day sprint is complete.' : `Day ${ti} of your 30-day sprint: ${esc(DAYS[day - 1].t.toLowerCase())}.`}</p></header>
    <section class="next" aria-label="Next action"><div class="what"><span class="kicker">${esc(n.kicker)}</span><h2>${esc(n.title)}</h2><p class="muted">${esc(n.body)}</p></div><a class="btn signal" href="${esc(n.href)}">${esc(n.label)}</a></section>
    ${upcoming.length ? `<section class="stack"><h3>Coming up</h3><div class="countdowns">${upcoming.slice(0, 4).map(({ t, d }) => `<a class="countdown" href="#t/${esc(t.id)}"><b>${d === 0 ? 'Now' : d}${d ? `<small>day${d === 1 ? '' : 's'}</small>` : ''}</b><span><strong>${esc(t.company)}</strong><br><span class="muted small">${esc(fmtDate(parseDate(t.interviewDate)))}, ${esc(t.stage.toLowerCase())}</span></span></a>`).join('')}</div></section>` : ''}
    <section class="panel"><div class="section-title"><h3>How ready you are</h3><a href="#new">Add a company</a></div>
      ${active.length ? `<div class="companies">${active.map(t => `<a class="company-row" href="#t/${esc(t.id)}"><span class="name"><b>${esc(t.company)}</b><span class="muted small">${esc(t.role)}</span></span><span class="bar-cell">${bar(t.readiness ?? 0)}</span><span class="pct">${t.readiness ?? 0}%</span></a>`).join('')}</div>` : '<p class="muted">Readiness for each company shows here. Research, the prep kit, flashcards and mock interviews all count.</p>'}
    </section>
    <section class="panel"><div class="section-title"><h3>Today's sprint tasks</h3><a href="#sprint/today">Open the full day</a></div>
      ${taskList(day)}
      <div class="stat-line"><span><b>${problems()}</b>of ${GOALS.problems} problems</span><span><b>${applied}</b>of ${GOALS.apps} applications</span><span><b>${S.sprint.refs}</b>of ${GOALS.refs} referral asks</span><span><b>${streak()}</b>day streak</span></div>
    </section></div>`;
  wireTasks(main);
}

// ---------- Companies ----------

function viewCompanies() {
  main.innerHTML = `<div class="page">
    <div class="head"><div><h1>Companies</h1><p class="sub">Every company you're applying to, from research to offer.</p></div><a class="btn primary" href="#new">Add a company</a></div>
    ${S.targets.length ? `<div class="panel"><div class="companies">${S.targets.map(t => `<a class="company-row" href="#t/${esc(t.id)}"><span class="name"><b>${esc(t.company)}</b><span class="muted small">${esc(t.role)}, ${esc(t.stage.toLowerCase())}${t.interviewDate ? `, interview ${esc(fmtDate(parseDate(t.interviewDate)))}` : ''}</span></span><span class="bar-cell">${bar(t.readiness ?? 0)}</span><span class="pct">${t.readiness ?? 0}%</span></a>`).join('')}</div></div>`
      : '<div class="empty"><h3>No companies yet</h3><p>Add the company and role you are applying for. The app researches how they interview and builds your prep from your own projects.</p><a class="btn primary" href="#new">Add a company</a></div>'}</div>`;
}

function viewNew() {
  main.innerHTML = `<div class="page" style="max-width:720px">
    <div><h1>Add a company</h1><p class="sub">The more you give it, the sharper the prep. A pasted job description helps most.</p></div>
    <form class="panel" id="ntForm">
      <div class="form-grid"><label class="field"><span>Company</span><input type="text" id="ntCo" required placeholder="Infosys" autocomplete="off"></label>
        <label class="field"><span>Role</span><input type="text" id="ntRole" required placeholder="Python Developer" autocomplete="off"></label></div>
      <div class="form-grid"><label class="field"><span>City</span><input type="text" id="ntLoc" placeholder="Chennai"></label>
        <label class="field"><span>Interview date</span><input type="date" id="ntDate"><small>Leave empty if you don't have one yet.</small></label></div>
      <label class="field"><span>Job description</span><textarea id="ntJd" rows="7" placeholder="Paste the full job description (optional)"></textarea></label>
      <div class="row"><button class="btn primary" type="submit" id="ntGo">Add and start research</button><a class="btn quiet" href="#targets">Cancel</a></div>
    </form></div>`;
  $('ntCo').focus();
  $('ntForm').addEventListener('submit', e => {
    e.preventDefault();
    busy($('ntGo'), 'Adding', async () => {
      const t = await post('target-create', { company: $('ntCo').value, role: $('ntRole').value, location: $('ntLoc').value, interviewDate: $('ntDate').value, jd: $('ntJd').value });
      await loadTargets();
      autoResearch = t.id;
      location.hash = `#t/${t.id}/research`;
    });
  });
}

// ---------- Company page ----------

let autoResearch = null;
async function viewCompany(id, step, sub) {
  const t = await get('target', { id });
  if (step === 'auto') step = !t.research ? 'research' : !t.kit?.technical ? 'prepare' : (t.cardStats?.total && t.cardStats.known / t.cardStats.total < 0.6) ? 'prepare' : 'practice';
  const d = daysUntil(t.interviewDate);
  const cs = t.cardStats ?? { total: 0, known: 0 };
  const mocks = arr(t.mocks);
  const best = Math.max(0, ...mocks.map(m => Number(m.report?.overall) || 0));
  const steps = [
    ['research', 'Research', Boolean(t.research), t.research ? `${arr(t.research.sources).length} sources` : 'Not started'],
    ['apply', 'Apply', t.fit != null, t.fit ? `Fit ${t.fit.score} of 100` : APPLIED_STAGES.includes(t.stage) ? t.stage : 'Check your fit'],
    ['prepare', 'Prepare', Boolean(t.kit?.technical), cs.total ? `${cs.known} of ${cs.total} cards known` : `${Object.keys(t.kit ?? {}).length} of 6 sections`],
    ['practice', 'Practise', mocks.length > 0, mocks.length ? `Best mock ${best}/10` : 'No mocks yet'],
  ];
  main.innerHTML = `<div class="page">
    <header class="company-head"><div><h1>${esc(t.company)}</h1>
      <div class="meta"><span class="muted">${esc(t.role)}${t.location ? `, ${esc(t.location)}` : ''}</span>${d != null && d >= 0 ? `<span class="chip live">${d === 0 ? 'Interview today' : `Interview in ${d} day${d === 1 ? '' : 's'}`}</span>` : ''}<span class="chip">${t.readiness}% ready</span></div></div>
      <div class="row"><select id="cStage" aria-label="Stage" style="width:auto">${STAGES.map(s => `<option ${s === t.stage ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input type="date" id="cDate" value="${esc(t.interviewDate)}" aria-label="Interview date" style="width:auto">
        <button class="btn quiet danger sm" id="cDel">Delete</button></div></header>
    <nav class="journey" aria-label="Steps">${steps.map(([k, l, done, state], i) => `<a href="#t/${esc(id)}/${k}" ${k === step ? 'aria-current="page"' : ''} class="${done ? 'done' : ''}"><span class="step"><span class="num">${done ? '✓' : i + 1}</span>${l}</span><span class="state">${esc(state)}</span></a>`).join('')}</nav>
    <div id="cBody" class="stack" style="gap:24px"></div></div>`;
  const upd = async fields => { await post('target-update', { id, ...fields }); await loadTargets(); toast('Saved.'); };
  $('cStage').onchange = e => upd({ stage: e.target.value }).catch(err => toast(err.message, true));
  $('cDate').onchange = e => upd({ interviewDate: e.target.value }).then(route).catch(err => toast(err.message, true));
  $('cDel').onclick = () => {
    const b = $('cDel');
    if (b.dataset.armed) return busy(b, 'Deleting', async () => { await post('target-delete', { id }); await loadTargets(); location.hash = '#targets'; });
    b.dataset.armed = '1'; b.textContent = `Delete ${t.company}? Click again`;
    setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; } }, 4000);
  };
  const body = $('cBody');
  if (step === 'apply') return stepApply(t, body);
  if (step === 'prepare') return stepPrepare(t, body, sub);
  if (step === 'practice') return stepPractice(t, body, sub);
  return stepResearch(t, body);
}

const STEP_NAMES = ['How their interview rounds work', 'Questions candidates were asked', 'What this role pays', 'The company, tech stack and joining'];
function stepResearch(t, body) {
  const r = t.research;
  const runner = `<section class="panel"><div class="section-title"><h3>${r ? 'Update the research' : `Research ${esc(t.company)}`}</h3>${r ? `<span class="faint small">Last run ${esc(ago(Date.parse(r.at)))}</span>` : ''}</div>
      ${r ? '' : `<p class="muted">Four web searches, then a short brief. Each claim is marked as official, from candidate reports, or unverified, with a link to the source.</p><label class="field"><span>Job description (optional)</span><textarea id="rJd" rows="5">${esc(t.jd)}</textarea></label>`}
      <ol class="steps" id="rSteps">${STEP_NAMES.map(n => `<li>${n}</li>`).join('')}<li>Write the brief</li></ol>
      <div class="row"><button class="btn primary" id="rGo">${r ? 'Run again' : 'Start research'}</button>${r ? '<button class="btn quiet" id="rFresh">Search again from scratch</button><span class="faint small">Searches are saved for 7 days to save your free quota.</span>' : '<span class="faint small">Takes 1 to 3 minutes.</span>'}</div></section>`;
  body.innerHTML = r ? `${researchBrief(t)}${runner}` : runner;
  const run = fresh => busy($('rGo'), 'Researching', async () => {
    if ($('rJd') && $('rJd').value.trim() !== (t.jd ?? '')) await post('target-update', { id: t.id, jd: $('rJd').value });
    const items = [...$('rSteps').children];
    for (let i = 0; i < 4; i++) {
      items[i].className = 'run';
      const out = await post('research', { id: t.id, step: i, fresh }).catch(err => ({ error: err.message }));
      items[i].className = out.error ? 'err' : 'done';
      items[i].textContent = `${STEP_NAMES[i]}: ${out.error ? out.error : `${out.sources} sources${out.cached ? ', saved earlier' : ''}`}`;
    }
    items[4].className = 'run';
    await post('synthesize', { id: t.id });
    items[4].className = 'done';
    await loadTargets();
    route();
  });
  $('rGo').onclick = () => run(false);
  if ($('rFresh')) $('rFresh').onclick = () => run(true);
  if (autoResearch === t.id) { autoResearch = null; run(false); }
}

function researchBrief(t) {
  const r = t.research, src = r.sources;
  const facts = (items, fn) => (arr(items).length ? `<ul class="facts">${arr(items).map(fn).join('')}</ul>` : '<p class="faint">Nothing found.</p>');
  return `<p class="lead">${md(r.summary, src).replace(/<\/?p>/g, ' ')}</p>
    <section class="panel"><h3>The rounds</h3><ol class="rounds">${arr(r.rounds).map(x => `<li><div class="r-head"><b>${esc(x.name)}</b>${labelChip(x.label)}${refs(x.refs, src)}</div><p class="muted small">${esc(x.format)}</p><p>${esc(x.tests)}</p>${x.tips && !/not in research/i.test(x.tips) ? `<p class="small"><b>Tip:</b> ${esc(x.tips)}</p>` : ''}</li>`).join('') || '<li>Not found in research.</li>'}</ol></section>
    <div class="cols">
      <section class="panel"><div class="row spread"><h3>Pay</h3>${labelChip(r.salary?.label)}</div><div class="big-num">${esc(r.salary?.range ?? 'Not found')}</div><p class="muted small">${esc(r.salary?.basis ?? '')} ${refs(r.salary?.refs, src)}</p></section>
      <section class="panel"><h3>What they look for</h3>${facts(r.whatTheyValue, x => `<li>${esc(x)}</li>`)}</section>
      <section class="panel"><h3>About the company</h3>${facts(r.companyFacts, x => `<li>${esc(x.fact)} ${refs(x.refs, src)}</li>`)}</section>
      <section class="panel"><h3>What the role needs</h3>${facts(r.jdNeeds, x => `<li>${esc(x)}</li>`)}${arr(r.techStack).length ? `<div class="kw">${arr(r.techStack).map(x => `<span>${esc(x.item)}</span>`).join('')}</div>` : ''}</section>
    </div>
    ${arr(r.redFlags).length ? `<div class="callout warn"><h3>Watch out</h3>${facts(r.redFlags, x => `<li>${md(x, src).replace(/<\/?p>/g, '')}</li>`)}</div>` : ''}
    ${arr(r.conflicts).length ? `<div class="callout warn"><h3>Sources disagree</h3>${facts(r.conflicts, x => `<li>${md(x, src).replace(/<\/?p>/g, '')}</li>`)}</div>` : ''}
    ${arr(r.unknowns).length ? `<section class="panel"><h3>Ask the recruiter</h3><p class="muted small">The research couldn't confirm these. Ask instead of guessing.</p>${facts(r.unknowns, x => `<li>${esc(x)}</li>`)}</section>` : ''}
    <section class="panel"><details><summary>${arr(src).length} sources</summary>${sourcesList(src)}</details></section>`;
}

// ---------- Apply ----------

async function stepApply(t, body) {
  if (!S.resumes) S.resumes = await fetch('/api/state', { cache: 'no-store' }).then(r => r.json()).then(d => arr(d.resumes)).catch(() => []);
  const f = t.fit;
  body.innerHTML = `
    ${f ? `<section class="panel"><div class="row" style="gap:22px;align-items:center"><div class="score-ring" style="--p:${Number(f.score) || 0}"><span>${esc(f.score)}</span></div><div class="stack" style="gap:6px;flex:1;min-width:220px"><h2>${esc(f.verdict)}</h2><p class="muted">${esc(f.experienceMatch)}</p></div></div>
      <div class="cols"><div class="stack"><h3>Where you match</h3><ul class="facts">${arr(f.matched).map(m => `<li><b>${esc(m.need)}.</b> ${esc(m.proof)}</li>`).join('')}</ul></div>
      <div class="stack"><h3>Gaps and how to close them</h3><ul class="facts">${arr(f.gaps).map(m => `<li><b>${esc(m.need)}.</b> ${esc(m.fix)}</li>`).join('')}</ul></div></div>
      ${arr(f.keywords).length ? `<div class="stack"><h3>Keywords to add, only if true</h3><div class="kw">${arr(f.keywords).map(k => `<span>${esc(k)}</span>`).join('')}</div></div>` : ''}</section>
    <section class="panel"><h3>Tailored for ${esc(t.company)}</h3>
      <label class="field"><span>Summary</span><textarea id="aSum" rows="3">${esc(f.summary)}</textarea></label>
      <label class="field"><span>Bullets</span><textarea id="aBul" rows="7">${esc(arr(f.bullets).map(b => `• ${b}`).join('\n'))}</textarea></label>
      <div class="row"><button class="btn sm" data-copy="aSum">Copy summary</button><button class="btn sm" data-copy="aBul">Copy bullets</button></div>
      <div class="row" style="border-top:1px solid var(--line);padding-top:14px"><span class="muted small">Make a copy of a resume for ${esc(t.company)}, then paste these in:</span>
        <select id="aBase" style="width:auto;max-width:100%">${S.resumes.map(r => `<option value="${esc(r.file)}">${esc(r.file.replace(/\.html$/, '').replace(/_/g, ' '))}</option>`).join('')}</select><button class="btn sm" id="aCopy" ${S.resumes.length ? '' : 'disabled'}>Create copy</button>
        ${t.resumeFile ? `<a class="small" href="/?r=${encodeURIComponent(t.resumeFile.replace(/\.html$/, ''))}">Open ${esc(t.resumeFile.replace(/\.html$/, '').replace(/_/g, ' '))}</a>` : ''}</div></section>` : ''}
    <section class="panel"><h3>${f ? 'Job description' : `Check your fit for ${esc(t.company)}`}</h3>${f ? '' : '<p class="muted">Paste the job description for a sharper result. Without one, the research is used.</p>'}
      <textarea id="aJd" rows="${f ? 4 : 8}" placeholder="Paste the job description">${esc(t.jd)}</textarea>
      <div class="row"><button class="btn primary" id="aFit">${f ? 'Check again' : 'Check my fit'}</button></div></section>
    <section class="panel"><h3>Write a message</h3>
      <div class="seg" id="mType" role="group" aria-label="Message type">${[['referral', 'Referral ask'], ['recruiter', 'Recruiter reply'], ['followup', 'Follow-up'], ['thanks', 'Thank-you'], ['counter', 'Salary counter'], ['post', 'LinkedIn post']].map(([k, l], i) => `<button type="button" data-v="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
      <div class="form-grid"><label class="field"><span>Their name</span><input type="text" id="mName" placeholder="Optional"></label><label class="field"><span>Anything to mention</span><input type="text" id="mExtra" placeholder="Same college, offered 7 LPA…"></label></div>
      <div class="row"><button class="btn primary" id="mGo">Write it</button></div>
      <textarea id="mOut" rows="6" ${t.messages?.[0] ? '' : 'hidden'}>${esc(t.messages?.[0]?.text ?? '')}</textarea>
      <div class="row" id="mCopyRow" ${t.messages?.[0] ? '' : 'hidden'}><button class="btn sm" data-copy="mOut">Copy message</button></div></section>`;
  $('mType').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('mType').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  $('aFit').onclick = () => busy($('aFit'), 'Checking', async () => {
    if ($('aJd').value.trim() !== (t.jd ?? '')) await post('target-update', { id: t.id, jd: $('aJd').value });
    await post('fit', { id: t.id }); await loadTargets(); route();
  });
  if ($('aCopy')) $('aCopy').onclick = () => busy($('aCopy'), 'Creating', async () => { const out = await post('tailor-copy', { id: t.id, from: $('aBase').value }); toast(`Created ${out.file.replace(/\.html$/, '')}.`); route(); });
  $('mGo').onclick = () => busy($('mGo'), 'Writing', async () => {
    const type = $('mType').querySelector('[aria-pressed="true"]').dataset.v;
    const out = await post('message', { id: t.id, type, name: $('mName').value, extra: $('mExtra').value });
    $('mOut').hidden = false; $('mCopyRow').hidden = false; $('mOut').value = out.text;
  });
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  const el = $(b.dataset.copy);
  try { await navigator.clipboard.writeText(el.value ?? el.textContent); toast('Copied.'); } catch { el.select?.(); toast('Press Ctrl+C to copy.'); }
});

// ---------- Prepare: flashcards + study notes ----------

const KIT_ORDER = ['technical', 'projects', 'hr', 'concepts', 'ask', 'plan'];
async function stepPrepare(t, body, sub) {
  if (!Object.keys(S.sections).length) S.sections = await get('sections').catch(() => ({}));
  const kit = t.kit ?? {};
  const missing = KIT_ORDER.filter(k => !kit[k]);
  const mode = sub === 'notes' || !t.cards?.length ? 'notes' : 'cards';
  body.innerHTML = `
    ${!t.research ? `<div class="callout warn">Research ${esc(t.company)} first, so the prep matches how they actually interview. <a href="#t/${esc(t.id)}/research">Go to research</a></div>` : ''}
    ${missing.length ? `<section class="panel"><div class="row spread"><div class="stack" style="gap:4px"><h3>${kit.technical ? 'Finish your prep kit' : 'Build your prep kit'}</h3><p class="muted small">${missing.length} of 6 sections left. Each takes 15 to 40 seconds and uses only facts you marked as yours to defend.</p></div><button class="btn primary" id="kAll">Build ${missing.length === 6 ? 'the kit' : 'the rest'}</button></div>
      <div class="row">${missing.map(k => `<button class="btn sm" data-kit="${k}">${esc(S.sections[k] ?? k)}</button>`).join('')}</div></section>` : ''}
    ${t.cards?.length ? `<div class="row spread"><div class="seg" role="group" aria-label="View"><button type="button" data-mode="cards" aria-pressed="${mode === 'cards'}">Flashcards</button><button type="button" data-mode="notes" aria-pressed="${mode === 'notes'}">Study notes</button></div><span class="muted small">${t.cardStats.known} of ${t.cardStats.total} cards known</span></div>` : ''}
    <div id="pBody" class="stack" style="gap:20px"></div>`;
  body.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { location.hash = `#t/${t.id}/prepare/${b.dataset.mode}`; });
  body.querySelectorAll('[data-kit]').forEach(b => b.onclick = () => busy(b, 'Building', async () => { await post('kit', { id: t.id, section: b.dataset.kit }); await loadTargets(); route(); }));
  if ($('kAll')) $('kAll').onclick = () => busy($('kAll'), 'Building', async () => {
    for (const k of missing) { $('kAll').innerHTML = `<span class="spinner"></span>Building ${esc((S.sections[k] ?? k).toLowerCase())}`; await post('kit', { id: t.id, section: k }); }
    await loadTargets(); route();
  });
  if (mode === 'cards') flashcards(t, $('pBody'));
  else $('pBody').innerHTML = KIT_ORDER.filter(k => kit[k]).map(k => kitNotes(k, kit[k], t)).join('');
}

function flashcards(t, root) {
  const marks = { ...(t.practice ?? {}) };
  let filter = 'all', idx = 0, revealed = false, said = '', feedback = '';
  const decks = ['all', 'again', ...new Set(t.cards.map(c => c.deck))];
  const pending = {};
  let saveTimer;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { const p = { ...pending }; for (const k in pending) delete pending[k]; post('target-update', { id: t.id, practice: p }).then(loadTargets).catch(err => toast(err.message, true)); }, 800); };
  const list = () => t.cards.filter(c => filter === 'all' || (filter === 'again' ? marks[c.id] !== 'known' : c.deck === filter));
  const deckBar = () => `<div class="deck-bar"><div class="seg" id="fcDecks" role="group" aria-label="Pile">${decks.map(d => `<button type="button" data-d="${esc(d)}" aria-pressed="${d === filter}">${d === 'all' ? 'All cards' : d === 'again' ? 'Not known yet' : esc(d)}</button>`).join('')}</div></div>`;
  const wireDeck = () => $('fcDecks')?.addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { filter = b.dataset.d; idx = 0; revealed = false; said = ''; feedback = ''; render(); } });
  function render() {
    const cards = list();
    if (!cards.length) { root.innerHTML = `${deckBar()}<div class="empty"><h3>Nothing left in this pile</h3><p>Every card here is marked as known. Pick another pile or run a mock interview.</p><a class="btn primary" href="#t/${esc(t.id)}/practice/mock">Run a mock interview</a></div>`; wireDeck(); return; }
    idx = Math.min(idx, cards.length - 1);
    const c = cards[idx];
    root.innerHTML = `${deckBar()}
      <article class="card-face" aria-live="polite"><span class="deck">${esc(c.deck)}${c.deck === 'Projects' && c.note ? `: ${esc(c.note)}` : ''}. Card ${idx + 1} of ${cards.length}</span>
        <p class="q">${esc(c.q)}</p>
        <div class="stack"><div class="composer"><textarea id="fcIn" rows="3" placeholder="Answer before you look. Speak or type, then score it or show the answer.">${esc(said)}</textarea><button class="btn" id="fcMic" type="button"></button></div><span class="faint small" id="fcHint"></span></div>
        <div id="fcFb">${feedback}</div>
        ${revealed ? `<div class="answer"><h3>A strong answer</h3><div class="prose">${md(c.a)}</div>${c.points.length ? `<div class="kw">${c.points.map(p => `<span>${esc(p)}</span>`).join('')}</div>` : ''}${c.follow.map(f => `<p class="small"><b>If they follow up:</b> ${esc(f.q)} <span class="muted">${esc(f.a)}</span></p>`).join('')}${c.note && c.deck !== 'Projects' ? `<p class="small muted">${esc(c.note)}</p>` : ''}</div>` : ''}
        <div class="card-actions">${revealed
          ? '<button class="btn signal" id="fcAgain">Again later</button><button class="btn primary" id="fcKnown">Got it</button>'
          : '<button class="btn primary" id="fcReveal">Show answer</button><button class="btn" id="fcScore">Score my answer</button>'}
          <span style="flex:1"></span><button class="btn quiet" id="fcPrev" ${idx ? '' : 'disabled'}>Previous</button><button class="btn quiet" id="fcNext">Skip</button></div>
      </article>
      <div class="progress-dots" aria-hidden="true">${cards.map((x, i) => `<i class="${marks[x.id] ?? ''} ${i === idx ? 'cur' : ''}"></i>`).join('')}</div>`;
    wireDeck();
    attachVoice($('fcMic'), $('fcIn'), $('fcHint'));
    $('fcIn').addEventListener('input', e => { said = e.target.value; });
    const next = () => { revealed = false; said = ''; feedback = ''; };
    const mark = v => { marks[c.id] = v; pending[c.id] = v; save(); next(); if (filter !== 'again' || v !== 'known') idx++; render(); };
    if ($('fcReveal')) $('fcReveal').onclick = () => { revealed = true; render(); };
    if ($('fcScore')) $('fcScore').onclick = () => busy($('fcScore'), 'Scoring', async () => {
      if (said.trim().length < 20) { toast('Say or type a fuller answer first.', true); return; }
      const fb = await post('explain', { topic: c.q, kind: 'concept', explanation: said, targetId: t.id });
      feedback = feedbackBlock(fb);
      revealed = true;
      render();
    });
    if ($('fcAgain')) $('fcAgain').onclick = () => mark('again');
    if ($('fcKnown')) $('fcKnown').onclick = () => mark('known');
    $('fcPrev').onclick = () => { idx = Math.max(0, idx - 1); next(); render(); };
    $('fcNext').onclick = () => { idx = (idx + 1) % cards.length; next(); render(); };
  }
  render();
}

function feedbackBlock(fb) {
  return `<div class="feedback"><div class="row spread"><b>${esc(fb.verdict)}</b><span class="big-num" style="font-size:26px">${esc(fb.overall)}/10</span></div>
    <div class="score-grid">${Object.entries(fb.scores ?? {}).map(([k, v]) => `<span>${esc(k[0].toUpperCase() + k.slice(1))}</span>${bar(Number(v) * 20, Number(v) >= 4 ? 'ok' : 'lo')}<span>${esc(v)}</span>`).join('')}</div>
    ${arr(fb.fix).length ? `<div><b>Fix</b><ul class="list">${arr(fb.fix).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${arr(fb.missing).length ? `<div><b>They expected to hear</b><ul class="list">${arr(fb.missing).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${arr(fb.wrong).length ? `<div class="callout warn"><b>Not correct:</b> ${arr(fb.wrong).map(esc).join('; ')}</div>` : ''}
    <div class="callout"><b>Say it like this</b><p>${esc(fb.tighter)}</p></div></div>`;
}

function kitNotes(k, d, t) {
  const src = t.research?.sources;
  const items = arr(d.items);
  const head = `<div class="section-title"><h3>${esc(S.sections[k] ?? k)}</h3><button class="btn quiet sm" data-rebuild="${k}">Rebuild</button></div>`;
  const item = inner => `<div class="stack" style="gap:6px;border-top:1px solid var(--line);padding-top:12px">${inner}</div>`;
  let inner = '';
  if (k === 'technical') inner = items.map(x => item(`<b>${esc(x.q)}</b><span class="faint small">${esc(x.why)}</span><details><summary>Answer</summary><div class="prose">${md(x.answer)}</div></details>`)).join('');
  else if (k === 'projects') inner = items.map(x => item(`<b>${esc(x.project)}</b><p class="muted small">${esc(x.whyRelevant)}</p><p><b>In 30 seconds:</b> ${esc(x.pitch30)}</p><details><summary>The 2-minute story</summary><div class="prose">${md(x.star)}</div></details>${arr(x.dontSay).length ? `<p class="small"><b>Don't claim:</b> ${arr(x.dontSay).map(esc).join('; ')}</p>` : ''}`)).join('');
  else if (k === 'hr') inner = `${d.ctcScript ? `<div class="callout"><h3>Salary script</h3><p><b>Current:</b> ${esc(d.ctcScript.current)}</p><p><b>Expected:</b> ${esc(d.ctcScript.expected)}</p><p><b>If they push back:</b> ${esc(d.ctcScript.ifPushed)}</p><p><b>When to walk away:</b> ${esc(d.ctcScript.walkAway)}</p></div>` : ''}${items.map(x => item(`<b>${esc(x.q)}</b><details><summary>Answer</summary><div class="prose">${md(x.answer, src)}</div></details>`)).join('')}`;
  else if (k === 'concepts') inner = items.map(x => item(`<div class="row spread"><b>${esc(x.concept)}</b><span class="chip ${x.priority === 'must' ? 'bad' : x.priority === 'should' ? 'warn' : ''}">${esc({ must: 'Must know', should: 'Should know', nice: 'Nice to know' }[x.priority] ?? x.priority)}</span></div><p>${esc(x.simple)}</p><p class="small muted"><b>In your work:</b> ${esc(x.inYourWork)}</p><details><summary>Check yourself</summary>${arr(x.check).map(c => `<p class="small"><b>${esc(c.q)}</b> <span class="muted">${esc(c.a)}</span></p>`).join('')}</details>`)).join('');
  else if (k === 'ask') inner = `<ul class="facts">${items.map(x => `<li>${esc(x.q)} <span class="faint small">(${esc(x.round)} round)</span></li>`).join('')}</ul>`;
  else if (k === 'plan') inner = `${arr(d.days).map(x => item(`<b>${esc(x.day)}: ${esc(x.focus)}</b><ul class="list">${arr(x.tasks).map(z => `<li>${esc(z)}</li>`).join('')}</ul>`)).join('')}<div class="cols"><div><b>The day before</b><ul class="list">${arr(d.dayBefore).map(z => `<li>${esc(z)}</li>`).join('')}</ul></div><div><b>On the day</b><ul class="list">${arr(d.onTheDay).map(z => `<li>${esc(z)}</li>`).join('')}</ul></div></div>`;
  return `<section class="panel">${head}${inner}</section>`;
}
main.addEventListener('click', e => {
  const b = e.target.closest('[data-rebuild]');
  if (!b) return;
  const id = location.hash.match(/^#t\/([\w-]+)/)?.[1];
  busy(b, 'Rebuilding', async () => { await post('kit', { id, section: b.dataset.rebuild }); await loadTargets(); route(); });
});

// ---------- Practice room ----------

function stepPractice(t, body, sub) {
  const mode = sub === 'explain' ? 'explain' : 'mock';
  body.innerHTML = `<div class="seg" role="group" aria-label="Practice type"><button type="button" data-pm="mock" aria-pressed="${mode === 'mock'}">Mock interview</button><button type="button" data-pm="explain" aria-pressed="${mode === 'explain'}">Explain something</button></div><div id="room" class="stack" style="gap:24px"></div>`;
  body.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { location.hash = `#t/${t.id}/practice/${b.dataset.pm}`; });
  if (mode === 'explain') explainRoom($('room'), t);
  else mockRoom($('room'), t);
}

function mockRoom(root, t) {
  const rounds = arr(t.research?.rounds).map(r => r.name).filter(Boolean);
  const options = rounds.length ? rounds : ['Technical', 'Managerial', 'HR'];
  const key = `mock-${t.id}`;
  const st = local.get(key, { round: options.find(o => /tech/i.test(o)) ?? options[0], turns: [], feedback: {} });
  const lastQ = [...st.turns].reverse().find(x => x.role === 'assistant');
  const answered = st.turns.filter(x => x.role === 'user').length;
  const lastFb = st.feedback[st.turns.length - 2];
  const save = () => local.set(key, st);
  root.innerHTML = `<div class="room">
    ${st.turns.length ? `<div class="row spread"><span class="muted small">${esc(st.round)}. ${answered} answered so far.</span><div class="row"><button class="btn quiet sm" id="moRestart">Restart</button><button class="btn sm" id="moEnd" ${answered >= 2 ? '' : 'disabled'} title="${answered >= 2 ? '' : 'Answer at least two questions first'}">Finish and get my report</button></div></div>
      ${lastFb ? `<div class="feedback"><div class="row spread"><b>Your last answer</b><span class="pips" aria-label="${esc(lastFb.score)} out of 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= Number(lastFb.score) ? 'on' : ''}"></i>`).join('')}</span></div><p><b>Good:</b> ${esc(lastFb.strong)}</p><p><b>Missing:</b> ${esc(lastFb.missing)}</p><details><summary>A stronger answer</summary><div class="prose">${md(lastFb.better)}</div></details></div>` : ''}
      <div class="prompter"><span class="who" aria-hidden="true">${esc(t.company[0])}</span><p class="said">${esc(lastQ?.content ?? '')}</p></div>
      <div class="mic-zone"><button class="mic" id="moMic" type="button"></button><span class="mic-hint" id="moHint">Press to answer out loud, like the real interview</span></div>
      <textarea id="moIn" rows="4" placeholder="Your answer appears here. You can also type or edit it."></textarea>
      <div class="row"><button class="btn primary" id="moSend">Submit answer</button></div>`
    : `<div class="stack" style="gap:16px;align-items:flex-start"><h2>Mock ${esc(t.company)} interview</h2><p class="muted">The interviewer behaves like ${esc(t.company)}'s real round, using the research and your profile. Answer out loud. You get a score after every answer and a report at the end.</p>
      <label class="field" style="max-width:420px;width:100%"><span>Round</span><select id="moRound">${options.map(o => `<option ${o === st.round ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <button class="btn primary" id="moStart">Start the interview</button></div>`}
    ${st.turns.length > 2 ? `<details><summary>Conversation so far</summary><div class="history">${st.turns.slice(0, -1).map(x => `<div class="turn ${x.role === 'user' ? 'you' : ''}"><span class="faint small">${x.role === 'user' ? 'You' : 'Interviewer'}</span><span>${esc(x.content)}</span></div>`).join('')}</div></details>` : ''}
  </div>
  ${arr(t.mocks).length ? `<section class="panel"><h3>Your reports</h3>${arr(t.mocks).map(mockReport).join('')}</section>` : ''}`;
  if ($('moStart')) $('moStart').onclick = () => busy($('moStart'), 'The interviewer is joining', async () => {
    st.round = $('moRound').value; st.turns = []; st.feedback = {};
    const out = await post('mock', { id: t.id, round: st.round, history: [] });
    st.turns.push({ role: 'assistant', content: out.next }); save(); route();
  });
  if (!st.turns.length) return;
  attachVoice($('moMic'), $('moIn'), $('moHint'), { idle: '🎙', recording: '■' });
  $('moRestart').onclick = () => { st.turns = []; st.feedback = {}; save(); route(); };
  $('moSend').onclick = () => busy($('moSend'), 'The interviewer is thinking', async () => {
    const answer = $('moIn').value.trim();
    if (answer.length < 3) { toast('Answer first: press the mic or type.', true); return; }
    st.turns.push({ role: 'user', content: answer }); save();
    const out = await post('mock', { id: t.id, round: st.round, history: st.turns });
    st.feedback[st.turns.length - 1] = out;
    if (out.next) st.turns.push({ role: 'assistant', content: out.next });
    save(); route();
  });
  $('moEnd').onclick = () => busy($('moEnd'), 'Writing your report', async () => {
    await post('mock', { id: t.id, round: st.round, history: st.turns, action: 'report' });
    st.turns = []; st.feedback = {}; save(); await loadTargets(); route();
  });
}
function mockReport(m) {
  const r = m.report;
  if (!r) return '';
  return `<div class="stack" style="gap:8px;border-top:1px solid var(--line);padding-top:14px"><div class="row spread"><b>${esc(m.round)}: ${esc(r.overall)}/10, ${esc(r.hireSignal)}</b><span class="faint small">${esc(ago(Date.parse(m.at)))}</span></div><p>${esc(r.summary)}</p>
    <details><summary>Weak spots and what to drill</summary><ul class="facts">${arr(r.weakSpots).map(w => `<li><b>${esc(w.topic)}.</b> ${esc(w.fix)}</li>`).join('')}</ul><p style="margin-top:10px"><b>Next drills</b></p><ul class="list">${arr(r.nextDrills).map(d => `<li>${esc(d)}</li>`).join('')}</ul></details></div>`;
}

async function explainRoom(root, t) {
  if (!S.profile) await loadProfile();
  const projects = arr(S.profile?.projects).map(p => p.name);
  const concepts = arr(t?.kit?.concepts?.items).map(c => c.concept);
  const key = `explain-${t?.id ?? 'general'}`;
  const st = local.get(key, { topic: projects[0] ?? '', kind: 'project', rounds: [], history: [] });
  const last = st.rounds.at(-1);
  const save = () => local.set(key, st);
  root.innerHTML = `<div class="room">
    <div class="stack" style="gap:8px"><h2>Explain it like you would in the interview</h2><p class="muted">Pick a project or concept and talk for one to two minutes. You get scored on clarity, structure, depth and accuracy, then the follow-up a real interviewer would ask.</p></div>
    <div class="form-grid"><label class="field"><span>Pick a topic</span><select id="exPick"><option value="">Choose…</option>${projects.length ? `<optgroup label="Your projects">${projects.map(p => `<option data-kind="project" ${p === st.topic ? 'selected' : ''}>${esc(p)}</option>`).join('')}</optgroup>` : ''}${concepts.length ? `<optgroup label="Concepts for ${esc(t.company)}">${concepts.map(c => `<option data-kind="concept" ${c === st.topic ? 'selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>` : ''}</select></label>
      <label class="field"><span>Or type a topic or question</span><input type="text" id="exTopic" value="${esc(st.topic)}"></label></div>
    ${last ? `<div class="prompter"><span class="who" aria-hidden="true">?</span><p class="said">${esc(last.fb.followUp)}</p></div>` : ''}
    <div class="mic-zone"><button class="mic" id="exMic" type="button"></button><span class="mic-hint" id="exHint">${last ? 'Answer the follow-up out loud' : 'Press and start explaining'}</span></div>
    <textarea id="exIn" rows="5" placeholder="Your explanation appears here. You can also type or edit it."></textarea>
    <div class="row"><button class="btn primary" id="exGo">Score my explanation</button>${st.rounds.length ? '<button class="btn quiet" id="exReset">New topic</button>' : ''}</div>
    ${st.rounds.slice().reverse().map((r, i) => `<div class="stack" style="gap:10px;border-top:1px solid var(--line);padding-top:16px"><b>${i === st.rounds.length - 1 ? esc(r.topic) : `Follow-up: ${esc(r.topic)}`}</b>${feedbackBlock(r.fb)}<details><summary>What you said</summary><p class="muted">${esc(r.said)}</p></details></div>`).join('')}
  </div>`;
  attachVoice($('exMic'), $('exIn'), $('exHint'), { idle: '🎙', recording: '■' });
  $('exPick').onchange = e => { const o = e.target.selectedOptions[0]; if (o.value) { $('exTopic').value = o.value; st.kind = o.dataset.kind; st.topic = o.value; st.rounds = []; st.history = []; save(); explainRoom(root, t); } };
  if ($('exReset')) $('exReset').onclick = () => { st.rounds = []; st.history = []; save(); explainRoom(root, t); };
  $('exGo').onclick = () => busy($('exGo'), 'Scoring', async () => {
    const said = $('exIn').value.trim();
    const base = $('exTopic').value.trim();
    if (!base) { toast('Pick or type a topic first.', true); return; }
    if (base !== st.topic) { st.rounds = []; st.history = []; st.topic = base; }
    const topic = st.rounds.length ? st.rounds.at(-1).fb.followUp : base;
    const fb = await post('explain', { topic, kind: st.kind, explanation: said, history: st.history, targetId: t?.id });
    st.history.push({ role: 'user', content: `${topic}: ${said}` }, { role: 'assistant', content: `Follow-up: ${fb.followUp}` });
    st.rounds.push({ topic, said, fb });
    save(); explainRoom(root, t);
  });
}

async function viewPractice() {
  main.innerHTML = `<div class="page">
    <div><h1>Practice</h1><p class="sub">Interviews test whether you can say what you know. Pick a company for a mock interview or flashcards, or explain one of your projects.</p></div>
    ${S.targets.length ? `<section class="panel"><h3>With a company</h3><div class="companies">${S.targets.map(t => `<div class="company-row" style="grid-template-columns:minmax(0,1fr) auto"><span class="name"><b>${esc(t.company)}</b><span class="muted small">${t.mockCount ? `Best mock ${t.mockBest}/10` : 'No mocks yet'}, ${t.cards?.known ?? 0} of ${t.cards?.total ?? 0} cards known</span></span><span class="row"><a class="btn sm" href="#t/${esc(t.id)}/prepare/cards">Flashcards</a><a class="btn primary sm" href="#t/${esc(t.id)}/practice/mock">Mock interview</a></span></div>`).join('')}</div></section>` : ''}
    <div id="room"></div></div>`;
  await explainRoom($('room'), null);
}

// ---------- Ask ----------

function viewAsk() {
  const history = local.get('ask', []);
  main.innerHTML = `<div class="page" style="max-width:820px">
    <div><h1>Ask anything</h1><p class="sub">Ask in your own words. It works out what you need, searches the web, and answers with sources.</p></div>
    <section class="panel"><textarea id="askIn" rows="3" placeholder="What's the Infosys package for 2 years, and how do I get a referral there?"></textarea>
      <div class="row"><button class="btn primary" id="askGo">Search and answer</button><button class="btn" id="askMic" type="button"></button>
        <select id="askT" style="width:auto"><option value="">About no particular company</option>${S.targets.map(t => `<option value="${esc(t.id)}">About ${esc(t.company)}</option>`).join('')}</select></div><span class="faint small" id="askHint"></span></section>
    <div id="askOut" class="stack" style="gap:18px">${history.map(askCard).join('')}</div></div>`;
  attachVoice($('askMic'), $('askIn'), $('askHint'));
  $('askIn').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('askGo').click(); });
  $('askGo').onclick = () => busy($('askGo'), 'Searching the web', async () => {
    const question = $('askIn').value.trim();
    if (!question) { toast('Type a question first.', true); return; }
    const out = await post('ask', { question, targetId: $('askT').value || undefined });
    const item = { question, ...out, at: Date.now() };
    history.unshift(item);
    local.set('ask', history.slice(0, 15));
    $('askOut').insertAdjacentHTML('afterbegin', askCard(item));
    $('askIn').value = '';
  });
}
function askCard(a) {
  return `<article class="panel"><h3>${esc(a.question)}</h3><div class="prose">${md(a.answer, a.sources)}</div>
    <details><summary>${arr(a.sources).length} sources${arr(a.queries).length ? `, from ${arr(a.queries).length} searches` : ''}</summary>${arr(a.queries).length ? `<p class="faint small" style="margin-bottom:8px">Searched: ${arr(a.queries).map(q => `“${esc(q)}”`).join(', ')}</p>` : ''}${sourcesList(a.sources)}</details>
    <span class="faint tiny">${esc(ago(a.at))}</span></article>`;
}

// ---------- Sprint ----------

let viewDay = null;
let mentorDraft = '';
async function viewSprint(tab) {
  await loadSprint();
  viewDay ??= clampDay(todayIndex());
  const tabs = [['today', 'Day by day'], ['plan', 'All 30 days'], ['pipeline', 'Pipeline'], ['mentor', 'Mentor']];
  main.innerHTML = `<div class="page">
    <div class="head"><div><h1>30-day sprint</h1><p class="sub">${problems()} problems solved, ${S.sprint.refs} referral asks, ${streak()} day streak.</p></div><label class="row small muted">Started <input type="date" id="spStart" value="${esc(S.sprint.start)}" style="width:auto"></label></div>
    <div class="seg" role="group" aria-label="Sprint view">${tabs.map(([k, l]) => `<button type="button" data-sp="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
    <div id="spBody" class="stack" style="gap:20px"></div></div>`;
  main.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { location.hash = `#sprint/${b.dataset.sp}`; });
  $('spStart').onchange = e => { if (e.target.value) { S.sprint.start = e.target.value; viewDay = clampDay(todayIndex()); saveSprint(); route(); } };
  if (tab === 'plan') return sprintPlan();
  if (tab === 'pipeline') return sprintPipeline();
  if (tab === 'mentor') return sprintMentor();
  return sprintDay();
}
function sprintDay() {
  const d = DAYS[viewDay - 1];
  const w = WEEKS.find(x => viewDay >= x.from && viewDay <= x.to);
  const ci = S.sprint.checkins[iso(dayDate(viewDay))] ?? {};
  $('spBody').innerHTML = `
    <div class="row spread"><div><p class="muted small">Week ${w.n}: ${esc(w.title)}</p><h2>Day ${viewDay}: ${esc(d.t)}</h2><p class="muted small">${esc(fmtDate(dayDate(viewDay), { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
      <div class="row"><button class="btn sm" id="dPrev" ${viewDay <= 1 ? 'disabled' : ''}>Previous day</button><button class="btn sm" id="dToday">Today</button><button class="btn sm" id="dNext" ${viewDay >= 30 ? 'disabled' : ''}>Next day</button></div></div>
    <div class="callout"><p>${esc(d.note)}</p></div>
    <div class="cols"><section class="panel"><h3>Tasks</h3>${taskList(viewDay)}</section>
      <section class="panel"><h3>End-of-day check-in</h3>
        <div class="form-grid"><label class="field"><span>Energy, 1 to 5</span><input type="number" id="ciE" min="1" max="5" value="${esc(ci.energy ?? '')}"></label><label class="field"><span>Focused hours</span><input type="number" id="ciH" min="0" max="16" step="0.5" value="${esc(ci.hours ?? '')}"></label></div>
        <label class="field"><span>One win</span><input type="text" id="ciW" value="${esc(ci.win ?? '')}" placeholder="Solved 3Sum without hints"></label>
        <label class="field"><span>What got in the way</span><input type="text" id="ciB" value="${esc(ci.block ?? '')}"></label>
        <div class="row"><button class="btn primary" id="ciSave">Save check-in</button><button class="btn" id="ciAsk">Talk it through with the mentor</button></div></section></div>`;
  wireTasks($('spBody'));
  $('dPrev').onclick = () => { viewDay = clampDay(viewDay - 1); sprintDay(); };
  $('dNext').onclick = () => { viewDay = clampDay(viewDay + 1); sprintDay(); };
  $('dToday').onclick = () => { viewDay = clampDay(todayIndex()); sprintDay(); };
  const saveCi = () => { S.sprint.checkins[iso(dayDate(viewDay))] = { energy: Number($('ciE').value) || null, hours: Number($('ciH').value) || null, win: $('ciW').value.trim(), block: $('ciB').value.trim() }; saveSprint(); toast('Check-in saved.'); };
  $('ciSave').onclick = saveCi;
  $('ciAsk').onclick = () => { saveCi(); mentorDraft = `Here's my check-in for day ${viewDay}. Review my day honestly and tell me the one thing to fix tomorrow.`; location.hash = '#sprint/mentor'; };
}
function sprintPlan() {
  const ti = todayIndex();
  $('spBody').innerHTML = WEEKS.map(w => `<section class="stack"><div><h3>Week ${w.n}: ${esc(w.title)}</h3><p class="muted small">${esc(w.aim)}</p></div><div class="daygrid">${Array.from({ length: w.to - w.from + 1 }, (_, i) => w.from + i).map(n => `<button class="dcell ${n === ti ? 'today' : ''}" data-day="${n}"><span class="faint tiny">Day ${n}, ${esc(fmtDate(dayDate(n), { weekday: 'short', day: 'numeric' }))}</span><b class="small">${esc(DAYS[n - 1].t)}</b>${bar(dayPct(n) * 100, 'ok')}</button>`).join('')}</div></section>`).join('');
  $('spBody').addEventListener('click', e => { const c = e.target.closest('[data-day]'); if (c) { viewDay = Number(c.dataset.day); location.hash = '#sprint/today'; } });
}
function sprintPipeline() {
  $('spBody').innerHTML = `
    <section class="panel"><div class="row spread"><div><h3>Referral asks</h3><p class="muted small">Count every message you send to an engineer asking for a referral. Target: ${GOALS.refs}.</p></div><div class="row"><button class="btn sm" id="refM" aria-label="Remove one">−</button><span class="big-num" style="min-width:2ch;text-align:center">${S.sprint.refs}</span><button class="btn primary sm" id="refP">Add one</button></div></div></section>
    ${S.targets.length ? `<div class="tablewrap"><table><thead><tr><th>Company</th><th>Role</th><th>Stage</th><th>Interview</th><th>Ready</th></tr></thead><tbody>${S.targets.map(t => `<tr data-id="${esc(t.id)}"><td><a href="#t/${esc(t.id)}"><b>${esc(t.company)}</b></a></td><td>${esc(t.role)}</td><td><select data-f="stage">${STAGES.map(s => `<option ${s === t.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><input type="date" data-f="interviewDate" value="${esc(t.interviewDate)}"></td><td>${t.readiness ?? 0}%</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>Companies you add show up here with their stage.</p><a class="btn primary" href="#new">Add a company</a></div>'}`;
  $('refP').onclick = () => { S.sprint.refs++; saveSprint(); sprintPipeline(); };
  $('refM').onclick = () => { S.sprint.refs = Math.max(0, S.sprint.refs - 1); saveSprint(); sprintPipeline(); };
  $('spBody').querySelector('tbody')?.addEventListener('change', e => {
    const id = e.target.closest('tr').dataset.id;
    post('target-update', { id, [e.target.dataset.f]: e.target.value }).then(loadTargets).then(() => toast('Saved.')).catch(err => toast(err.message, true));
  });
}
const MENTOR_MODES = [['talk', 'Talk it through'], ['Python', 'Python quiz'], ['SQL and databases', 'SQL quiz'], ['GenAI and LLM systems', 'GenAI quiz'], ['system design', 'System design'], ['behavioural questions (STAR)', 'Behavioural'], ['HR round and salary negotiation', 'HR and salary']];
function sprintContext() {
  const ti = clampDay(todayIndex());
  const d = DAYS[ti - 1];
  const recent = Object.entries(S.sprint.checkins).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4).map(([k, c]) => `${k}: energy ${c.energy ?? '?'}/5, ${c.hours ?? '?'}h, win: ${c.win || '-'}, blocker: ${c.block || '-'}`).join('\n');
  return `Sprint day ${todayIndex()} of 30 ("${d.t}"). Today's tasks: ${d.k.map((t, i) => `[${S.sprint.done[tid(ti, i)] ? 'x' : ' '}] ${t[1]}`).join('; ')}. Problems ${problems()}/${GOALS.problems}, referral asks ${S.sprint.refs}/${GOALS.refs}, streak ${streak()}. Recent check-ins:\n${recent || 'none'}`;
}
function sprintMentor() {
  const chat = local.get('mentor', { mode: 'talk', turns: [] });
  $('spBody').innerHTML = `<section class="panel">
    <div class="seg" role="group" aria-label="Mentor mode">${MENTOR_MODES.map(([k, l]) => `<button type="button" data-mode="${esc(k)}" aria-pressed="${chat.mode === k}">${l}</button>`).join('')}</div>
    <div class="chat" id="mChat">${chat.turns.length ? chat.turns.map(x => `<div class="msg ${x.role === 'user' ? 'me' : 'ai'}">${esc(x.content)}</div>`).join('') : `<div class="msg ai">${chat.mode === 'talk' ? 'I can see your plan, companies, profile and check-ins. How is it going?' : 'Type "start" for the first question.'}</div>`}</div>
    <div class="composer"><textarea id="mIn" rows="2" placeholder="Message your mentor">${esc(mentorDraft)}</textarea><button class="btn" id="mMic" type="button"></button><button class="btn primary" id="mSend">Send</button></div>
    <div class="row spread"><span class="faint small" id="mHint"></span><button class="btn quiet sm" id="mReset">Start over</button></div></section>`;
  mentorDraft = '';
  const box = $('mChat'); box.scrollTop = box.scrollHeight;
  attachVoice($('mMic'), $('mIn'), $('mHint'));
  $('spBody').querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { local.set('mentor', { mode: b.dataset.mode, turns: [] }); sprintMentor(); });
  $('mReset').onclick = () => { local.set('mentor', { mode: chat.mode, turns: [] }); sprintMentor(); };
  const send = () => busy($('mSend'), 'Thinking', async () => {
    const text = $('mIn').value.trim();
    if (!text) return;
    chat.turns.push({ role: 'user', content: text });
    $('mIn').value = '';
    box.insertAdjacentHTML('beforeend', `<div class="msg me">${esc(text)}</div><div class="msg ai"><span class="spinner"></span></div>`);
    box.scrollTop = box.scrollHeight;
    try { const out = await post('mentor', { history: chat.turns, context: sprintContext(), mode: chat.mode }); chat.turns.push({ role: 'assistant', content: out.text }); }
    finally { local.set('mentor', { mode: chat.mode, turns: chat.turns.slice(-30) }); sprintMentor(); }
  });
  $('mSend').onclick = send;
  $('mIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  if ($('mIn').value) send();
}

// ---------- Profile ----------

async function viewProfile() {
  const p = await loadProfile();
  const counts = { defend: 0, unsure: 0, dont: 0 };
  arr(p.facts).forEach(f => counts[f.status]++);
  const fresh = !arr(p.facts).length;
  main.innerHTML = `<div class="page">
    <div><h1>My profile</h1><p class="sub">Everything the app may say about you. Mark a fact as yours to defend only if you can talk about it for ten minutes.</p></div>
    <section class="${fresh ? 'next' : 'panel'}"><div class="what stack" style="gap:8px;flex:1"><h3>${fresh ? 'Build your profile from your resumes' : 'Rebuild from your resumes'}</h3><p class="muted small">Reads every resume plus your interview guide. Big claims that appear only once are marked unsure. Your pay and notice period are kept.${fresh ? '' : ' Rebuilding replaces your projects and facts, so hand edits are lost.'}</p>
      <div class="row"><input type="url" id="pGuide" value="https://deepsinterview.vercel.app/" aria-label="Interview guide link" style="flex:1 1 260px"><button class="btn ${fresh ? 'signal' : ''}" id="pSeed">${fresh ? 'Build my profile' : 'Rebuild'}</button></div></div></section>
    ${fresh ? '' : `<section class="panel"><h3>Basics</h3><div class="form-grid">${[['name', 'Name'], ['headline', 'Headline'], ['years', 'Experience'], ['location', 'City'], ['currentCtc', 'Current pay (CTC)'], ['targetCtc', 'Target pay'], ['noticePeriod', 'Notice period']].map(([k, l]) => `<label class="field"><span>${l}</span><input type="text" data-k="${k}" value="${esc(p[k])}"></label>`).join('')}</div>
      <label class="field"><span>Summary</span><textarea data-k="summary" rows="3">${esc(p.summary)}</textarea></label>
      <div class="form-grid"><label class="field"><span>Skills you can defend</span><textarea id="pSkD" rows="2">${esc(arr(p.skills?.defend).join(', '))}</textarea><small>Separate with commas.</small></label><label class="field"><span>Still learning</span><textarea id="pSkL" rows="2">${esc(arr(p.skills?.learning).join(', '))}</textarea></label></div></section>
    <section class="panel"><div class="section-title"><h3>Projects</h3><button class="btn sm" id="pAddProj">Add a project</button></div><div id="pProjects" class="stack">${p.projects.map(x => projEditor(x)).join('')}</div></section>
    <section class="panel"><div class="section-title"><h3>Facts</h3><button class="btn sm" id="pAddFact">Add a fact</button></div>
      <div class="row"><span class="chip defend">${counts.defend} I can defend</span><span class="chip unsure">${counts.unsure} unsure</span><span class="chip dont">${counts.dont} don't claim</span></div>
      <div id="pFacts">${p.facts.map(factEditor).join('')}</div></section>
    <div class="sticky-save"><button class="btn primary" id="pSave">Save profile</button><span class="faint small">${p.updatedAt ? `Saved ${esc(ago(Date.parse(p.updatedAt)))}` : ''}</span></div>`}</div>`;
  $('pSeed').onclick = () => busy($('pSeed'), 'Reading your resumes, about a minute', async () => { S.profile = await post('profile-seed', { guideUrl: $('pGuide').value.trim() || undefined }); toast('Profile built. Check the facts marked unsure.'); route(); });
  if (fresh) return;
  $('pAddProj').onclick = () => $('pProjects').insertAdjacentHTML('afterbegin', projEditor({ id: '', name: '', stack: [], problem: '', what: '', impact: '', story: '' }, true));
  $('pAddFact').onclick = () => $('pFacts').insertAdjacentHTML('afterbegin', factEditor({ id: '', text: '', area: 'other', status: 'defend' }));
  $('pFacts').addEventListener('click', e => {
    const s = e.target.closest('[data-st]');
    if (s) { s.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === s))); return; }
    if (e.target.closest('[data-del]')) e.target.closest('.fact').remove();
  });
  $('pProjects').addEventListener('click', e => { if (e.target.closest('[data-delp]')) e.target.closest('.proj').remove(); });
  $('pSave').onclick = () => busy($('pSave'), 'Saving', async () => {
    const body = {};
    main.querySelectorAll('[data-k]').forEach(el => { body[el.dataset.k] = el.value.trim(); });
    body.skills = { defend: $('pSkD').value.split(',').map(s => s.trim()).filter(Boolean), learning: $('pSkL').value.split(',').map(s => s.trim()).filter(Boolean) };
    body.projects = [...main.querySelectorAll('.proj')].map(el => { const v = k => el.querySelector(`[data-pk="${k}"]`).value.trim(); return { id: el.dataset.id, name: v('name'), stack: v('stack').split(',').map(s => s.trim()).filter(Boolean), problem: v('problem'), what: v('what'), impact: v('impact'), story: v('story') }; });
    body.facts = [...main.querySelectorAll('.fact')].map(el => ({ id: el.dataset.id, text: el.querySelector('textarea').value.trim(), area: el.dataset.area, project: el.dataset.project, status: el.querySelector('[aria-pressed="true"]')?.dataset.st ?? 'unsure' }));
    S.profile = await post('profile', body);
    toast('Profile saved.');
    route();
  });
}
function projEditor(x, open = false) {
  const f = (k, l, rows = 2) => `<label class="field"><span>${l}</span><textarea data-pk="${k}" rows="${rows}">${esc(k === 'stack' ? arr(x.stack).join(', ') : x[k])}</textarea></label>`;
  return `<details class="proj" data-id="${esc(x.id)}" ${open ? 'open' : ''} style="border-top:1px solid var(--line);padding-top:12px"><summary>${esc(x.name || 'New project')}</summary><div class="stack">
    <label class="field"><span>Name</span><input type="text" data-pk="name" value="${esc(x.name)}"></label>${f('stack', 'Stack, separated by commas', 1)}${f('problem', 'The problem')}${f('what', 'What you did', 3)}${f('impact', 'Impact, real numbers only')}${f('story', 'The 2-minute story', 6)}
    <button class="btn quiet danger sm" data-delp style="align-self:flex-start">Remove project</button></div></details>`;
}
function factEditor(f) {
  return `<div class="fact" data-id="${esc(f.id)}" data-area="${esc(f.area)}" data-project="${esc(f.project ?? '')}"><textarea rows="1" aria-label="Fact">${esc(f.text)}</textarea>
    <span class="seg">${[['defend', 'I can defend'], ['unsure', 'Unsure'], ['dont', "Don't claim"]].map(([k, l]) => `<button type="button" class="${k}" data-st="${k}" aria-pressed="${f.status === k}">${l}</button>`).join('')}</span>
    <button class="btn quiet sm" data-del aria-label="Delete fact">✕</button></div>`;
}

// ---------- Offers ----------

function viewOffers() {
  const st = local.get('offers', { rows: [{}], result: null });
  const cols = [['company', 'Company'], ['role', 'Role'], ['fixedLpa', 'Fixed (LPA)'], ['variableLpa', 'Variable (LPA)'], ['joiningBonus', 'Joining bonus'], ['location', 'City or mode'], ['joining', 'Joining date'], ['notes', 'Notes: bond, benefits']];
  const r = st.result;
  main.innerHTML = `<div class="page">
    <div><h1>Offers</h1><p class="sub">Compare offers and get the exact words for negotiating. Pay you researched for a company is used as evidence.</p></div>
    <div class="tablewrap"><table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody id="ofRows">${st.rows.map((row, i) => `<tr>${cols.map(([k]) => `<td><input type="text" data-k="${k}" value="${esc(row[k])}" style="min-width:${k === 'notes' ? 180 : 110}px" aria-label="${esc(k)}"></td>`).join('')}<td><button class="btn quiet sm" data-rm="${i}" aria-label="Remove offer">✕</button></td></tr>`).join('')}</tbody></table></div>
    <div class="row"><button class="btn" id="ofAdd">Add an offer</button><button class="btn primary" id="ofGo">Compare and plan the negotiation</button></div>
    ${r ? `<section class="panel"><h2>${esc(r.recommendation)}</h2></section>
      <div class="cols">${arr(r.comparison).map(c => `<section class="panel"><h3>${esc(c.company)}</h3><div class="big-num">${esc(c.fixedLpa)} LPA</div><p class="muted small">${esc(c.inHandMonthlyApprox)}</p><div><b>Good</b><ul class="list">${arr(c.pros).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div><div><b>Watch</b><ul class="list">${arr(c.cons).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></section>`).join('')}</div>
      <section class="panel"><h3>How to negotiate</h3>${arr(r.negotiate).map(n => `<div class="stack" style="gap:8px"><b>${esc(n.company)}: ${esc(n.ask)}</b><div class="callout"><p>${esc(n.script)}</p></div></div>`).join('')}</section>
      ${arr(r.watchOuts).length ? `<div class="callout warn"><h3>Check before you sign</h3><ul class="list">${arr(r.watchOuts).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}` : ''}</div>`;
  const read = () => { st.rows = [...$('ofRows').children].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value.trim()]))); local.set('offers', st); };
  $('ofRows').addEventListener('input', read);
  $('ofRows').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { read(); st.rows.splice(Number(b.dataset.rm), 1); if (!st.rows.length) st.rows.push({}); local.set('offers', st); viewOffers(); } });
  $('ofAdd').onclick = () => { read(); st.rows.push({}); local.set('offers', st); viewOffers(); };
  $('ofGo').onclick = () => busy($('ofGo'), 'Comparing', async () => {
    read();
    const offers = st.rows.filter(x => x.company);
    if (!offers.length) { toast('Add at least one offer with a company name.', true); return; }
    st.result = await post('offers', { offers });
    local.set('offers', st); viewOffers();
  });
}

// ---------- AI status ----------

async function viewSettings() {
  const usedKey = { rpm: 'minuteRequests', rpd: 'dayRequests', tpm: 'minuteTokens', tpd: 'dayTokens', perMonth: 'monthRequests' };
  const gauge = (b, k, label) => {
    if (!b.limits[k]) return '';
    const used = b.used[usedKey[k]], lim = b.limits[k], pct = Math.round((used / lim) * 100);
    return `<span>${label}</span><span class="faint">${used.toLocaleString('en-IN')} of ${lim.toLocaleString('en-IN')} used</span>${bar(pct, 'use')}`;
  };
  const stateText = b => ({ ready: 'Ready', cooling: `Back in ${dur(b.readyInMs)}`, exhausted: `Back in ${dur(b.readyInMs)}`, blocked: 'Blocked' }[b.state]);
  const render = async () => {
    if (!location.hash.startsWith('#settings')) return;
    const st = await get('status');
    S.status = st;
    const models = arr(st.budgets).filter(b => !b.id.startsWith('search:') && !b.id.includes('whisper'));
    const services = arr(st.budgets).filter(b => b.id.startsWith('search:') || b.id.includes('whisper'));
    const card = b => `<article class="model ${esc(b.state)}"><div class="row spread"><h3>${esc(b.label.replace(' · ', ': '))}</h3><span class="chip ${esc(b.state)}">${esc(stateText(b))}</span></div>
      ${b.blocked ? `<p class="small" style="color:var(--bad)">${esc(b.blocked.reason)}</p>` : b.state === 'exhausted' ? '<p class="small muted">Free quota for today is used up. It refills automatically.</p>' : b.cooldownReason ? `<p class="small muted">${esc(b.cooldownReason.slice(0, 150))}</p>` : ''}
      <div class="gauge">${gauge(b, 'rpm', 'Requests this minute')}${gauge(b, 'tpm', 'Tokens this minute')}${gauge(b, 'rpd', 'Requests today')}${gauge(b, 'tpd', 'Tokens today')}${gauge(b, 'perMonth', 'This month')}</div>
      ${b.header ? `<p class="small"><b>Provider reports</b> ${b.header.remainingRequests ?? '?'} of ${b.header.limitRequests ?? '?'} requests and ${b.header.remainingTokens ?? '?'} of ${b.header.limitTokens ?? '?'} tokens left <span class="faint">(${esc(ago(b.header.at))})</span></p>` : ''}
      <p class="faint small">${b.lastOkAt ? `Last answered ${esc(ago(b.lastOkAt))}${b.lastLatencyMs ? ` in ${dur(b.lastLatencyMs)}` : ''}` : 'Not used yet'}. ${b.totals.requests} calls, ${b.totals.errors} errors.</p>
      ${b.lastError ? `<details><summary>Last error</summary><p class="small muted">${esc(ago(b.lastError.at))}: ${esc(b.lastError.message)}</p></details>` : ''}
      ${b.id.startsWith('search:') || b.id.includes('whisper') ? '' : `<div class="row"><button class="btn sm" data-probe="${esc(b.id)}">Test now</button></div>`}</article>`;
    $('setBody').innerHTML = `
      <section class="stack"><h2>Models</h2><div class="models">${models.map(card).join('')}</div></section>
      <section class="stack"><h2>Search and voice</h2><div class="models">${services.map(card).join('')}</div><p class="muted small">Web search tries Google (through Gemini, about 18 a day), then Groq's browser search (uses the gpt-oss budgets above), then Tavily if you add a key. Searches are saved for 7 days.</p></section>
      <section class="panel"><h3>Which model answers what</h3><div class="cols">${Object.entries(st.routes).map(([task, ids]) => `<div><b>${esc({ fast: 'Conversation: mocks, mentor, explain', smart: 'Careful work: research, prep kits, fit', light: 'Short writing: messages' }[task] ?? task)}</b><ol class="list small">${ids.map(id => `<li>${esc(id)}</li>`).join('')}</ol></div>`).join('')}</div><p class="muted small">The first model with budget left answers, and a rate-limited model is skipped until it recovers. Limits are set in lib/llm-config.mjs, and the provider's own numbers correct them while running.</p></section>
      ${!st.searchConfigured.tavily || models.some(b => b.id.startsWith('mistral') && b.state === 'blocked') ? `<div class="callout warn"><h3>Get more free capacity</h3><ul class="list">${models.some(b => b.id.startsWith('mistral') && b.state === 'blocked') ? '<li>Mistral is blocked. Turn on the free Experiment plan at console.mistral.ai under Admin, then Billing, and press Test now.</li>' : ''}${st.searchConfigured.tavily ? '' : '<li>Add a free Tavily key (1,000 searches a month at tavily.com) as TAVILY_API_KEY for deeper research.</li>'}</ul></div>` : ''}`;
  };
  main.innerHTML = `<div class="page"><div class="head"><div><h1>AI status</h1><p class="sub">Every free model and service, its limits, and what's left. Updates every 10 seconds.</p></div><button class="btn" id="setRefresh">Refresh</button></div><div id="setBody" class="stack" style="gap:28px"><p class="muted"><span class="spinner"></span> Loading…</p></div></div>`;
  $('setRefresh').onclick = render;
  $('setBody').addEventListener('click', e => {
    const b = e.target.closest('[data-probe]');
    if (b) busy(b, 'Testing', async () => { const r = await post('probe', { id: b.dataset.probe }); toast(r.ok ? `Answered in ${dur(r.latencyMs)}.` : r.error, !r.ok); await render(); refreshStatus(); });
  });
  await render();
  const timer = setInterval(render, 10_000);
  teardown = () => clearInterval(timer);
}

// ---------- More (phones) ----------

function viewMore() {
  main.innerHTML = `<div class="page"><h1>More</h1><nav class="panel"><div class="companies">${[['#sprint', '30-day sprint', 'Daily tasks, plan, pipeline and mentor'], ['#profile', 'My profile', 'What the app may say about you'], ['#offers', 'Offers', 'Compare offers and negotiate'], ['#settings', 'AI status', 'Limits and status of every model'], ['/', 'Resume Desk', 'Edit your resumes']].map(([h, t, d]) => `<a class="company-row" style="grid-template-columns:minmax(0,1fr)" href="${h}"><span class="name"><b>${t}</b><span class="muted small">${d}</span></span></a>`).join('')}</div></nav></div>`;
}

// ---------- Start ----------

(async () => {
  const probe = await fetch('/api/prep/sections', { cache: 'no-store' }).catch(() => null);
  if (probe && probe.status === 401) { location.href = '/'; return; }
  await Promise.all([loadTargets(), loadProfile()]);
  refreshStatus();
  setInterval(refreshStatus, 60_000);
  route();
})();
