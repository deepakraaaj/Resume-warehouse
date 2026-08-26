# Resume Generation & Styling Rules

## 1. Typography, Spacing & Layout
- **Letter & Line Spacing**: Maintain clear letter-spacing and generous line-height for enhanced readability.
- **Page Setup & Margins**: Use full-bleed `@page { size: A4; margin: 0; }` and control margins via `.page` padding (`padding: 18mm 20mm 16mm 20mm`).
- **No Long Dashes**: Never use en-dashes (`–`) or em-dashes (`—`). Always use standard hyphens (`-`) or clean separators like `|` or `,`.
- **No Emojis**: Never use emojis (such as ✉, ☎, ⌖, 🌐, 💻, 🔗) in any part of the resume. Use professional text labels and clean typography.

## 2. Standard Contact Information & Links
- **Portfolio**: https://deepakrajb.vercel.app/
- **LinkedIn**: https://www.linkedin.com/in/deepakrajbm/
- **GitHub**: https://github.com/deepakraaaj/
- **Email**: deepakrajbm@zohomail.in
- **Phone**: +91 95007 56675
- **Location**: Chennai, Tamil Nadu, India

## 3. Content Tone & Vocabulary
- **No AI Jargon / Buzzwords**: Avoid overused AI buzzwords and fluff phrasing such as *agentic*, *groundbreaking*, *seamlessly*, *spearheaded*, *game-changer*, *synergy*, *paradigm*, *transformative*, etc.
- **Employer-Friendly Engineering Tone**: Focus on direct, practical, and measurable engineering outcomes. Highlight technical architecture, framework usage, database optimization, API design, bug fixing, unit testing, and business impact.

---

## 4. Spacing & Layout Metrics Specification (Portable Reference)

### Page Setup
```css
@page { size: A4; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; }

.page {
  width: 100%;           /* NEVER hardcode "210mm" here — prevents asymmetric left/right margins */
  min-height: 100%;
  padding: 18mm 20mm 16mm 20mm;   /* top right bottom left margin equivalent */
}
```

### Font Size & Line Height Scale
- **Base Dense 1-Pager** (~3 experience blocks + skills + education): `body { font-size: 10.2pt – 10.6pt; line-height: 1.52 – 1.58; }`
- **Short Content**: `font-size: 10.8pt – 11pt; line-height: 1.6;`
- **Dense/Overflow Content**: `font-size: 10pt – 10.3pt; line-height: 1.5;`

### Spacing Scale
- `.section`: `margin-bottom: 11pt – 13pt;`
- `.section-title`: `margin-bottom: 7pt – 8pt; padding-bottom: 3pt – 4pt; border-bottom: 1pt – 1.4pt;`
- `.project-block`: `margin-top: 7pt – 9pt;`
- `.project-title`: `margin-bottom: 4.5pt – 5pt;`
- `li`: `padding-left: 12pt; margin-bottom: 4.5pt – 5.5pt; font-size: 9.8pt – 10.2pt; text-align: left;`
- `.skills-grid`: `display: grid; grid-template-columns: 1fr 1fr; gap: 6pt – 7pt 20pt – 24pt;`
- `.bottom-grid`: `display: grid; grid-template-columns: auto 1fr; gap: 26pt – 28pt;`

### Three Hard Rules
1. **Never hardcode `.page` width in mm** (`width: 210mm`). Use `width: 100%` inside `@page { size: A4; margin: 0; }` and control real margins via `.page` padding.
2. **Never pin a footer to bottom with `flex + margin-top: auto`**. Use normal `margin-top` on the footer.
3. **Only justify the profile/summary paragraph (`text-align: justify`)**. Bullet lists and all other text blocks stay `text-align: left`.

### Automated Verification Script
```python
import pdfplumber

with pdfplumber.open('resume.pdf') as pdf:
    print('pages:', len(pdf.pages))              # must be exactly 1
    page = pdf.pages[0]
    words = page.extract_words()
    left = min(w['x0'] for w in words)
    right = page.width - max(w['x1'] for w in words)
    bottom = max(w['bottom'] for w in words)
    print('left margin:', round(left, 2), ' right margin:', round(right, 2))   # within ~1pt of each other
    print('content bottom:', round(bottom, 2), '/', round(page.height, 2))      # leaves ~40-55pt trailing space
```

---

## 5. Directory Structure & File Organization
- **`HTML/`**: Stores all source HTML resume templates and markup files (e.g., `Deepakraj_*.html`, `test.html`). Always save new/modified resume HTML files here.
- **`PDF/`**: Stores all compiled/exported PDF resume files (e.g., `Deepakraj_*.pdf`).
- **`Archieve Resumes/`**: Historical and archived resume drafts (DOCX, PDF, HTML).
- **`Linkedin Banners/`**: Assets and HTML templates for LinkedIn banners and graphics.
- **`Portfolio/`**: Next.js portfolio website project codebase.
- **`Deeps/`**: Personal photos and reference assets.

