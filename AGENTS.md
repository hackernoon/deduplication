# deduplication.tech — rules for AI editors (Cursor, Claude, etc.)

This site is finished and live. Make small, targeted edits only.

## Never
- Never rewrite, restructure, or "modernize" the project.
- Never add a framework (Next.js, React, Astro, Tailwind, etc.), a bundler, or npm dependencies.
- Never rename or move files or folders.
- Never change the URL structure: /term/{term}/{original}/{duplicate}/
- Never delete terms or data from src/.

## How it works
- `node build.mjs` turns `src/` into static pages in `dist/` (about 720 pages). Vercel runs this on every push.
- `build.mjs` – page templates and text (home, term pages, field pages, About, Methodology, Privacy, Terms & Conditions).
- `src/app.js` – browser code (search, word cloud, charts). `src/app.css` – all styles and colours.
- `src/terms*.txt` – the term database, one per line:
  `term|cat|origLabel|origWiki|origYear|dupLabel|dupWiki|dupYear|note|origDef|dupDef|qA|qB`
- `src/data.json` – Wikipedia pageview data. Do not hand-edit.
- `src/og/` – social share images (one JPG per page). Regenerate after adding terms: see the top of `scripts/og-cards.mjs`. Pages without a card use `src/og/default.jpg`.
- `src/hn-tags.json` – HackerNoon tags verified to exist; used for the "On HackerNoon" links.
- Missing definitions are filled from Wikipedia's lead sentence at build time (set SKIP_WIKI=1 to skip).
- `dist/` and `preview/` are generated – never edit them.

## Workflow for every change
1. Change only the lines needed for the request.
2. Run `node build.mjs` and confirm it says "wrote N pages" (or more if terms were added) with no errors.
3. Show the diff and wait for approval before committing.
