import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { X, Mic, Square, RotateCcw, ArrowRight, Volume2, VolumeX, Flag, Check } from 'lucide-react';
import { get, post, type Json } from '../lib/api';
import { useApp } from '../lib/state';
import { useRecorder, speak, stopSpeaking } from '../lib/voice';
import { Orb } from '../components/Orb';
import { Waveform } from '../components/Waveform';
import { Ring, Spinner, CountUp, Rich } from '../components/ui';
import { Feedback } from './Company';
import { arr, cx } from '../lib/util';

type Phase = 'lobby' | 'speaking' | 'listening' | 'review' | 'thinking' | 'scored' | 'report';
const TARGET_SECONDS = 120;

function useTypewriter(text: string, speed = 22) {
  const [out, setOut] = useState('');
  useEffect(() => { setOut(''); if (!text) return; let i = 0; const t = setInterval(() => { i += 2; setOut(text.slice(0, i)); if (i >= text.length) clearInterval(t); }, speed); return () => clearInterval(t); }, [text, speed]);
  return out;
}

export default function Studio() {
  const { id = 'general' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { profile, toast, loadTargets, loadSummary } = useApp();
  const mode = params.get('mode') === 'explain' || id === 'general' ? 'explain' : 'mock';
  const [t, setT] = useState<Json | null>(null);
  const [round, setRound] = useState(params.get('round') ?? '');
  const [topic, setTopic] = useState('');
  const [phase, setPhase] = useState<Phase>('lobby');
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [history, setHistory] = useState<Json[]>([]);
  const [draft, setDraft] = useState('');
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<Json | null>(null);
  const [report, setReport] = useState<Json | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [level, setLevel] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const rec = useRecorder(180);
  const typed = useTypewriter(question);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; if (id !== 'general') get('target', { id }).then(x => { setT(x); if (!round) setRound(arr<Json>(x.research?.rounds).map(r => r.name).find((n: string) => /tech/i.test(n)) ?? arr<Json>(x.research?.rounds)[0]?.name ?? 'Technical'); }).catch(err => toast(err.message, true)); return () => { alive.current = false; stopSpeaking(); }; }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!topic && profile?.projects?.length) setTopic(profile.projects[0].name); }, [profile, topic]);

  const ask = async (q: string) => {
    setQuestion(q); setResult(null); setDraft('');
    setPhase('speaking');
    if (voiceOn) await speak(q, setLevel);
    if (!alive.current) return;
    setPhase('listening');
    await rec.start();
  };
  const begin = async () => {
    if (mode === 'mock') {
      setPhase('thinking');
      try { const out = await post('mock', { id, round, history: [] }); setTurns([{ role: 'assistant', content: out.next }]); await ask(out.next); }
      catch (err) { toast((err as Error).message, true); setPhase('lobby'); }
    } else {
      if (!topic.trim()) { toast('Pick or type a topic first.', true); return; }
      await ask(`Explain ${topic} to me, the way you would in an interview.`);
    }
  };
  const stopAnswer = async () => { setPhase('thinking'); const { text, seconds } = await rec.stop(); setSecs(seconds); setDraft(text); setPhase('review'); };
  const submit = async () => {
    const answer = draft.trim();
    if (answer.length < 3) { toast('Nothing came through. Record again or type your answer.', true); return; }
    setPhase('thinking');
    try {
      if (mode === 'mock') {
        const next = [...turns, { role: 'user' as const, content: answer }];
        const out = await post('mock', { id, round, history: next, seconds: secs });
        setTurns(out.next ? [...next, { role: 'assistant', content: out.next }] : next);
        setScores(s => [...s, Number(out.score) || 0]);
        setResult(out);
      } else {
        const fb = await post('explain', { topic: question.replace(/^Explain (.*) to me, the way.*$/, '$1'), kind: 'project', explanation: answer, history, targetId: id === 'general' ? undefined : id, seconds: secs });
        setHistory(h => [...h, { role: 'user', content: `${question}: ${answer}` }, { role: 'assistant', content: `Follow-up: ${fb.followUp}` }]);
        setScores(s => [...s, Number(fb.overall) / 2]);
        setResult(fb);
      }
      setPhase('scored');
      loadSummary();
    } catch (err) { toast((err as Error).message, true); setPhase('review'); }
  };
  const next = () => { const q = mode === 'mock' ? result?.next : result?.followUp; if (q) ask(q); };
  const finish = async () => {
    stopSpeaking();
    if (mode === 'explain' || turns.filter(x => x.role === 'user').length < 2) { nav(id === 'general' ? '/practice' : `/c/${id}/practise`); return; }
    setPhase('thinking');
    try {
      const out = await post('mock', { id, round, history: turns, action: 'report' });
      setReport(out.report); setPhase('report'); loadTargets(); loadSummary();
      if (Number(out.report?.overall) >= 7) confetti({ particleCount: 160, spread: 80, origin: { y: 0.6 }, colors: ['#8B7CFF', '#2DD4BF', '#FFB547'] });
    } catch (err) { toast((err as Error).message, true); setPhase('scored'); }
  };

  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const title = mode === 'mock' ? `${t?.company ?? ''} · ${round}` : 'Explain it out loud';

  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <Link to={id === 'general' ? '/practice' : `/c/${id}/practise`} onClick={() => stopSpeaking()} className="btn-quiet"><X className="h-5 w-5" />Leave</Link>
        <div className="text-center"><p className="font-display font-semibold">{title}</p>{scores.length > 0 && <p className="text-xs text-ink-3">{scores.length} answered · average {avg.toFixed(1)}/5</p>}</div>
        <div className="flex items-center gap-1">
          <button className="btn-quiet" onClick={() => { setVoiceOn(v => !v); stopSpeaking(); }} aria-label={voiceOn ? 'Mute interviewer' : 'Unmute interviewer'}>{voiceOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}</button>
          {phase !== 'lobby' && phase !== 'report' && <button className="btn-ghost" onClick={finish}><Flag className="h-4 w-4" />{mode === 'mock' ? 'Finish' : 'Done'}</button>}
        </div>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 pb-10">
        <AnimatePresence mode="wait">
          {phase === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex w-full flex-col items-center text-center">
              <Orb listening />
              <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{mode === 'mock' ? `Ready for ${t?.company ?? 'the interview'}?` : 'Explain one thing, clearly'}</h1>
              <p className="mt-3 max-w-lg text-ink-2">{mode === 'mock' ? 'The interviewer speaks each question. Answer out loud like the real thing. Every answer gets a score; finish for a full report.' : 'Pick a project or concept, then explain it as if the interviewer just asked. You get scored, then a follow-up.'}</p>
              <div className="mt-6 w-full max-w-md">
                {mode === 'mock' ? (
                  <select className="input" value={round} onChange={e => setRound(e.target.value)}>{(arr<Json>(t?.research?.rounds).map(r => r.name).filter(Boolean).length ? arr<Json>(t?.research?.rounds).map(r => r.name) : ['Technical', 'Managerial', 'HR']).map((r: string) => <option key={r}>{r}</option>)}</select>
                ) : (
                  <>
                    <select className="input" value={topic} onChange={e => setTopic(e.target.value)}>{arr<Json>(profile?.projects).map(p => <option key={p.name}>{p.name}</option>)}<option value="">Something else…</option></select>
                    {!arr<Json>(profile?.projects).some(p => p.name === topic) && <input className="input mt-2" placeholder="Type a topic, e.g. Python GIL" value={topic} onChange={e => setTopic(e.target.value)} />}
                  </>
                )}
              </div>
              <button className="btn-amber mt-6 px-8 py-3.5 text-lg" onClick={begin} disabled={mode === 'mock' && !t}><Mic className="h-5 w-5" />Start</button>
              <p className="mt-3 text-xs text-ink-3">Uses your microphone. Allow it when the browser asks.</p>
            </motion.div>
          )}

          {(phase === 'speaking' || phase === 'listening' || phase === 'review' || phase === 'thinking') && (
            <motion.div key="live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full flex-col items-center">
              <Orb level={level} listening={phase === 'listening'} size={phase === 'listening' || phase === 'review' ? 120 : 168} />
              <p className="-mt-2 mb-2 text-sm font-semibold text-ink-3">{phase === 'speaking' ? 'Interviewer is speaking…' : phase === 'listening' ? 'Your turn — answer out loud' : phase === 'review' ? 'Check your answer' : 'Thinking…'}</p>
              {question && <p className="max-w-2xl text-center font-display text-2xl font-semibold leading-snug sm:text-3xl">{typed}<span className={cx('ml-0.5 inline-block w-[2px] bg-violet align-middle', typed.length < question.length ? 'h-7 animate-pulse' : 'h-0')} /></p>}

              {phase === 'listening' && (
                <div className="mt-8 w-full">
                  <Waveform analyser={rec.analyser} active={rec.recording} />
                  <p className="mx-auto mt-3 min-h-[3rem] max-w-2xl text-center text-ink-2">{rec.captions || <span className="text-ink-3">Live captions appear as you speak…</span>}</p>
                  <div className="mt-4 flex items-center justify-center gap-5">
                    <Ring value={rec.seconds} max={TARGET_SECONDS} size={64} stroke={6} color={rec.seconds > TARGET_SECONDS ? '#FB7185' : '#2DD4BF'}><span className="tnum text-sm font-semibold">{Math.floor(rec.seconds / 60)}:{String(rec.seconds % 60).padStart(2, '0')}</span></Ring>
                    <motion.button whileTap={{ scale: 0.94 }} onClick={stopAnswer} className="grid h-20 w-20 place-items-center rounded-full bg-rose text-night-950 shadow-[0_0_0_10px_rgba(251,113,133,.15)]" aria-label="Stop answering"><Square className="h-7 w-7" fill="currentColor" /></motion.button>
                    <span className="w-16 text-xs text-ink-3">Aim for 1–2 min</span>
                  </div>
                  {rec.error && <p className="mt-3 text-center text-sm text-amber">{rec.error}</p>}
                </div>
              )}

              {phase === 'review' && (
                <div className="mt-6 w-full">
                  <textarea className="input min-h-[140px] text-base" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Your transcript appears here. Fix anything that came out wrong, or type your answer." />
                  {rec.error && <p className="mt-2 text-sm text-amber">{rec.error}</p>}
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <button className="btn-primary px-6" onClick={submit}><Check className="h-4 w-4" />Submit answer</button>
                    <button className="btn-ghost" onClick={async () => { setPhase('listening'); await rec.start(); }}><RotateCcw className="h-4 w-4" />Record again</button>
                  </div>
                </div>
              )}
              {phase === 'thinking' && <div className="mt-8 flex items-center gap-2 text-ink-2"><Spinner />Working on it…</div>}
            </motion.div>
          )}

          {phase === 'scored' && result && (
            <motion.div key="scored" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full">
              <div className="glass-hi p-6 sm:p-8">
                {mode === 'mock' ? (
                  <>
                    <div className="flex items-center gap-5">
                      <div className="flex gap-1.5">{[1, 2, 3, 4, 5].map(i => <motion.span key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.08 * i, type: 'spring' }} className={cx('h-4 w-8 rounded-full', i <= Number(result.score) ? 'bg-gradient-to-r from-violet to-teal' : 'bg-white/10')} />)}</div>
                      <span className="font-display text-3xl font-bold"><CountUp value={Number(result.score) || 0} />/5</span>
                      {result.skill && <span className="chip bg-violet-soft text-violet">{result.skill}</span>}
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl bg-teal/10 p-4"><b className="text-teal">What worked</b><p className="mt-1">{result.strong}</p></div>
                      <div className="rounded-2xl bg-amber/10 p-4"><b className="text-amber">What was missing</b><p className="mt-1">{result.missing}</p></div>
                    </div>
                    <details className="mt-4"><summary className="cursor-pointer font-semibold text-violet">A stronger answer</summary><Rich text={result.better} className="mt-2" /></details>
                  </>
                ) : <Feedback fb={result} />}
                <div className="mt-6 flex flex-wrap gap-2">
                  {(mode === 'mock' ? result.next : result.followUp) && <button className="btn-amber px-6" onClick={next}>{mode === 'mock' ? 'Next question' : 'Answer the follow-up'}<ArrowRight className="h-4 w-4" /></button>}
                  <button className="btn-ghost" onClick={finish}>{mode === 'mock' ? 'Finish and get my report' : 'Done for now'}</button>
                </div>
              </div>
            </motion.div>
          )}

          {phase === 'report' && report && (
            <motion.div key="report" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="w-full space-y-5">
              <div className="glass-hi flex flex-wrap items-center gap-6 p-6 sm:p-8">
                <Ring value={Number(report.overall) || 0} max={10} size={140} stroke={13} color={Number(report.overall) >= 7 ? '#2DD4BF' : '#FFB547'}><div><CountUp value={Number(report.overall) || 0} className="font-display text-4xl font-bold" /><p className="text-xs text-ink-3">out of 10</p></div></Ring>
                <div className="min-w-0 flex-1"><p className="text-sm font-bold uppercase tracking-wide text-ink-3">Hire signal: {report.hireSignal}</p><h2 className="mt-1 text-2xl font-bold">{report.summary}</h2></div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="glass p-5"><h3 className="font-semibold text-teal">Strengths</h3><ul className="mt-2 list-disc space-y-1 pl-5">{arr(report.strengths).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>
                <div className="glass p-5"><h3 className="font-semibold text-amber">Drill next</h3><ul className="mt-2 list-disc space-y-1 pl-5">{arr(report.nextDrills).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>
              </div>
              <div className="glass p-5"><h3 className="font-semibold">Weak spots</h3><ul className="mt-2 space-y-2">{arr<Json>(report.weakSpots).map((w, i) => <li key={i}><b>{w.topic}.</b> <span className="text-ink-2">{w.fix}</span></li>)}</ul></div>
              <div className="flex flex-wrap gap-2"><button className="btn-amber" onClick={() => { setTurns([]); setScores([]); setReport(null); setPhase('lobby'); }}>Go again</button><Link className="btn-ghost" to={`/c/${id}/practise`}>Back to {t?.company}</Link><Link className="btn-quiet" to="/progress">See my progress</Link></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
