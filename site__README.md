# deduplication.tech

Static site: one page per duplicated term at /term/{term}/{original}/{duplicate}/, field rankings at /field/{field}/, home with search + word cloud.

## Build
    node build.mjs            # writes dist/ (deploy this folder to Vercel or Cloudflare Pages)
    node build.mjs --preview  # single-file preview (preview/deduplication.html)

## Terms
- src/terms-100.txt, src/terms-200.txt — David's lists (mainstream vs tech definitions, Trends queries)
- src/terms.txt — the original curated list
Format: term|field|original label|wikipedia title|year|duplicate label|wikipedia title|year|note|original def|duplicate def|original Trends query|duplicate Trends query

## Data (no API keys needed)
- Live, in the visitor's browser on the deployed site: Wikipedia pageviews (Wikimedia REST), Hacker News (Algolia), Google Trends embed.
- Baked snapshot: put src/data.json (keyed by term/original/duplicate) and rebuild. scripts/collector.js produces it from a browser tab on trends.google.com.
  To refresh from a normal machine instead, run a Node script that calls the same endpoints (Wikipedia + HN work server-side; Google Trends rate-limits servers, so use a browser or a paid Trends API such as SerpApi).
