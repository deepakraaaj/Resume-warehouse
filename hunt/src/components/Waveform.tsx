import { useEffect, useRef, type MutableRefObject } from 'react';

// Live mic waveform: rounded bars from the analyser's frequency data.
export function Waveform({ analyser, active }: { analyser: MutableRefObject<AnalyserNode | null>; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const bars = 48;
    const data = new Uint8Array(128);
    const draw = () => {
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio), h = (canvas.height = canvas.clientHeight * devicePixelRatio);
      ctx.clearRect(0, 0, w, h);
      const an = analyser.current;
      if (an) an.getByteFrequencyData(data);
      const gap = w / bars;
      for (let i = 0; i < bars; i++) {
        const v = an && active ? data[Math.floor((i / bars) * 64) + 2] / 255 : 0.04 + 0.03 * Math.sin(Date.now() / 400 + i / 3);
        const bh = Math.max(4 * devicePixelRatio, v * h * 0.9);
        const grad = ctx.createLinearGradient(0, h / 2 - bh / 2, 0, h / 2 + bh / 2);
        grad.addColorStop(0, '#8B7CFF'); grad.addColorStop(1, '#2DD4BF');
        ctx.fillStyle = grad;
        const x = i * gap + gap * 0.2, bw = gap * 0.6;
        ctx.beginPath(); ctx.roundRect(x, h / 2 - bh / 2, bw, bh, bw / 2); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);
  return <canvas ref={ref} className="h-20 w-full" aria-hidden />;
}
