import { motion } from 'framer-motion';

// The interviewer: a glowing orb that swells with the voice level (0..1) and breathes while listening.
export function Orb({ level = 0, listening = false, size = 168 }: { level?: number; listening?: boolean; size?: number }) {
  const scale = 1 + Math.min(1, level) * 0.18;
  return (
    <div className="relative grid place-items-center" style={{ width: size * 1.6, height: size * 1.6 }} aria-hidden>
      <motion.div className="absolute rounded-full" style={{ width: size * 1.5, height: size * 1.5, background: 'radial-gradient(circle, rgba(139,124,255,.35), transparent 65%)' }}
        animate={{ scale: listening ? [1, 1.06, 1] : scale * 1.05, opacity: level > 0.05 ? 1 : 0.6 }} transition={listening ? { repeat: Infinity, duration: 2.4 } : { duration: 0.12 }} />
      <motion.div className="rounded-full" style={{ width: size, height: size, background: 'conic-gradient(from 210deg, #8B7CFF, #2DD4BF, #FFB547, #8B7CFF)', boxShadow: '0 0 60px rgba(139,124,255,.55), inset 0 0 40px rgba(0,0,0,.35)' }}
        animate={{ scale, rotate: 360 }} transition={{ scale: { duration: 0.12 }, rotate: { repeat: Infinity, duration: 18, ease: 'linear' } }}>
        <div className="h-full w-full rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,.55), transparent 45%)' }} />
      </motion.div>
    </div>
  );
}
