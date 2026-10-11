// House rules from .agents/AGENTS.md. Shared by the dashboard UI, the local server and the build script.

export const A4_HEIGHT_PT = 841.89;

export const LIMITS = {
  spareMin: 35,
  spareMax: 60,
  marginDelta: 2.5,
};

const CONTACT = [
  { label: 'Email', needle: 'deepakrajbm@zohomail.in' },
  { label: 'Phone', digits: '919500756675' },
  { label: 'Portfolio link', needle: 'deepakrajb.vercel.app' },
  { label: 'LinkedIn link', needle: 'linkedin.com/in/deepakrajbm' },
  { label: 'GitHub link', needle: 'github.com/deepakraaaj' },
];

const BUZZWORDS = [
  'agentic', 'groundbreaking', 'seamlessly', 'spearheaded',
  'game-changer', 'synergy', 'paradigm', 'transformative',
];

function excerpt(text, index, length = 1) {
  const start = Math.max(0, index - 28);
  const end = Math.min(text.length, index + length + 28);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).trim()}${end < text.length ? '...' : ''}`;
}

// `html` is the full source (for CSS and link checks); `text` is the visible text only.
export function lint(html, text) {
  const issues = [];
  const flat = text.replace(/\s+/g, ' ');
  const source = html.toLowerCase();

  for (const m of flat.matchAll(/[–—]/g)) {
    issues.push({ kind: 'writing', message: 'Long dash. Use a plain hyphen.', excerpt: excerpt(flat, m.index) });
  }
  for (const m of flat.matchAll(/\p{Extended_Pictographic}/gu)) {
    issues.push({ kind: 'writing', message: 'Emoji. Use a text label instead.', excerpt: excerpt(flat, m.index, m[0].length) });
  }
  for (const word of BUZZWORDS) {
    for (const m of flat.matchAll(new RegExp(`\\b${word}\\b`, 'gi'))) {
      issues.push({ kind: 'writing', message: `"${m[0]}" is on the banned word list. Describe the concrete outcome.`, excerpt: excerpt(flat, m.index, m[0].length) });
    }
  }
  if (/\.page\s*\{[^}]*[^-]width\s*:\s*210mm/i.test(html)) {
    issues.push({ kind: 'layout', message: '.page uses width: 210mm, which skews the margins. Use width: 100%.' });
  }

  const digits = flat.replace(/\D/g, '');
  for (const c of CONTACT) {
    const found = c.digits ? digits.includes(c.digits) : source.includes(c.needle);
    if (!found) issues.push({ kind: 'contact', message: `${c.label} is missing or out of date.` });
  }

  return issues.slice(0, 30);
}
