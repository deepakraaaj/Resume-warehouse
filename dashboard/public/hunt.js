// Job Hunt: sprint, research, prep, mock interviews, explain trainer, offers and AI limits.
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
const ago = t => { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const dur = ms => { if (ms == null) return '-'; const s = Math.ceil(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };
const store = { get(k, f) { try { const v = localStorage.getItem(`hunt-${k}`); return v ? JSON.parse(v) : f; } catch { return f; } }, set(k, v) { try { localStorage.setItem(`hunt-${k}`, JSON.stringify(v)); } catch { /* optional */ } } };

let toastTimer;
function toast(text, fail = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast${fail ? ' fail' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), fail ? 6000 : 2600);
}

async function call(method, route, payload) {
  const url = method === 'GET' ? `/api/prep/${route}${payload ? `?${new URLSearchParams(payload)}` : ''}` : `/api/prep/${route}`;
  const res = await fetch(url, method === 'GET' ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/'; throw new Error('Sign in first.'); }
  if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
  refreshQuotaSoon();
  return data;
}
const get = (r, q) => call('GET', r, q);
const post = (r, b) => call('POST', r, b);

// Runs an async action with a busy button; shows errors as a toast.
async function busy(button, label, fn) {
  const old = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = `<span class="spinner"></span> ${esc(label)}`; }
  try { return await fn(); }
  catch (err) { toast(err.message, true); return undefined; }
  finally { if (button?.isConnected) { button.disabled = false; button.innerHTML = old; } }
}

// Light markdown: bold, bullets, paragraphs, and [S#] citations linked to their sources.
function md(text, sources = []) {
  const byN = new Map(arr(sources).map(s => [String(s.n), s]));
  const cite = s => s.replace(/\[((?:S?\d+\s*,?\s*)+)\]/g, (m, ids) => ids.split(',').map(x => x.trim().replace(/^S/, '')).filter(Boolean).map(n => {
    const src = byN.get(n);
    return src && safeUrl(src.url) ? `<a class="ref" href="${esc(src.url)}" target="_blank" rel="noopener" title="${esc(src.title)}">S${esc(n)}</a>` : `<span class="ref">S${esc(n)}</span>`;
  }).join(''));
  const lines = esc(text).split('\n');
  let html = '', list = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)/);
    if (bullet) { if (!list) { html += '<ul>'; list = true; } html += `<li>${bullet[1]}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (line) html += `<p>${line.replace(/^#+\s*/, '')}</p>`;
  }
  if (list) html += '</ul>';
  return cite(html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'));
}
const refs = (list, sources) => md(arr(list).map(r => `[${String(r).replace(/[[\]]/g, '')}]`).join(''), sources);
const pillFor = label => `<span class="pill ${esc(label)}">${esc(label || 'unverified')}</span>`;

function sourcesList(sources) {
  if (!arr(sources).length) return '<p class="muted small-text">No sources.</p>';
  return `<ol class="sources">${arr(sources).map(s => `<li><span class="muted">S${s.n}</span><span>${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.site)}</a>` : esc(s.title)} <span class="muted">· ${esc(s.site || '')}${s.date ? ` · ${esc(s.date)}` : ''}</span></span></li>`).join('')}</ol>`;
}

// ---------- Voice ----------

// A mic button that records, sends the audio to Whisper on the server, and appends the text to a textarea.
// Falls back to the browser's own speech recognition when recording or transcription is unavailable.
function attachVoice(button, textarea, statusEl) {
  let rec = null, chunks = [], timer = null, started = 0, recog = null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const setStatus = t => { if (statusEl) statusEl.textContent = t; };
  const append = text => { textarea.value = `${textarea.value.trim()} ${text}`.trim(); textarea.dispatchEvent(new Event('input')); };
  const stopUi = () => { clearInterval(timer); button.classList.remove('rec'); button.textContent = '🎙 Speak'; };
  function browserFallback() {
    if (!SR) { setStatus('Voice input is not available in this browser. Type instead.'); return; }
    recog = new SR();
    recog.lang = 'en-IN';
    recog.continuous = true;
    recog.interimResults = false;
    recog.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) append(e.results[i][0].transcript); };
    recog.onend = () => { stopUi(); setStatus(''); recog = null; };
    recog.onerror = () => { stopUi(); setStatus('Browser voice input stopped.'); };
    recog.start();
    button.classList.add('rec');
    button.textContent = '■ Stop';
    setStatus('Listening (browser voice)…');
  }
  button.addEventListener('click', async () => {
    if (recog) { recog.stop(); return; }
    if (rec?.state === 'recording') { rec.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return browserFallback();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setStatus('Microphone blocked. Allow it in the browser, or type.'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) ?? '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      stopUi();
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      setStatus('Transcribing…');
      try {
        const b64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(blob); });
        const { text } = await post('transcribe', { audio: b64, mime: blob.type });
        append(text);
        setStatus('');
      } catch (err) {
        setStatus(`${err.message} Trying browser voice instead.`);
        browserFallback();
      }
    };
    rec.start(1000);
    started = Date.now();
    button.classList.add('rec');
    button.textContent = '■ Stop';
    timer = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      setStatus(`Recording ${Math.floor(s / 60)}:${pad(s % 60)} (max 3:00)`);
      if (s >= 180) rec.stop();
    }, 500);
  });
}

// ---------- App state ----------

const S = { targets: [], profile: null, status: null, sprint: null, resumes: null, sections: {} };

async function loadTargets() {
  S.targets = await get('targets').catch(err => { toast(err.message, true); return []; });
  renderTargetList();
}

function renderTargetList() {
  const list = $('targetList');
  const cur = location.hash.match(/^#target\/([\w-]+)/)?.[1];
  list.innerHTML = S.targets.length ? S.targets.map(t => `<button type="button" data-target="${esc(t.id)}" ${t.id === cur ? 'aria-current="page"' : ''}><span>${esc(t.company)}</span><span class="t-meta">${esc(t.role)} · ${esc(t.stage)}${t.interviewDate ? ` · ${esc(t.interviewDate)}` : ''}</span></button>`).join('') : '<p class="muted small-text" style="padding:6px 10px">No targets yet. Add the company you\'re applying to.</p>';
}
$('targetList').addEventListener('click', e => { const b = e.target.closest('[data-target]'); if (b) location.hash = `#target/${b.dataset.target}/research`; });
$('newTarget').addEventListener('click', () => { location.hash = '#new'; });
document.querySelectorAll('.nav-list [data-view]').forEach(b => b.addEventListener('click', () => { location.hash = `#${b.dataset.view}`; }));
$('quota').addEventListener('click', () => { location.hash = '#settings'; });

// ---------- Router ----------

let teardown = null;
async function route() {
  teardown?.();
  teardown = null;
  const [view, id, tab] = (location.hash.slice(1) || 'sprint').split('/');
  document.querySelectorAll('.nav-list [data-view]').forEach(b => b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  renderTargetList();
  main.scrollTop = 0;
  try {
    if (view === 'target' && id) await viewTarget(id, tab || 'research');
    else if (view === 'new') viewNewTarget();
    else if (view === 'ask') viewAsk();
    else if (view === 'profile') await viewProfile();
    else if (view === 'offers') viewOffers();
    else if (view === 'settings') await viewSettings();
    else await viewSprint(id || 'today');
  } catch (err) {
    main.innerHTML = `<div class="page"><div class="warnbox">${esc(err.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- Quota footer ----------

let quotaTimer;
async function refreshQuota() {
  try {
    S.status = await (await fetch('/api/prep/status', { cache: 'no-store' })).json();
    const b = arr(S.status.budgets);
    const llm = b.filter(x => !x.id.startsWith('search:') && !x.id.includes('whisper'));
    const ready = llm.filter(x => x.state === 'ready').length;
    const google = b.find(x => x.id === 'search:gemini-grounding');
    const tavily = b.find(x => x.id === 'search:tavily');
    const groqOk = b.some(x => /^groq:openai\/gpt-oss/.test(x.id) && x.state !== 'blocked' && x.state !== 'exhausted');
    const left = x => Math.max(0, (x.limits.rpd ?? x.limits.perMonth ?? 0) - (x.limits.rpd ? x.used.dayRequests : x.used.monthRequests));
    const chip = (name, ok, extra = '') => `<span class="pill ${ok ? 'ready' : 'exhausted'}">${name} ${ok ? '✓' : '✕'}${extra}</span>`;
    $('quota').innerHTML = `<span class="pill ${ready ? 'ready' : 'fail'}">${ready}/${llm.length} models ready</span><span class="label" style="align-self:center">Web search</span>${google ? chip('Google', google.state === 'ready', google.state === 'ready' ? ` ${left(google)}` : '') : ''}${chip('Groq', groqOk)}${tavily ? chip('Tavily', tavily.state === 'ready', ` ${left(tavily)}`) : ''}`;
  } catch { $('quota').textContent = 'AI status unavailable'; }
}
function refreshQuotaSoon() { clearTimeout(quotaTimer); quotaTimer = setTimeout(refreshQuota, 1500); }

// ---------- Sprint ----------

const STAGES = ['Researching', 'Preparing', 'Applied', 'Recruiter call', 'Online test', 'Tech round', 'Manager round', 'HR round', 'Offer', 'Joined', 'Rejected', 'Ghosted'];
const INTERVIEW_STAGES = ['Online test', 'Tech round', 'Manager round', 'HR round', 'Offer', 'Joined'];
const APPLIED_STAGES = ['Applied', 'Recruiter call', ...INTERVIEW_STAGES, 'Rejected', 'Ghosted'];
const blankSprint = () => ({ v: 1, start: START_DEFAULT, done: {}, checkins: {}, refs: 0, wins: [] });

let sprintSave;
function saveSprint() {
  clearTimeout(sprintSave);
  sprintSave = setTimeout(() => post('sprint', { state: S.sprint }).catch(err => toast(`Couldn't save: ${err.message}`, true)), 600);
}
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

let viewDay = null;
async function viewSprint(tab) {
  if (!S.sprint) S.sprint = { ...blankSprint(), ...((await get('sprint').catch(() => null)) ?? {}) };
  viewDay ??= clampDay(todayIndex());
  const applied = S.targets.filter(t => APPLIED_STAGES.includes(t.stage)).length;
  const interviews = S.targets.filter(t => INTERVIEW_STAGES.includes(t.stage)).length;
  const ti = todayIndex();
  const tiles = [
    ['Day', ti < 1 ? `starts ${fmtDate(parseDate(S.sprint.start), { day: 'numeric', month: 'short' })}` : ti > 30 ? 'done' : `${ti}/30`],
    ['Problems', `${problems()}/${GOALS.problems}`], ['Applications', `${applied}/${GOALS.apps}`],
    ['Referral asks', `${S.sprint.refs}/${GOALS.refs}`], ['Interviews', `${interviews}/${GOALS.interviews}`], ['Streak', `${streak()} days`],
  ];
  const tabs = [['today', 'Today'], ['plan', '30-day plan'], ['pipeline', 'Pipeline'], ['mentor', 'Mentor']];
  main.innerHTML = `<div class="page">
    <div class="row between"><h2>Sprint</h2><label class="row small-text muted">Start <input type="date" id="spStart" value="${esc(S.sprint.start)}" style="width:auto"></label></div>
    <div class="meters">${tiles.map(([l, v]) => `<div class="mtile"><span class="label">${l}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-sp="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>
    <div id="spBody" class="stack" style="gap:18px"></div></div>`;
  main.querySelectorAll('[data-sp]').forEach(b => b.addEventListener('click', () => { location.hash = `#sprint/${b.dataset.sp}`; }));
  $('spStart').addEventListener('change', e => { if (e.target.value) { S.sprint.start = e.target.value; viewDay = clampDay(todayIndex()); saveSprint(); route(); } });
  if (tab === 'plan') return sprintPlan();
  if (tab === 'pipeline') return sprintPipeline();
  if (tab === 'mentor') return sprintMentor();
  return sprintToday();
}

function sprintToday() {
  const d = DAYS[viewDay - 1];
  const w = WEEKS.find(x => viewDay >= x.from && viewDay <= x.to);
  const ci = S.sprint.checkins[iso(dayDate(viewDay))] ?? {};
  const total = d.k.reduce((s, t) => s + t[2], 0);
  $('spBody').innerHTML = `
    <div class="row between"><div class="stack" style="gap:2px"><span class="label">Week ${w.n} · ${esc(w.title)}</span><h3 style="font-size:20px">Day ${viewDay}. ${esc(d.t)}</h3><span class="muted small-text">${esc(fmtDate(dayDate(viewDay), { weekday: 'long', day: 'numeric', month: 'long' }))}${viewDay === todayIndex() ? ' · today' : ''}</span></div>
      <div class="row"><button class="btn small" id="dPrev" ${viewDay <= 1 ? 'disabled' : ''}>← Prev</button><button class="btn small" id="dToday">Today</button><button class="btn small" id="dNext" ${viewDay >= 30 ? 'disabled' : ''}>Next →</button></div></div>
    <div class="note"><span class="label">Mentor</span><p>${esc(d.note)}</p></div>
    <div class="grid2" style="align-items:start">
      <div class="card"><div class="row between"><h3>Today's work</h3><span class="mins">${(total / 60).toFixed(1)} h planned</span></div>
        <div class="progress"><i style="width:${Math.round(dayPct(viewDay) * 100)}%"></i></div>
        <ul class="tasks">${d.k.map((t, i) => { const id = tid(viewDay, i), on = Boolean(S.sprint.done[id]); return `<li class="task ${on ? 'done' : ''}"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><div><label for="${id}"><span class="cat ${t[0]}">${CAT_NAME[t[0]]}</span>${esc(t[1])}</label>${t[4] ? `<div class="muted small-text">${esc(t[4])}</div>` : ''}</div><span class="mins">${t[2] ? `${t[2]}m` : ''}</span></li>`; }).join('')}</ul></div>
      <div class="card"><h3>End-of-day check-in</h3>
        <label class="field"><span>Energy (1-5)</span><input type="number" id="ciEnergy" min="1" max="5" value="${esc(ci.energy ?? '')}"></label>
        <label class="field"><span>Hours of focused work</span><input type="number" id="ciHours" min="0" max="16" step="0.5" value="${esc(ci.hours ?? '')}"></label>
        <label class="field"><span>One win</span><input type="text" id="ciWin" value="${esc(ci.win ?? '')}" placeholder="Solved 3Sum without hints"></label>
        <label class="field"><span>What blocked you</span><input type="text" id="ciBlock" value="${esc(ci.block ?? '')}"></label>
        <div class="row"><button class="btn primary" id="ciSave">Save</button><button class="btn" id="ciAsk">Ask mentor about my day</button></div></div>
    </div>`;
  $('dPrev').onclick = () => { viewDay = clampDay(viewDay - 1); sprintToday(); };
  $('dNext').onclick = () => { viewDay = clampDay(viewDay + 1); sprintToday(); };
  $('dToday').onclick = () => { viewDay = clampDay(todayIndex()); sprintToday(); };
  $('spBody').querySelector('.tasks').addEventListener('change', e => {
    if (e.target.checked) S.sprint.done[e.target.id] = true; else delete S.sprint.done[e.target.id];
    saveSprint(); route();
  });
  const saveCi = () => {
    S.sprint.checkins[iso(dayDate(viewDay))] = { energy: Number($('ciEnergy').value) || null, hours: Number($('ciHours').value) || null, win: $('ciWin').value.trim(), block: $('ciBlock').value.trim() };
    saveSprint(); toast('Check-in saved.');
  };
  $('ciSave').onclick = saveCi;
  $('ciAsk').onclick = () => { saveCi(); mentorDraft = `Here's my check-in for Day ${viewDay}. Review my day honestly and tell me the one thing to fix tomorrow.`; location.hash = '#sprint/mentor'; };
}

function sprintPlan() {
  const ti = todayIndex();
  $('spBody').innerHTML = WEEKS.map(w => `<div class="stack"><div class="row"><h3>Week ${w.n} · ${esc(w.title)}</h3><span class="muted small-text">${esc(w.aim)}</span></div><div class="daygrid">${Array.from({ length: w.to - w.from + 1 }, (_, i) => w.from + i).map(n => `<button class="dcell ${n === ti ? 'today' : ''}" data-day="${n}"><span class="muted small-text">Day ${n} · ${esc(fmtDate(dayDate(n), { weekday: 'short', day: 'numeric' }))}</span><b class="small-text">${esc(DAYS[n - 1].t)}</b><span class="p"><i style="width:${Math.round(dayPct(n) * 100)}%"></i></span></button>`).join('')}</div></div>`).join('');
  $('spBody').addEventListener('click', e => { const c = e.target.closest('[data-day]'); if (c) { viewDay = Number(c.dataset.day); location.hash = '#sprint/today'; } });
}

function sprintPipeline() {
  $('spBody').innerHTML = `
    <div class="row between"><p class="muted">Every target is a row here. Move the stage as things happen.</p>
      <div class="row"><span class="label">Referral asks</span><button class="btn small" id="refM">−</button><b class="num" style="font-size:20px;min-width:2ch;text-align:center">${S.sprint.refs}</b><button class="btn small primary" id="refP">+1</button></div></div>
    ${S.targets.length ? `<div class="tablewrap"><table><thead><tr><th>Company</th><th>Role</th><th>Stage</th><th>Interview</th><th>Fit</th><th></th></tr></thead><tbody>${S.targets.map(t => `<tr data-id="${esc(t.id)}"><td><b>${esc(t.company)}</b></td><td>${esc(t.role)}</td><td><select data-f="stage">${STAGES.map(s => `<option ${s === t.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><input type="date" data-f="interviewDate" value="${esc(t.interviewDate)}"></td><td class="num">${t.fit ?? '-'}</td><td><a href="#target/${esc(t.id)}/research">Open</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No targets yet. Click <b>+ New</b> in the left panel and add the first company you\'re applying to.</div>'}`;
  $('refP').onclick = () => { S.sprint.refs++; saveSprint(); route(); };
  $('refM').onclick = () => { S.sprint.refs = Math.max(0, S.sprint.refs - 1); saveSprint(); route(); };
  $('spBody').querySelector('tbody')?.addEventListener('change', async e => {
    const id = e.target.closest('tr').dataset.id;
    await busy(null, '', async () => { await post('target-update', { id, [e.target.dataset.f]: e.target.value }); await loadTargets(); toast('Updated.'); });
  });
}

let mentorDraft = '';
const MENTOR_MODES = [['talk', 'Talk to me'], ['Python', 'Mock: Python'], ['SQL and databases', 'Mock: SQL'], ['GenAI and LLM systems', 'Mock: GenAI'], ['system design', 'Mock: System design'], ['behavioural questions (STAR)', 'Mock: Behavioural'], ['HR round and salary negotiation', 'Mock: HR & salary']];
function sprintContext() {
  const ti = clampDay(todayIndex());
  const d = DAYS[ti - 1];
  const recent = Object.entries(S.sprint.checkins).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4).map(([k, c]) => `${k}: energy ${c.energy ?? '?'}/5, ${c.hours ?? '?'}h, win: ${c.win || '-'}, blocker: ${c.block || '-'}`).join('\n');
  return `Sprint day ${todayIndex()} of 30 ("${d.t}"). Today's tasks: ${d.k.map((t, i) => `[${S.sprint.done[tid(ti, i)] ? 'x' : ' '}] ${t[1]}`).join('; ')}. Problems ${problems()}/${GOALS.problems}, referral asks ${S.sprint.refs}/${GOALS.refs}, streak ${streak()}. Recent check-ins:\n${recent || 'none'}`;
}
function sprintMentor() {
  const chat = store.get('mentor', { mode: 'talk', turns: [] });
  $('spBody').innerHTML = `<div class="card">
    <div class="row">${MENTOR_MODES.map(([k, l]) => `<button class="btn small ${chat.mode === k ? 'primary' : ''}" data-mode="${esc(k)}">${l}</button>`).join('')}<button class="btn small ghost" id="mReset">New conversation</button></div>
    <div class="chat" id="mChat">${chat.turns.length ? chat.turns.map(t => `<div class="msg ${t.role === 'user' ? 'me' : 'ai'}">${esc(t.content)}</div>`).join('') : `<div class="msg ai">${chat.mode === 'talk' ? "I've got your plan, targets, profile and check-ins. How's it going?" : 'Type "start" for the first question.'}</div>`}</div>
    <div class="composer"><textarea id="mIn" rows="2" placeholder="Talk to your mentor">${esc(mentorDraft)}</textarea><button class="btn" id="mMic">🎙 Speak</button><button class="btn primary" id="mSend">Send</button></div>
    <span class="muted small-text" id="mStatus"></span></div>`;
  mentorDraft = '';
  const box = $('mChat'); box.scrollTop = box.scrollHeight;
  attachVoice($('mMic'), $('mIn'), $('mStatus'));
  main.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { store.set('mentor', { mode: b.dataset.mode, turns: [] }); sprintMentor(); });
  $('mReset').onclick = () => { store.set('mentor', { mode: chat.mode, turns: [] }); sprintMentor(); };
  const send = () => busy($('mSend'), 'Thinking', async () => {
    const text = $('mIn').value.trim();
    if (!text) return;
    chat.turns.push({ role: 'user', content: text });
    $('mIn').value = '';
    box.insertAdjacentHTML('beforeend', `<div class="msg me">${esc(text)}</div><div class="msg ai" id="mWait"><span class="spinner"></span></div>`);
    box.scrollTop = box.scrollHeight;
    try {
      const out = await post('mentor', { history: chat.turns, context: sprintContext(), mode: chat.mode });
      chat.turns.push({ role: 'assistant', content: out.text });
    } finally { store.set('mentor', { mode: chat.mode, turns: chat.turns.slice(-30) }); sprintMentor(); }
  });
  $('mSend').onclick = send;
  $('mIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  if ($('mIn').value) send();
}

// ---------- Ask anything ----------

function viewAsk() {
  const history = store.get('ask', []);
  main.innerHTML = `<div class="page">
    <div class="stack" style="gap:4px"><h2>Ask anything</h2><p class="muted">Ask in your own words. It works out what you need, searches the web, and answers with sources. Example: "what's the Infosys package for 2 years and how do I get a referral there?"</p></div>
    <div class="card"><textarea id="askIn" rows="3" placeholder="What do you want to know?"></textarea>
      <div class="row"><button class="btn primary" id="askGo">Search and answer</button><button class="btn" id="askMic">🎙 Speak</button>
        <select id="askT" style="width:auto"><option value="">No specific target</option>${S.targets.map(t => `<option value="${esc(t.id)}">${esc(t.company)} · ${esc(t.role)}</option>`).join('')}</select><span class="muted small-text" id="askSt"></span></div></div>
    <div id="askOut" class="stack" style="gap:16px">${history.map(askCard).join('')}</div></div>`;
  attachVoice($('askMic'), $('askIn'), $('askSt'));
  $('askGo').onclick = () => busy($('askGo'), 'Searching the web', async () => {
    const question = $('askIn').value.trim();
    if (!question) return toast('Type a question first.', true);
    const out = await post('ask', { question, targetId: $('askT').value || undefined });
    const item = { question, ...out, at: Date.now() };
    history.unshift(item);
    store.set('ask', history.slice(0, 15));
    $('askOut').insertAdjacentHTML('afterbegin', askCard(item));
    $('askIn').value = '';
  });
}
function askCard(a) {
  return `<div class="card"><div class="row between"><b>${esc(a.question)}</b><span class="muted small-text">${esc(ago(a.at))}</span></div>
    <p class="muted small-text">Understood as: ${esc(a.intent)}${arr(a.queries).length ? ` · searched: ${arr(a.queries).map(q => `"${esc(q)}"`).join(', ')}` : ''}</p>
    <div class="prose">${md(a.answer, a.sources)}</div>
    <details><summary>${arr(a.sources).length} sources</summary>${sourcesList(a.sources)}</details></div>`;
}

// ---------- Profile ----------

async function viewProfile() {
  S.profile = await get('profile');
  const p = S.profile;
  const counts = { defend: 0, unsure: 0, dont: 0 };
  p.facts.forEach(f => counts[f.status]++);
  main.innerHTML = `<div class="page">
    <div class="stack" style="gap:4px"><h2>My profile</h2><p class="muted">This is everything the AI is allowed to say about you. Mark each fact <b>Defend</b> only if you can explain it for 10 minutes. <b>Unsure</b> facts are mentioned lightly; <b>Don't claim</b> facts are never used.</p></div>
    <div class="card"><h3>Build from my resumes</h3><p class="muted small-text">Reads all your resumes plus your interview guide, and marks inflated or one-off claims as Unsure. Your CTC and notice period are kept.</p>
      <div class="row"><input type="url" id="pGuide" value="https://deepsinterview.vercel.app/" style="flex:1 1 280px"><button class="btn primary" id="pSeed">${p.facts.length ? 'Rebuild profile' : 'Build my profile'}</button></div>
      ${p.facts.length ? '<p class="warnbox small-text">Rebuilding replaces your projects and facts with a fresh read. Edits you made by hand will be lost.</p>' : ''}</div>
    <div class="card"><h3>Basics</h3><div class="form-grid">
      ${[['name', 'Name'], ['headline', 'Headline'], ['years', 'Experience'], ['location', 'Location'], ['currentCtc', 'Current CTC'], ['targetCtc', 'Target CTC'], ['noticePeriod', 'Notice period']].map(([k, l]) => `<label class="field"><span>${l}</span><input type="text" data-k="${k}" value="${esc(p[k])}"></label>`).join('')}</div>
      <label class="field"><span>Summary</span><textarea data-k="summary" rows="3">${esc(p.summary)}</textarea></label>
      <div class="form-grid"><label class="field"><span>Skills you can defend (comma separated)</span><textarea id="pSkD" rows="2">${esc(arr(p.skills?.defend).join(', '))}</textarea></label><label class="field"><span>Still learning</span><textarea id="pSkL" rows="2">${esc(arr(p.skills?.learning).join(', '))}</textarea></label></div></div>
    <div class="card"><div class="row between"><h3>Projects (${p.projects.length})</h3><button class="btn small" id="pAddProj">+ Project</button></div><div id="pProjects" class="stack">${p.projects.map(projEditor).join('') || '<p class="muted">No projects yet.</p>'}</div></div>
    <div class="card"><div class="row between"><h3>Facts</h3><span class="row"><span class="pill defend">${counts.defend} defend</span><span class="pill unsure">${counts.unsure} unsure</span><span class="pill dont">${counts.dont} don't claim</span><button class="btn small" id="pAddFact">+ Fact</button></span></div><div id="pFacts">${p.facts.map(factEditor).join('') || '<p class="muted">No facts yet. Build your profile above.</p>'}</div></div>
    <div class="row" style="position:sticky;bottom:0;padding:12px 0;background:var(--desk)"><button class="btn primary" id="pSave">Save profile</button><span class="muted small-text">${p.updatedAt ? `Saved ${esc(ago(Date.parse(p.updatedAt)))}` : 'Not saved yet'}</span></div></div>`;
  $('pSeed').onclick = () => busy($('pSeed'), 'Reading your resumes (about a minute)', async () => { S.profile = await post('profile-seed', { guideUrl: $('pGuide').value.trim() || undefined }); toast('Profile built. Review the Unsure facts.'); viewProfile(); });
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
    viewProfile();
  });
}
function projEditor(x, open = false) {
  const f = (k, l, rows = 2) => `<label class="field"><span>${l}</span><textarea data-pk="${k}" rows="${rows}">${esc(k === 'stack' ? arr(x.stack).join(', ') : x[k])}</textarea></label>`;
  return `<details class="proj" data-id="${esc(x.id)}" ${open ? 'open' : ''} style="border-top:1px solid var(--line);padding-top:10px"><summary>${esc(x.name || 'New project')}</summary><div class="stack">
    <label class="field"><span>Name</span><input type="text" data-pk="name" value="${esc(x.name)}"></label>${f('stack', 'Stack (comma separated)', 1)}${f('problem', 'Problem')}${f('what', 'What you did', 3)}${f('impact', 'Impact (real numbers only)')}${f('story', '2-minute story', 6)}
    <button class="btn small danger" data-delp style="align-self:flex-start">Remove project</button></div></details>`;
}
function factEditor(f) {
  return `<div class="fact" data-id="${esc(f.id)}" data-area="${esc(f.area)}" data-project="${esc(f.project ?? '')}"><textarea rows="1">${esc(f.text)}</textarea>
    <span class="seg">${[['defend', 'Defend'], ['unsure', 'Unsure'], ['dont', "Don't claim"]].map(([k, l]) => `<button type="button" class="${k}" data-st="${k}" aria-pressed="${f.status === k}">${l}</button>`).join('')}</span>
    <button class="btn small ghost" data-del aria-label="Delete fact">✕</button></div>`;
}

// ---------- New target ----------

function viewNewTarget() {
  main.innerHTML = `<div class="page"><h2>New target</h2>
    <form class="card" id="ntForm"><div class="form-grid">
      <label class="field"><span>Company</span><input type="text" id="ntCo" required placeholder="Infosys"></label>
      <label class="field"><span>Role</span><input type="text" id="ntRole" required placeholder="Python Developer"></label>
      <label class="field"><span>Location</span><input type="text" id="ntLoc" placeholder="Chennai"></label>
      <label class="field"><span>Interview date (if known)</span><input type="date" id="ntDate"></label></div>
      <label class="field"><span>Job description (optional, makes everything sharper)</span><textarea id="ntJd" rows="8" placeholder="Paste the full JD"></textarea></label>
      <div class="row"><button class="btn primary" type="submit" id="ntGo">Create and research</button></div></form></div>`;
  $('ntCo').focus();
  $('ntForm').addEventListener('submit', e => {
    e.preventDefault();
    busy($('ntGo'), 'Creating', async () => {
      const t = await post('target-create', { company: $('ntCo').value, role: $('ntRole').value, location: $('ntLoc').value, interviewDate: $('ntDate').value, jd: $('ntJd').value });
      await loadTargets();
      autoResearch = t.id;
      location.hash = `#target/${t.id}/research`;
    });
  });
}

// ---------- Target ----------

let autoResearch = null;
const T_TABS = [['research', 'Research'], ['kit', 'Prep kit'], ['apply', 'Apply'], ['mock', 'Mock interview'], ['explain', 'Explain trainer']];

async function viewTarget(id, tab) {
  const t = await get('target', { id });
  main.innerHTML = `<div class="page">
    <div class="row between"><div class="stack" style="gap:2px"><h2>${esc(t.company)}</h2><span class="muted">${esc(t.role)}${t.location ? ` · ${esc(t.location)}` : ''}</span></div>
      <div class="row"><select id="tStage" style="width:auto">${STAGES.map(s => `<option ${s === t.stage ? 'selected' : ''}>${s}</option>`).join('')}</select><input type="date" id="tDate" value="${esc(t.interviewDate)}" style="width:auto" title="Interview date"><button class="btn small ghost danger" id="tDel">Delete</button></div></div>
    <div class="tabs" role="tablist">${T_TABS.map(([k, l]) => `<button role="tab" data-tt="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>
    <div id="tBody" class="stack" style="gap:18px"></div></div>`;
  main.querySelectorAll('[data-tt]').forEach(b => b.onclick = () => { location.hash = `#target/${id}/${b.dataset.tt}`; });
  const upd = async fields => { await post('target-update', { id, ...fields }); await loadTargets(); toast('Saved.'); };
  $('tStage').onchange = e => upd({ stage: e.target.value }).catch(err => toast(err.message, true));
  $('tDate').onchange = e => upd({ interviewDate: e.target.value }).catch(err => toast(err.message, true));
  $('tDel').onclick = () => {
    const b = $('tDel');
    if (b.dataset.confirm) return busy(b, 'Deleting', async () => { await post('target-delete', { id }); await loadTargets(); location.hash = '#sprint'; });
    b.dataset.confirm = '1'; b.textContent = 'Click again to delete'; setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.textContent = 'Delete'; } }, 4000);
  };
  const body = $('tBody');
  if (tab === 'kit') return tabKit(t, body);
  if (tab === 'apply') return tabApply(t, body);
  if (tab === 'mock') return tabMock(t, body);
  if (tab === 'explain') return tabExplain(t, body);
  return tabResearch(t, body);
}

const STEP_NAMES = ['Interview rounds and process', 'Questions candidates were asked', 'Salary for this role', 'Company, tech stack and joining'];
function tabResearch(t, body) {
  const r = t.research;
  body.innerHTML = `${r ? researchView(t) : `<div class="card"><h3>Research ${esc(t.company)}</h3><p class="muted">Runs 4 real web searches (Google, plus Tavily if configured), then builds a sourced brief. Every claim is labelled official, candidate-reported or unverified.</p>
      <label class="field"><span>Job description (optional)</span><textarea id="rJd" rows="6">${esc(t.jd)}</textarea></label></div>`}
    <div class="card"><div class="row between"><h3>${r ? 'Refresh research' : 'Run research'}</h3><span class="muted small-text">${r ? `Last run ${esc(ago(Date.parse(r.at)))} · searches are cached for 7 days` : ''}</span></div>
      <ul class="steps" id="rSteps">${STEP_NAMES.map(n => `<li>${n}</li>`).join('')}<li>Write the sourced brief</li></ul>
      <div class="row"><button class="btn primary" id="rGo">${r ? 'Run again (uses cache)' : 'Research now'}</button>${r ? '<button class="btn" id="rFresh">Run fresh searches</button>' : ''}</div></div>`;
  const run = fresh => busy($('rGo'), 'Researching', async () => {
    if ($('rJd') && $('rJd').value.trim() !== t.jd) await post('target-update', { id: t.id, jd: $('rJd').value });
    const items = [...$('rSteps').children];
    for (let i = 0; i < 4; i++) {
      items[i].className = 'run';
      const out = await post('research', { id: t.id, step: i, fresh }).catch(err => ({ error: err.message }));
      items[i].className = out.error ? 'err' : 'done';
      items[i].textContent = `${STEP_NAMES[i]} — ${out.error ? out.error : `${out.sources} sources via ${out.provider}${out.cached ? ' (cached)' : ''}`}`;
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

function researchView(t) {
  const r = t.research, src = r.sources;
  const list = (items, fn) => arr(items).length ? `<ul class="dots">${arr(items).map(fn).join('')}</ul>` : '<p class="muted small-text">Nothing found.</p>';
  return `<div class="card"><span class="label">Brief</span><div class="prose">${md(r.summary, src)}</div></div>
    <div class="card"><h3>Rounds</h3>${arr(r.rounds).map((x, i) => `<div class="qa"><div class="row between"><span class="q">${i + 1}. ${esc(x.name)}</span><span class="row">${pillFor(x.label)}${refs(x.refs, src)}</span></div><span class="muted small-text">${esc(x.format)}</span><div><b>Tests:</b> ${esc(x.tests)}</div>${x.tips && !/not in research/i.test(x.tips) ? `<div><b>Coach's tip:</b> ${esc(x.tips)}</div>` : ''}</div>`).join('') || '<p class="muted">Not in research.</p>'}</div>
    <div class="grid2">
      <div class="card"><div class="row between"><h3>Pay</h3>${pillFor(r.salary?.label)}</div><b style="font-size:22px">${esc(r.salary?.range ?? 'Not in research')}</b><p class="small-text">${md(`${r.salary?.basis ?? ''} ${arr(r.salary?.refs).map(x => `[${x}]`).join('')}`, src)}</p></div>
      <div class="card"><h3>What they value</h3>${list(r.whatTheyValue, x => `<li>${esc(x)}</li>`)}</div>
      <div class="card"><h3>Company facts</h3>${list(r.companyFacts, x => `<li>${esc(x.fact)} ${pillFor(x.label)} ${refs(x.refs, src)}</li>`)}</div>
      <div class="card"><h3>Tech stack</h3>${list(r.techStack, x => `<li>${esc(x.item)} ${refs(x.refs, src)}</li>`)}</div>
      <div class="card"><h3>What the role needs</h3>${list(r.jdNeeds, x => `<li>${esc(x)}</li>`)}</div>
      ${arr(r.redFlags).length ? `<div class="card"><h3>Watch out</h3>${list(r.redFlags, x => `<li>${md(x, src)}</li>`)}</div>` : ''}
    </div>
    ${arr(r.conflicts).length ? `<div class="warnbox"><b>Sources disagree</b>${list(r.conflicts, x => `<li>${md(x, src)}</li>`)}</div>` : ''}
    ${arr(r.unknowns).length ? `<div class="card"><h3>Could not confirm</h3><p class="muted small-text">Ask the recruiter about these instead of guessing.</p>${list(r.unknowns, x => `<li>${esc(x)}</li>`)}</div>` : ''}
    <div class="card"><details><summary>${arr(src).length} sources</summary>${sourcesList(src)}</details></div>`;
}

const KIT_ORDER = ['technical', 'projects', 'hr', 'concepts', 'ask', 'plan'];
async function tabKit(t, body) {
  if (!Object.keys(S.sections).length) S.sections = await get('sections').catch(() => ({}));
  const kit = t.kit ?? {};
  body.innerHTML = `${t.research ? '' : '<div class="warnbox">Run the research first so the kit is based on what this company actually asks.</div>'}
    <div class="card"><div class="row between"><h3>Prep kit for ${esc(t.company)}</h3><button class="btn primary" id="kAll">Build all missing sections</button></div>
      <div class="row">${KIT_ORDER.map(k => `<button class="btn small" data-kit="${k}">${kit[k] ? '↻' : '+'} ${esc(S.sections[k] ?? k)}</button>`).join('')}</div>
      <p class="muted small-text">Each section takes 15–40 seconds. Answers use only your profile facts marked Defend.</p></div>
    ${KIT_ORDER.filter(k => kit[k]).map(k => kitView(k, kit[k], t)).join('')}`;
  const build = (k, btn) => busy(btn, `Building ${S.sections[k] ?? k}`, async () => { await post('kit', { id: t.id, section: k }); });
  body.querySelectorAll('[data-kit]').forEach(b => b.onclick = async () => { await build(b.dataset.kit, b); await loadTargets(); route(); });
  $('kAll').onclick = () => busy($('kAll'), 'Building', async () => {
    for (const k of KIT_ORDER.filter(x => !kit[x])) {
      $('kAll').innerHTML = `<span class="spinner"></span> Building ${esc(S.sections[k] ?? k)}`;
      await post('kit', { id: t.id, section: k });
    }
    await loadTargets(); route();
  });
}

function kitView(k, d, t) {
  const src = t.research?.sources;
  const items = arr(d.items);
  const title = S.sections[k] ?? k;
  const head = `<div class="row between"><h3>${esc(title)}</h3><span class="muted small-text">${esc(d.model ?? '')} · ${esc(ago(Date.parse(d.at)))}</span></div>`;
  if (k === 'technical') return `<div class="card">${head}${items.map((x, i) => `<div class="qa"><span class="q">${i + 1}. ${esc(x.q)}</span><span class="muted small-text">${esc(x.why)} · ${md(x.source ?? '', src).replace(/<\/?p>/g, '')}</span>
    <details><summary>Your answer</summary><div class="prose">${md(x.answer)}</div>${arr(x.keyPoints).length ? `<span class="label">Must mention</span><ul class="dots">${arr(x.keyPoints).map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${arr(x.followUps).map(f => `<p><b>Follow-up:</b> ${esc(f.q)}<br><span class="muted">${esc(f.a)}</span></p>`).join('')}${x.trap ? `<p class="small-text"><b>Avoid:</b> ${esc(x.trap)}</p>` : ''}</details>
    <div><a href="#target/${esc(t.id)}/explain" data-practise="${esc(x.q)}">Practise saying this →</a></div></div>`).join('')}</div>`;
  if (k === 'projects') return `<div class="card">${head}${items.map(x => `<div class="qa"><span class="q">${esc(x.project)}</span><span class="muted small-text">${esc(x.whyRelevant)}</span>
    <p><b>30 seconds:</b> ${esc(x.pitch30)}</p><details><summary>2-minute story</summary><div class="prose">${md(x.star)}</div></details>
    ${arr(x.numbers).length ? `<div class="kw">${arr(x.numbers).map(n => `<span>${esc(n)}</span>`).join('')}</div>` : ''}
    <details><summary>Deep-dive questions (${arr(x.deepDive).length})</summary>${arr(x.deepDive).map(f => `<p><b>${esc(f.q)}</b><br>${esc(f.a)}</p>`).join('')}</details>
    ${arr(x.dontSay).length ? `<p class="small-text"><b>Don't say:</b> ${arr(x.dontSay).map(esc).join('; ')}</p>` : ''}</div>`).join('')}</div>`;
  if (k === 'hr') return `<div class="card">${head}${d.ctcScript ? `<div class="note"><span class="label">Salary script</span><p><b>Current:</b> ${esc(d.ctcScript.current)}</p><p><b>Expected:</b> ${esc(d.ctcScript.expected)}</p><p><b>If they push:</b> ${esc(d.ctcScript.ifPushed)}</p><p><b>Walk-away:</b> ${esc(d.ctcScript.walkAway)}</p></div>` : ''}
    ${items.map(x => `<div class="qa"><span class="q">${esc(x.q)}</span><details><summary>Your answer</summary><div class="prose">${md(x.answer, src)}</div>${x.tip ? `<p class="small-text muted">${esc(x.tip)}</p>` : ''}</details></div>`).join('')}</div>`;
  if (k === 'concepts') return `<div class="card">${head}${items.map(x => `<div class="qa"><div class="row between"><span class="q">${esc(x.concept)}</span><span class="pill ${x.priority === 'must' ? 'fail' : x.priority === 'should' ? 'warn' : ''}">${esc(x.priority)}</span></div><p>${esc(x.simple)}</p><p class="small-text"><b>In your work:</b> ${esc(x.inYourWork)}</p>
    <details><summary>Check yourself (${arr(x.check).length})</summary>${arr(x.check).map(c => `<p><b>${esc(c.q)}</b><br><span class="muted">${esc(c.a)}</span></p>`).join('')}</details>${x.learnIn ? `<p class="small-text muted">Learn: ${esc(x.learnIn)}</p>` : ''}</div>`).join('')}</div>`;
  if (k === 'ask') return `<div class="card">${head}<ul class="plain">${items.map(x => `<li><span class="pill info">${esc(x.round)}</span> ${esc(x.q)}<br><span class="muted small-text">${esc(x.why)}</span></li>`).join('')}</ul></div>`;
  if (k === 'plan') return `<div class="card">${head}${arr(d.days).map(x => `<div class="qa"><span class="q">${esc(x.day)} · ${esc(x.focus)}</span><ul class="dots">${arr(x.tasks).map(z => `<li>${esc(z)}</li>`).join('')}</ul></div>`).join('')}
    <div class="grid2"><div><span class="label">Day before</span><ul class="dots">${arr(d.dayBefore).map(z => `<li>${esc(z)}</li>`).join('')}</ul></div><div><span class="label">On the day</span><ul class="dots">${arr(d.onTheDay).map(z => `<li>${esc(z)}</li>`).join('')}</ul></div></div></div>`;
  return `<div class="card">${head}<pre class="small-text" style="white-space:pre-wrap">${esc(JSON.stringify(d, null, 2))}</pre></div>`;
}
main.addEventListener('click', e => { const a = e.target.closest('[data-practise]'); if (a) explainTopic = a.dataset.practise; });

async function tabApply(t, body) {
  if (!S.resumes) S.resumes = await fetch('/api/state', { cache: 'no-store' }).then(r => r.json()).then(d => arr(d.resumes)).catch(() => []);
  const f = t.fit;
  body.innerHTML = `
    <div class="card"><h3>Job description</h3><textarea id="aJd" rows="7" placeholder="Paste the JD for a sharper fit check">${esc(t.jd)}</textarea>
      <div class="row"><button class="btn primary" id="aFit">${f ? 'Re-check fit' : 'Check my fit'}</button></div></div>
    ${f ? `<div class="card"><div class="row" style="gap:18px;align-items:flex-start"><span class="score">${esc(f.score)}</span><div class="stack" style="gap:4px;flex:1"><b>${esc(f.verdict)}</b><span class="muted small-text">${esc(f.experienceMatch)}</span></div></div>
      <div class="grid2"><div><span class="label">You match</span><ul class="dots">${arr(f.matched).map(m => `<li><b>${esc(m.need)}</b> — ${esc(m.proof)}</li>`).join('')}</ul></div>
      <div><span class="label">Gaps and fixes</span><ul class="dots">${arr(f.gaps).map(m => `<li><b>${esc(m.need)}</b> — ${esc(m.fix)}</li>`).join('')}</ul></div></div>
      <div><span class="label">Keywords to add (only if true)</span><div class="kw">${arr(f.keywords).map(k => `<span>${esc(k)}</span>`).join('')}</div></div>
      <label class="field"><span>Tailored summary</span><textarea id="aSum" rows="3">${esc(f.summary)}</textarea></label>
      <label class="field"><span>Tailored bullets</span><textarea id="aBul" rows="7">${esc(arr(f.bullets).map(b => `• ${b}`).join('\n'))}</textarea></label>
      <div class="row"><button class="btn small" data-copy="aSum">Copy summary</button><button class="btn small" data-copy="aBul">Copy bullets</button></div></div>` : ''}
    <div class="card"><h3>Tailored resume copy</h3><p class="muted small-text">Makes a new copy of one of your resumes for ${esc(t.company)} in Resume Desk. Open it there and paste in the summary and bullets above.</p>
      ${t.resumeFile ? `<p>Created: <a href="/?r=${encodeURIComponent(t.resumeFile.replace(/\.html$/, ''))}">${esc(t.resumeFile)}</a></p>` : ''}
      <div class="row"><select id="aBase" style="width:auto;max-width:100%">${S.resumes.map(r => `<option value="${esc(r.file)}">${esc(r.file.replace(/\.html$/, ''))}</option>`).join('')}</select><button class="btn" id="aCopy" ${S.resumes.length ? '' : 'disabled'}>Create copy</button></div></div>
    <div class="card"><h3>Messages</h3><div class="form-grid">
      <label class="field"><span>Type</span><select id="mType"><option value="referral">Referral request</option><option value="recruiter">Reply to recruiter</option><option value="followup">Follow-up</option><option value="thanks">Thank-you after interview</option><option value="counter">Salary counter-offer</option><option value="post">LinkedIn post</option></select></label>
      <label class="field"><span>Their name</span><input type="text" id="mName"></label>
      <label class="field"><span>Extra context</span><input type="text" id="mExtra" placeholder="e.g. same college, offered 7 LPA"></label></div>
      <div class="row"><button class="btn primary" id="mGo">Write it</button></div>
      <textarea id="mOut" rows="6" ${t.messages?.[0] ? '' : 'hidden'}>${esc(t.messages?.[0]?.text ?? '')}</textarea><button class="btn small" data-copy="mOut" ${t.messages?.[0] ? '' : 'hidden'} id="mCopyBtn" style="align-self:flex-start">Copy</button></div>`;
  $('aFit').onclick = () => busy($('aFit'), 'Checking fit', async () => {
    if ($('aJd').value.trim() !== t.jd) await post('target-update', { id: t.id, jd: $('aJd').value });
    await post('fit', { id: t.id }); await loadTargets(); route();
  });
  $('aCopy').onclick = () => busy($('aCopy'), 'Creating', async () => { const out = await post('tailor-copy', { id: t.id, from: $('aBase').value }); toast(`Created ${out.file}`); route(); });
  $('mGo').onclick = () => busy($('mGo'), 'Writing', async () => {
    const out = await post('message', { id: t.id, type: $('mType').value, name: $('mName').value, extra: $('mExtra').value });
    $('mOut').hidden = false; $('mCopyBtn').hidden = false; $('mOut').value = out.text;
  });
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  const el = $(b.dataset.copy);
  try { await navigator.clipboard.writeText(el.value ?? el.textContent); toast('Copied.'); } catch { el.select?.(); toast('Press Ctrl+C to copy.'); }
});

function tabMock(t, body) {
  const rounds = arr(t.research?.rounds).map(r => r.name).filter(Boolean);
  const options = rounds.length ? rounds : ['Technical', 'Managerial', 'HR'];
  const key = `mock-${t.id}`;
  const st = store.get(key, { round: options[0], turns: [], feedback: [] });
  const fbCard = f => `<div class="msg fb"><div class="row between"><b>Score ${esc(f.score)}/5</b></div><p><b>Strong:</b> ${esc(f.strong)}</p><p><b>Missing:</b> ${esc(f.missing)}</p><details><summary>A stronger answer</summary><div class="prose">${md(f.better)}</div></details></div>`;
  body.innerHTML = `<div class="card">
    <div class="row between"><div class="row"><span class="label">Round</span><select id="moRound" style="width:auto">${options.map(o => `<option ${o === st.round ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
      <div class="row"><button class="btn" id="moStart">${st.turns.length ? 'Restart' : 'Start interview'}</button><button class="btn" id="moEnd" ${st.turns.length > 2 ? '' : 'disabled'}>End and get report</button></div></div>
    <div class="chat" id="moChat">${st.turns.length ? st.turns.map((x, i) => `${x.role === 'assistant' ? `<div class="msg ai">${esc(x.content)}</div>` : `<div class="msg me">${esc(x.content)}</div>${st.feedback[i] ? fbCard(st.feedback[i]) : ''}`}`).join('') : `<div class="empty">The interviewer behaves like ${esc(t.company)}'s ${esc(st.round)} round, based on your research. Answer out loud with 🎙, the way you would in the real interview.</div>`}</div>
    <div class="composer"><textarea id="moIn" rows="3" placeholder="Your answer" ${st.turns.length ? '' : 'disabled'}></textarea><button class="btn" id="moMic" ${st.turns.length ? '' : 'disabled'}>🎙 Speak</button><button class="btn primary" id="moSend" ${st.turns.length ? '' : 'disabled'}>Answer</button></div>
    <span class="muted small-text" id="moSt"></span></div>
    ${arr(t.mocks).length ? `<div class="card"><h3>Past reports</h3>${arr(t.mocks).map(m => mockReport(m.report, m.round, m.at)).join('')}</div>` : ''}`;
  const box = $('moChat'); box.scrollTop = box.scrollHeight;
  attachVoice($('moMic'), $('moIn'), $('moSt'));
  const save = () => store.set(key, st);
  $('moRound').onchange = e => { st.round = e.target.value; st.turns = []; st.feedback = []; save(); route(); };
  $('moStart').onclick = () => busy($('moStart'), 'Interviewer is joining', async () => {
    st.round = $('moRound').value; st.turns = []; st.feedback = [];
    const out = await post('mock', { id: t.id, round: st.round, history: [] });
    st.turns.push({ role: 'assistant', content: out.next }); save(); route();
  });
  $('moSend').onclick = () => busy($('moSend'), 'Evaluating', async () => {
    const answer = $('moIn').value.trim();
    if (answer.length < 3) return toast('Answer first.', true);
    st.turns.push({ role: 'user', content: answer }); save();
    const out = await post('mock', { id: t.id, round: st.round, history: st.turns });
    st.feedback[st.turns.length - 1] = out;
    if (out.next) st.turns.push({ role: 'assistant', content: out.next });
    save(); route();
  });
  $('moEnd').onclick = () => busy($('moEnd'), 'Writing your report', async () => {
    await post('mock', { id: t.id, round: st.round, history: st.turns, action: 'report' });
    st.turns = []; st.feedback = []; save(); route();
  });
}
function mockReport(r, round, at) {
  if (!r) return '';
  return `<div class="qa"><div class="row between"><span class="q">${esc(round)} · ${esc(r.overall)}/10 · ${esc(r.hireSignal)}</span><span class="muted small-text">${esc(ago(Date.parse(at)))}</span></div><p>${esc(r.summary)}</p>
    <details><summary>Weak spots and drills</summary><ul class="dots">${arr(r.weakSpots).map(w => `<li><b>${esc(w.topic)}</b>: ${esc(w.fix)}</li>`).join('')}</ul><span class="label">Next drills</span><ul class="dots">${arr(r.nextDrills).map(d => `<li>${esc(d)}</li>`).join('')}</ul><p><b>Strengths:</b> ${arr(r.strengths).map(esc).join('; ')}</p></details></div>`;
}

let explainTopic = '';
async function tabExplain(t, body) {
  if (!S.profile) S.profile = await get('profile').catch(() => ({ projects: [] }));
  const projects = arr(S.profile.projects).map(p => p.name);
  const concepts = arr(t.kit?.concepts?.items).map(c => c.concept);
  const key = `explain-${t.id}`;
  const st = store.get(key, { topic: explainTopic || projects[0] || '', kind: explainTopic ? 'concept' : 'project', history: [], rounds: [] });
  if (explainTopic) { st.topic = explainTopic; st.kind = 'concept'; st.history = []; st.rounds = []; explainTopic = ''; }
  const scoreBars = s => `<div class="bars">${Object.entries(s ?? {}).map(([k, v]) => `<span>${esc(k)}</span><span class="bar"><i style="width:${Math.min(100, Number(v) * 20)}%"></i></span><span class="num">${esc(v)}</span>`).join('')}</div>`;
  body.innerHTML = `<div class="card"><h3>Explain it out loud</h3><p class="muted small-text">Pick something, explain it like you would to the interviewer, and get scored. The trainer then asks the follow-up a real interviewer would.</p>
    <div class="form-grid"><label class="field"><span>Topic</span><select id="exPick"><option value="">Type my own…</option>${projects.length ? `<optgroup label="Your projects">${projects.map(p => `<option data-kind="project" ${p === st.topic ? 'selected' : ''}>${esc(p)}</option>`).join('')}</optgroup>` : ''}${concepts.length ? `<optgroup label="Concepts for ${esc(t.company)}">${concepts.map(c => `<option data-kind="concept" ${c === st.topic ? 'selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>` : ''}</select></label>
      <label class="field"><span>Or your own topic / question</span><input type="text" id="exTopic" value="${esc(st.topic)}"></label></div>
    <div class="composer"><textarea id="exIn" rows="5" placeholder="Explain it here, or press Speak and talk"></textarea><button class="btn" id="exMic">🎙 Speak</button><button class="btn primary" id="exGo">Score my explanation</button></div>
    <span class="muted small-text" id="exSt"></span></div>
    ${st.rounds.map((r, i) => `<div class="card"><div class="row between"><b>${i ? `Follow-up: ${esc(r.topic)}` : esc(r.topic)}</b><span class="score" style="font-size:28px">${esc(r.fb.overall)}/10</span></div>
      <p>${esc(r.fb.verdict)}</p>${scoreBars(r.fb.scores)}
      <div class="grid2"><div><span class="label">Good</span><ul class="dots">${arr(r.fb.strong).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div><div><span class="label">Fix</span><ul class="dots">${arr(r.fb.fix).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      ${arr(r.fb.missing).length ? `<div><span class="label">Interviewer expected to hear</span><ul class="dots">${arr(r.fb.missing).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${arr(r.fb.wrong).length ? `<div class="warnbox"><b>Technically wrong:</b> ${arr(r.fb.wrong).map(esc).join('; ')}</div>` : ''}
      <details><summary>Your answer</summary><p class="muted">${esc(r.said)}</p></details>
      <div class="note"><span class="label">Tighter version (say it like this)</span><p>${esc(r.fb.tighter)}</p></div></div>`).join('')}
    ${st.rounds.length ? `<div class="card"><span class="label">Interviewer follows up</span><p><b>${esc(st.rounds.at(-1).fb.followUp)}</b></p><div class="row"><button class="btn primary" id="exFollow">Answer the follow-up</button><button class="btn ghost" id="exReset">Start a new topic</button></div></div>` : ''}`;
  attachVoice($('exMic'), $('exIn'), $('exSt'));
  const save = () => store.set(key, st);
  $('exPick').onchange = e => { const o = e.target.selectedOptions[0]; if (o.value) { $('exTopic').value = o.value; st.kind = o.dataset.kind; } };
  $('exGo').onclick = () => busy($('exGo'), 'Scoring', async () => {
    const topic = $('exTopic').value.trim();
    if (!topic) return toast('Pick or type a topic.', true);
    if (topic !== st.topic && !st.pendingFollow) { st.history = []; st.rounds = []; }
    st.topic = topic;
    const said = $('exIn').value.trim();
    const fb = await post('explain', { topic, kind: st.kind, explanation: said, history: st.history, targetId: t.id });
    st.history.push({ role: 'user', content: `${topic}: ${said}` }, { role: 'assistant', content: `Follow-up: ${fb.followUp}` });
    st.rounds.push({ topic, said, fb });
    st.pendingFollow = false;
    save(); route();
  });
  if ($('exFollow')) $('exFollow').onclick = () => { st.topic = st.rounds.at(-1).fb.followUp; st.pendingFollow = true; save(); $('exTopic').value = st.topic; $('exIn').focus(); toast('Answer the follow-up in the box above.'); main.scrollTo({ top: 0, behavior: 'smooth' }); };
  if ($('exReset')) $('exReset').onclick = () => { st.history = []; st.rounds = []; save(); route(); };
}

// ---------- Offers ----------

function viewOffers() {
  const st = store.get('offers', { rows: [{ company: '', role: '', fixedLpa: '', variableLpa: '', joiningBonus: '', location: '', joining: '', notes: '' }], result: null });
  const cols = [['company', 'Company'], ['role', 'Role'], ['fixedLpa', 'Fixed LPA'], ['variableLpa', 'Variable LPA'], ['joiningBonus', 'Joining bonus'], ['location', 'Location / mode'], ['joining', 'Joining date / notice'], ['notes', 'Notes (bond, benefits)']];
  const r = st.result;
  main.innerHTML = `<div class="page"><div class="stack" style="gap:4px"><h2>Offers</h2><p class="muted">Compare offers and get a negotiation script. If you researched the company as a target, its researched pay range is used as evidence.</p></div>
    <div class="tablewrap"><table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody id="ofRows">${st.rows.map((row, i) => `<tr data-i="${i}">${cols.map(([k]) => `<td><input type="text" data-k="${k}" value="${esc(row[k])}" style="min-width:${k === 'notes' ? 180 : 100}px"></td>`).join('')}<td><button class="btn small ghost" data-rm="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>
    <div class="row"><button class="btn" id="ofAdd">+ Offer</button><button class="btn primary" id="ofGo">Compare and plan negotiation</button></div>
    ${r ? `<div class="card"><h3>Recommendation</h3><p>${esc(r.recommendation)}</p></div>
      <div class="grid2">${arr(r.comparison).map(c => `<div class="card"><h3>${esc(c.company)}</h3><b>${esc(c.fixedLpa)} LPA fixed</b><span class="muted small-text">${esc(c.inHandMonthlyApprox)}</span><span class="label">Pros</span><ul class="dots">${arr(c.pros).map(x => `<li>${esc(x)}</li>`).join('')}</ul><span class="label">Cons</span><ul class="dots">${arr(c.cons).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>
      <div class="card"><h3>Negotiate</h3>${arr(r.negotiate).map(n => `<div class="qa"><span class="q">${esc(n.company)}: ${esc(n.ask)}</span><div class="note"><span class="label">Say this</span><p>${esc(n.script)}</p></div></div>`).join('')}</div>
      ${arr(r.watchOuts).length ? `<div class="warnbox"><b>Watch out</b><ul class="dots">${arr(r.watchOuts).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}` : ''}</div>`;
  const read = () => { st.rows = [...$('ofRows').children].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value.trim()]))); store.set('offers', st); };
  $('ofRows').addEventListener('input', read);
  $('ofRows').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { read(); st.rows.splice(Number(b.dataset.rm), 1); if (!st.rows.length) st.rows.push({}); store.set('offers', st); viewOffers(); } });
  $('ofAdd').onclick = () => { read(); st.rows.push({}); store.set('offers', st); viewOffers(); };
  $('ofGo').onclick = () => busy($('ofGo'), 'Comparing', async () => {
    read();
    const offers = st.rows.filter(x => x.company);
    if (!offers.length) return toast('Add at least one offer.', true);
    st.result = await post('offers', { offers });
    store.set('offers', st); viewOffers();
  });
}

// ---------- Settings: AI limits ----------

async function viewSettings() {
  const render = async () => {
    if (!location.hash.startsWith('#settings')) return;
    const st = await get('status');
    S.status = st;
    const rows = arr(st.budgets);
    const meter = (used, limit) => { if (!limit) return ''; const p = Math.min(100, Math.round((used / limit) * 100)); return `<div class="meter"><i class="${p > 85 ? 'hi' : p > 60 ? 'mid' : ''}" style="width:${p}%"></i></div>`; };
    const lim = (b, k, unit) => (b.limits[k] ? `${b.used[{ rpm: 'minuteRequests', rpd: 'dayRequests', tpm: 'minuteTokens', tpd: 'dayTokens', perMonth: 'monthRequests' }[k]].toLocaleString('en-IN')} / ${b.limits[k].toLocaleString('en-IN')} ${unit}${meter(b.used[{ rpm: 'minuteRequests', rpd: 'dayRequests', tpm: 'minuteTokens', tpd: 'dayTokens', perMonth: 'monthRequests' }[k]], b.limits[k])}` : '');
    const stateText = b => b.state === 'ready' ? 'Ready' : b.state === 'cooling' ? `Cooling · ${dur(b.readyInMs)}` : b.state === 'exhausted' ? `Out of quota · ${dur(b.readyInMs)}` : 'Blocked';
    $('setBody').innerHTML = `
      <div class="tablewrap"><table><thead><tr><th>Model / service</th><th>Status</th><th>Per minute</th><th>Per day / month</th><th>Live from provider</th><th>Last call</th><th></th></tr></thead><tbody>
      ${rows.map(b => `<tr><td><b>${esc(b.label)}</b><div class="muted small-text">${esc(b.id)}</div></td>
        <td><span class="pill ${esc(b.state)}">${esc(stateText(b))}</span>${b.blocked ? `<div class="small-text" style="color:var(--fail);max-width:260px">${esc(b.blocked.reason)}</div>` : b.cooldownReason ? `<div class="small-text muted" style="max-width:260px">${esc(b.cooldownReason.slice(0, 140))}</div>` : ''}</td>
        <td class="num">${lim(b, 'rpm', 'req')}${lim(b, 'tpm', 'tok')}${b.limits.minGapMs ? `<div class="small-text muted">1 call per ${b.limits.minGapMs / 1000}s</div>` : ''}</td>
        <td class="num">${lim(b, 'rpd', 'req')}${lim(b, 'tpd', 'tok')}${lim(b, 'perMonth', 'per month')}</td>
        <td class="num small-text">${b.header ? `${b.header.remainingRequests ?? '?'} / ${b.header.limitRequests ?? '?'} req<br>${b.header.remainingTokens ?? '?'} / ${b.header.limitTokens ?? '?'} tok<br><span class="muted">${esc(b.header.window ?? '')} · ${esc(ago(b.header.at))}</span>` : '<span class="muted">No live headers yet</span>'}</td>
        <td class="small-text">${b.lastOkAt ? `OK ${esc(ago(b.lastOkAt))}${b.lastLatencyMs ? ` · ${dur(b.lastLatencyMs)}` : ''}` : '<span class="muted">Not used yet</span>'}${b.lastError ? `<div style="color:var(--fail)">${esc(ago(b.lastError.at))}: ${esc(b.lastError.message.slice(0, 120))}</div>` : ''}<div class="muted">${b.totals.requests} calls · ${b.totals.errors} errors</div></td>
        <td>${b.id.startsWith('search:') || b.id.includes('whisper') ? '' : `<button class="btn small" data-probe="${esc(b.id)}">Test</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="grid2">
        <div class="card"><h3>Which model does what</h3>${Object.entries(st.routes).map(([task, ids]) => `<div><span class="label">${esc({ fast: 'Live chat · mocks, mentor, explain', smart: 'Careful work · research, kits, fit', light: 'Short writing · messages' }[task] ?? task)}</span><ol class="dots">${ids.map(id => `<li>${esc(id)}</li>`).join('')}</ol></div>`).join('')}<p class="muted small-text">The first model with budget left answers. A model that is rate limited is skipped until it recovers.</p></div>
        <div class="card"><h3>How limits work</h3><ul class="dots small-text">
          <li><b>Ready</b>: has budget now. <b>Cooling</b>: hit a short limit, back soon. <b>Out of quota</b>: daily or monthly cap used. <b>Blocked</b>: key rejected or plan allows 0 requests.</li>
          <li>Numbers in the per-minute and per-day columns are this app's own count against the free-tier limits in <code>lib/llm-config.mjs</code>. The live column is what Groq and Mistral report on every reply, which is the most accurate.</li>
          <li>Searches are cached for 7 days, so re-opening a company costs nothing.</li>
          <li><b>Web search order:</b> Google (via Gemini, about 18 a day) → Groq browser search (uses the gpt-oss model budgets above) → Tavily if configured. Research keeps working when Google runs out.</li>
          ${st.searchConfigured.tavily ? '' : '<li><b>Tavily is not set up.</b> Add <code>TAVILY_API_KEY</code> (free, 1,000 searches/month at tavily.com) for deeper research.</li>'}
          ${rows.some(b => b.id.startsWith('mistral') && b.state === 'blocked') ? '<li><b>Mistral is blocked.</b> Turn on the free Experiment plan at console.mistral.ai → Admin → Billing, then press Test.</li>' : ''}
        </ul></div></div>`;
  };
  main.innerHTML = `<div class="page"><div class="row between"><div class="stack" style="gap:4px"><h2>Settings · AI limits</h2><p class="muted">Live status of every free model and search service. Refreshes every 10 seconds.</p></div><button class="btn" id="setRefresh">Refresh</button></div><div id="setBody" class="stack" style="gap:18px"><div class="empty"><span class="spinner"></span> Loading…</div></div></div>`;
  $('setRefresh').onclick = render;
  $('setBody').addEventListener('click', e => {
    const b = e.target.closest('[data-probe]');
    if (b) busy(b, 'Testing', async () => { const r = await post('probe', { id: b.dataset.probe }); toast(r.ok ? `${b.dataset.probe} answered in ${dur(r.latencyMs)}.` : r.error, !r.ok); await render(); });
  });
  await render();
  const timer = setInterval(render, 10_000);
  teardown = () => clearInterval(timer);
}

// ---------- Start ----------

(async () => {
  const me = await fetch('/api/prep/sections', { cache: 'no-store' }).catch(() => null);
  if (me && me.status === 401) { location.href = '/'; return; }
  await loadTargets();
  refreshQuota();
  setInterval(refreshQuota, 60_000);
  route();
})();
