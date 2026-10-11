// Voice for the studio: record the answer (with a live analyser for the waveform and live captions from the
// browser), transcribe with Whisper on the server, and speak the interviewer's lines (Groq voice when
// enabled, otherwise the browser's own voice).
import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from './api';

type SR = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const SRClass = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
export const canRecord = typeof navigator !== 'undefined' && 'mediaDevices' in navigator && typeof window.MediaRecorder !== 'undefined';

const toB64 = (blob: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });

export function useRecorder(maxSeconds = 180) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [captions, setCaptions] = useState('');
  const [error, setError] = useState('');
  const analyser = useRef<AnalyserNode | null>(null);
  const parts = useRef<{ rec?: MediaRecorder; stream?: MediaStream; ctx?: AudioContext; sr?: SR; chunks: Blob[]; started: number; finalText: string; timer?: number; done?: (v: { blob: Blob | null; captions: string; seconds: number }) => void }>({ chunks: [], started: 0, finalText: '' });

  const cleanup = () => {
    const p = parts.current;
    clearInterval(p.timer);
    p.stream?.getTracks().forEach(t => t.stop());
    p.ctx?.close().catch(() => {});
    try { p.sr?.stop(); } catch { /* already stopped */ }
    analyser.current = null;
    setRecording(false);
  };

  const start = useCallback(async () => {
    setError(''); setCaptions(''); setSeconds(0);
    const p = parts.current;
    p.chunks = []; p.finalText = '';
    if (SRClass) {
      const sr = new SRClass();
      sr.lang = 'en-IN'; sr.continuous = true; sr.interimResults = true;
      sr.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) p.finalText += `${e.results[i][0].transcript} `; else interim += e.results[i][0].transcript;
        }
        setCaptions(`${p.finalText}${interim}`.trim());
      };
      sr.onerror = () => {}; sr.onend = () => {};
      p.sr = sr;
      try { sr.start(); } catch { /* captions are optional */ }
    }
    if (canRecord) {
      try {
        p.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        p.ctx = new AudioContext();
        const src = p.ctx.createMediaStreamSource(p.stream);
        const an = p.ctx.createAnalyser(); an.fftSize = 256; src.connect(an); analyser.current = an;
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
        p.rec = new MediaRecorder(p.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
        p.rec.ondataavailable = e => { if (e.data.size) p.chunks.push(e.data); };
        p.rec.onstop = () => {
          const blob = p.chunks.length ? new Blob(p.chunks, { type: p.rec?.mimeType || 'audio/webm' }) : null;
          const secs = Math.round((Date.now() - p.started) / 1000);
          cleanup();
          p.done?.({ blob, captions: p.finalText.trim(), seconds: secs });
        };
        p.rec.start(1000);
      } catch {
        setError('The microphone is blocked. Allow it in the browser, or type your answer.');
        if (!p.sr) return;
      }
    } else if (!p.sr) { setError('Voice input is not available in this browser. Type your answer.'); return; }
    p.started = Date.now();
    setRecording(true);
    p.timer = window.setInterval(() => {
      const s = Math.round((Date.now() - p.started) / 1000);
      setSeconds(s);
      if (s >= maxSeconds) p.rec?.state === 'recording' ? p.rec.stop() : cleanup();
    }, 250);
  }, [maxSeconds]);

  // Stops and returns the best transcript: Whisper when it works, otherwise the live captions.
  const stop = useCallback(async (): Promise<{ text: string; seconds: number }> => {
    const p = parts.current;
    const out = await new Promise<{ blob: Blob | null; captions: string; seconds: number }>(resolve => {
      if (p.rec && p.rec.state === 'recording') { p.done = resolve; p.rec.stop(); }
      else { const secs = Math.round((Date.now() - p.started) / 1000); cleanup(); resolve({ blob: null, captions: p.finalText.trim(), seconds: secs }); }
    });
    if (out.blob && out.blob.size > 2000) {
      try { const { text } = await post('transcribe', { audio: await toB64(out.blob), mime: out.blob.type }); if (text?.trim()) return { text: text.trim(), seconds: out.seconds }; }
      catch (err) { setError(`${(err as Error).message} Using live captions instead.`); }
    }
    return { text: out.captions || captions, seconds: out.seconds };
  }, [captions]);

  useEffect(() => () => cleanup(), []);
  return { recording, seconds, captions, error, analyser, start, stop };
}

// Speaks a line. Resolves when finished. `onLevel` receives 0..1 loudness for the orb.
let current: { stop: () => void } | null = null;
export function stopSpeaking() { current?.stop(); current = null; window.speechSynthesis?.cancel(); }
export async function speak(text: string, onLevel?: (v: number) => void): Promise<void> {
  stopSpeaking();
  let res: { audio?: string; mime?: string } = {};
  try { res = await post('tts', { text }); } catch { /* fall back to the browser */ }
  if (res.audio) {
    return new Promise(resolve => {
      const audio = new Audio(`data:${res.mime};base64,${res.audio}`);
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(audio);
      const an = ctx.createAnalyser(); an.fftSize = 128; src.connect(an); an.connect(ctx.destination);
      const data = new Uint8Array(an.frequencyBinCount);
      let raf = 0;
      const tick = () => { an.getByteFrequencyData(data); onLevel?.(data.reduce((a, b) => a + b, 0) / data.length / 140); raf = requestAnimationFrame(tick); };
      const end = () => { cancelAnimationFrame(raf); onLevel?.(0); ctx.close().catch(() => {}); resolve(); };
      current = { stop: () => { audio.pause(); end(); } };
      audio.onended = end; audio.onerror = end;
      audio.play().then(tick).catch(end);
    });
  }
  const synth = window.speechSynthesis;
  if (!synth) return;
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    u.voice = voices.find(v => /en-IN/i.test(v.lang)) ?? voices.find(v => /Google UK English Male|Daniel|en-GB/i.test(`${v.name} ${v.lang}`)) ?? voices.find(v => /^en/i.test(v.lang)) ?? null;
    u.rate = 1.02; u.pitch = 1;
    let pulse = 0;
    const timer = window.setInterval(() => { pulse = 0.25 + Math.random() * 0.6; onLevel?.(pulse); }, 120);
    const end = () => { clearInterval(timer); onLevel?.(0); resolve(); };
    u.onend = end; u.onerror = end;
    current = { stop: () => { synth.cancel(); end(); } };
    synth.speak(u);
  });
}
