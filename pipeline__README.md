# hackernoon/deduplication — spoken-usage pipeline (WIP)

Finds mentions of each deduplication.tech term in free spoken datasets, labels which meaning (A = original, B = duplicate) each mention uses, publishes counts.

- terms/terms.jsonl — 632 term pairs exported from the site (`node build.mjs --terms-jsonl out.jsonl`)
- common/find.py — whole-word matcher (acronyms case-sensitive), exact totals + 2,000-per-term reservoir sample
- common/label.py — MiniLM embedding labeler (A / B / unsure, margin 0.03)
- common/hub.py — paced Hugging Face uploads with backoff (needs HF_TOKEN secret)
- TODO youtube/run.py — YODAS (espnet/yodas, CC BY 3.0): download only data/en*/text/*.json shards, feed lines to Finder; shard across a GitHub Actions matrix
- TODO tv-and-movies/run.py — OpenSubtitles v2018 English mono (OPUS): curl | zcat | grep -wF -f patterns → Finder. TEXT STAYS PRIVATE.
- TODO counts/aggregate.py — per term/source: share of B among labeled mentions → public counts dataset
- TODO .github/workflows — matrix jobs on public repo (free), upload every ~10 min

HF datasets: hackernoon/deduplication-youtube (public), hackernoon/deduplication-tv-and-movies (PRIVATE), hackernoon/deduplication-counts (public).
