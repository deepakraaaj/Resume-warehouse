/** Midnight base, glass panels, aurora accents: violet (focus), teal (progress), amber (next action). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: { 950: '#070A14', 900: '#0B1020', 850: '#0F1529', 800: '#141B33', 700: '#1E2745' },
        ink: { DEFAULT: '#E8ECF8', 2: '#A3ACC7', 3: '#6B7494' },
        violet: { DEFAULT: '#8B7CFF', soft: '#8B7CFF26' },
        teal: { DEFAULT: '#2DD4BF', soft: '#2DD4BF22' },
        amber: { DEFAULT: '#FFB547', soft: '#FFB54724' },
        rose: { DEFAULT: '#FB7185', soft: '#FB718524' },
      },
      fontFamily: {
        display: ['Sora', 'Manrope', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { xl2: '1.25rem' },
      boxShadow: { glow: '0 0 0 1px rgba(139,124,255,.25), 0 10px 40px -10px rgba(139,124,255,.45)', amber: '0 10px 40px -12px rgba(255,181,71,.55)' },
    },
  },
  plugins: [],
};
