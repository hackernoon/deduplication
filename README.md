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

## Growing the site automatically
.github/workflows/daily-terms.yml runs every morning:
1. `node scripts/discover.mjs` scans yesterday's 1,000 most-read Wikipedia articles, a rotating slice of tech-titled articles
   ("X (language model)", "X (software)"…), Hacker News front-page names, Google Trends, discovery/seeds.txt and yesterday's runners-up.
   For each word it finds every Wikipedia article titled with exactly that word and keeps a pair only if both meanings get
   15K+ pageviews a year, neither has won (duplicate share 5–95%), and it isn't a person, tragedy, election or franchise-vs-adaptation.
   Claude then judges each survivor and writes the row in house style; only editor scores of 7/10+ are published, max 10/day.
2. `node scripts/enrich.mjs` adds three extra sources per meaning into src/enrich.json: the official website's own one-sentence description, the first recorded date on Wikidata (plus IMDb/TMDB links), and the earliest HackerNoon story (needs HN_SEARCH_APP / HN_SEARCH_KEY / HN_SEARCH_INDEX secrets).
3. `node scripts/refresh-data.mjs` bakes Wikipedia pageviews into src/data.json for any term without data (same format as sync.js).
   On the 2nd of each month it re-collects every term (`--all`).
3. Missing social cards are generated, the build is checked, and a PR opens (or it pushes to main if the AUTO_PUBLISH variable is "true").

Setup: add the ANTHROPIC_API_KEY secret. Optional variables: AUTO_PUBLISH, DAILY_LIMIT, MIN_QUALITY, ANTHROPIC_MODEL.
Want a specific word tried? Add it to discovery/seeds.txt. Every run writes discovery/log/DATE.json (what passed, what didn't and why).
Try it locally without publishing: `node scripts/discover.mjs --dry-run`.
