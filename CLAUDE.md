# CLAUDE.md — Ma Première App

## Project Overview

**Ma Première App** is a minimal, French-language "Hello World" static web application. It serves as a beginner's first web project and consists of a single self-contained HTML file with no build tooling, dependencies, or framework.

- **Language:** French (UI text and comments are in French)
- **Stack:** Vanilla HTML5, CSS3, JavaScript — zero dependencies
- **Entry point:** `index.html` (the only source file)

---

## Repository Structure

```
ma-premiere-app/
├── index.html     # The entire application (HTML + CSS + JS in one file)
├── README.md      # Minimal project README
└── CLAUDE.md      # This file
```

---

## Architecture

Everything lives in `index.html`:

| Section | Description |
|---|---|
| `<head>` | Meta tags, Google Fonts imports, all CSS (embedded `<style>`) |
| `<body>` | Page markup: `.container`, `.eyebrow`, `h1`, `.subtitle`, `.btn`, `.toast` |
| `<script>` | Single function `afficherMessage()` wired to the button's `onclick` |

### Design System (CSS custom properties)

Defined in `:root` inside `index.html:11-18`:

| Variable | Value | Usage |
|---|---|---|
| `--bg` | `#0f0e0c` | Page background |
| `--surface` | `#1a1916` | Card / toast background |
| `--accent` | `#e8c87a` | Gold highlight colour |
| `--accent-dim` | `#c4a452` | Hover state of accent |
| `--text` | `#f0ece3` | Primary text |
| `--muted` | `#7a7468` | Secondary / subdued text |

### Fonts (Google Fonts CDN)

- **Playfair Display 700** — headings (`h1`)
- **DM Sans 400/500** — body text, buttons, toasts

### Animations

All main elements animate in via `@keyframes fadeUp` (opacity 0→1, translateY 18px→0) with staggered delays (0.2s, 0.4s, 0.6s, 0.8s).

### Interactive behaviour

- Button click → `afficherMessage()` → adds `.show` class to `#toast`
- Toast auto-dismisses after 3 000 ms via `setTimeout`

---

## Development Workflow

There is no build step. To work on this project:

1. Open `index.html` directly in a browser, **or**
2. Serve it with any static file server, e.g.:
   ```bash
   npx serve .
   # or
   python3 -m http.server 8080
   ```

There are no tests, no linter config, and no package manager files.

---

## Conventions & Guidelines for AI Assistants

### Scope

- Keep the project as a **single `index.html`** file unless the user explicitly requests splitting it into separate CSS/JS files.
- Do not introduce a build tool (Webpack, Vite, etc.), framework (React, Vue, etc.), or package manager (`npm`, `yarn`) unless explicitly asked.
- Do not add a `package.json`, `.eslintrc`, or other config files speculatively.

### Language

- All user-visible strings must remain in **French**.
- Code comments may be in French or English — match the existing style (comments in `index.html` are in French, e.g. `/* Fond texturé / grain */`).

### Style

- Follow the existing dark-gold aesthetic; use the defined CSS custom properties (`--accent`, `--bg`, etc.) for any new colours rather than hardcoding hex values.
- Maintain the `clip-path` polygon style for `.btn` (the cut-corner shape is intentional branding).
- Preserve the staggered `fadeUp` animation pattern for any new top-level elements.

### Code quality

- Keep CSS and JS embedded in `index.html` (no external files) unless splitting is requested.
- Prefer CSS transitions/animations over JavaScript-driven animation when possible.
- JavaScript should remain vanilla — no jQuery or other helpers.

### Git

- Active development branch: `claude/claude-md-mm69djj8y46o9vm4-ZgW94`
- Base branch: `master`
- Write clear, imperative commit messages (e.g. `Add dark-mode toggle`, `Fix toast z-index on mobile`).

---

## Key File Reference

| File | Lines of interest |
|---|---|
| `index.html` | CSS variables: 11–18 |
| `index.html` | Button styles & clip-path: 87–131 |
| `index.html` | Toast styles: 133–154 |
| `index.html` | `fadeUp` keyframes: 156–159 |
| `index.html` | `afficherMessage()` function: 182–185 |
