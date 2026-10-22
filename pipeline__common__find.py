"""Find whole-word mentions of every term in a stream of text lines.

Rules: acronyms (all-caps, <=6 chars, e.g. MTS, GPU) match case-sensitively;
everything else matches case-insensitively. Each hit keeps the line plus a
little context. Per term we keep a uniform reservoir sample (default 2,000)
and an exact total count, so shares stay honest while compute stays small.
"""
import json, random, re
from pathlib import Path

TERMS_FILE = Path(__file__).resolve().parent.parent / "terms" / "terms.jsonl"

def load_terms():
    rows = [json.loads(l) for l in TERMS_FILE.read_text().splitlines() if l.strip()]
    words = {}
    for r in rows:
        words.setdefault(r["term"], []).append(r)
    return rows, words

def is_acronym(w):
    return w.isupper() and len(w) <= 6

def build_matchers(words):
    cs = [w for w in words if is_acronym(w)]
    ci = [w for w in words if not is_acronym(w)]
    def rx(ws, flags):
        if not ws: return None
        alt = "|".join(re.escape(w) for w in sorted(ws, key=len, reverse=True))
        return re.compile(r"(?<![\w-])(" + alt + r")(?![\w-])", flags)
    return rx(cs, 0), rx(ci, re.IGNORECASE), {w.lower(): w for w in ci}

def grep_patterns(words):
    """Plain list for a fast `grep -F` prefilter before Python."""
    return sorted(set(words))

class Finder:
    def __init__(self, cap=2000, seed=7):
        self.rows, self.words = load_terms()
        self.cs, self.ci, self.ci_map = build_matchers(self.words)
        self.cap, self.rng = cap, random.Random(seed)
        self.total = {w: 0 for w in self.words}
        self.sample = {w: [] for w in self.words}

    def _keep(self, word, item):
        self.total[word] += 1
        n, s = self.total[word], self.sample[word]
        if len(s) < self.cap: s.append(item)
        else:
            j = self.rng.randrange(n)
            if j < self.cap: s[j] = item

    def feed(self, text, meta, prev="", nxt=""):
        hits = set()
        if self.cs:
            hits |= {m.group(1) for m in self.cs.finditer(text)}
        if self.ci:
            hits |= {self.ci_map[m.group(1).lower()] for m in self.ci.finditer(text)}
        for w in hits:
            self._keep(w, {"term": w, "text": text[:600], "context": (prev[-300:] + " ⟨" + text[:600] + "⟩ " + nxt[:300]).strip(), **meta})
        return hits

    def dump(self, out_dir, source, shard):
        out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
        with open(out / f"mentions-{source}-{shard}.jsonl", "w") as f:
            for w, items in self.sample.items():
                for it in items: f.write(json.dumps(it, ensure_ascii=False) + "\n")
        (out / f"totals-{source}-{shard}.json").write_text(json.dumps(self.total))
