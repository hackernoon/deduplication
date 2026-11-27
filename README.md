# deduplication.tech

Static site: one page per duplicated term at /term/{term}/{original}/{duplicate}/, field rankings at /field/{field}/, home with search + word cloud.

## Build
    node build.mjs            # writes dist/ (deploy this folder to Vercel or Cloudflare Pages)
    node build.mjs --preview  # single-file preview (preview/deduplication.html)

## Terms
- src/terms-100.txt, src/terms-200.txt — David's lists (mainstream vs tech definitions, Trends queries)
- src/terms.txt — the original curated list
- src/terms-600.txt — Nov 2026 batch (AI, alien/sci-fi, movie vs tech, media vs culture, economics vs IP), every pair pre-checked on Wikipedia
- src/terms-auto.txt — appended daily by the discovery bot (see below); edit or delete lines freely
Format: term|field|original label|wikipedia title|year|duplicate label|wikipedia title|year|note|original def|duplicate def|original Trends query|duplicate Trends query

## Data (no API keys needed)
- Live, in the visitor's browser on the deployed site: Wikipedia pageviews (Wikimedia REST), Hacker News (Algolia), Google Trends embed.
- Baked snapshot: put src/data.json (keyed by term/original/duplicate) and rebuild. scripts/collector.js produces it from a browser tab on trends.google.com.
  To refresh from a normal machine instead, run a Node script that calls the same endpoints (Wikipedia + HN work server-side; Google Trends rate-limits servers, so use a browser or a paid Trends API such as SerpApi).

## Growing the site: the editor queue
1. **Mondays — mine.** `scripts/mine-queue.mjs` starts from Wikipedia titles that already carry a qualifier ("Lean (proof assistant)", "Heat (1995 film)") plus a week of trending pages and words in discovery/seeds.txt, finds each word's strongest rival meaning, and keeps pairs where both get 15K+ pageviews a year and the newer one holds 5–95%. Results go to discovery/queue.json as *pending* (target 1,000).
2. **Automatic review, no AI.** `scripts/review-queue.mjs` auto-accepts only clear, high-traffic fights: each meaning 50K+ Wikipedia views/yr, 300K+ combined, newer meaning 15–85%, word not already on the site, the two not the same kind of thing or the same family on Wikidata, and no people. Same-family or people → auto-rejected. Everything else is held and never publishes unless an admin accepts it. Tune with MIN_VIEWS_EACH / MIN_VIEWS_TOTAL repo variables.
3. **Admin at deduplication.tech/admin** (GitHub fine-grained token with Contents read/write on this repo). Queue tabs (held, publishing queue, rejected, published) plus **Live terms**: edit any field of a published term or remove it (removed words go to discovery/blocklist.txt so they're never re-suggested). Every live term page shows an **Edit** button to browsers signed in at /admin.
4. **Daily — publish.** `scripts/publish-queue.mjs` turns the next DAILY_LIMIT (default 50) accepted terms into rows in src/terms-auto.txt (original = the meaning Wikidata dates earlier), then the workflow validates them on Wikipedia, bakes pageviews (`refresh-data.mjs`), adds sources (`enrich.mjs`), makes social cards and pushes to main.
5. **Monthly — refresh** every term's pageviews and sources.

Run any step by hand: Actions → daily-terms → Run workflow → publish / mine / refresh-all.
Optional secrets: HN_SEARCH_APP/KEY/INDEX (earliest HackerNoon story). No AI API is used.
