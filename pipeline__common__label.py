"""Label each mention as definition A or B (or unsure) with a small free
embedding model on CPU. For each pair that uses the word, compare the
mention's context to "term: definition" for A and B."""
import json, sys
from pathlib import Path
import numpy as np
from sentence_transformers import SentenceTransformer

MODEL = "sentence-transformers/all-MiniLM-L6-v2"   # 22M params, fast on CPU
MARGIN = 0.03                                      # below this = unsure

def label_file(mentions_path, terms_rows, out_path, batch=256):
    model = SentenceTransformer(MODEL, device="cpu")
    pairs = {}
    for r in terms_rows: pairs.setdefault(r["term"], []).append(r)
    defs = {}
    for w, rs in pairs.items():
        for r in rs:
            a, b = model.encode([f"{w}: {r['a']['def']}", f"{w}: {r['b']['def']}"], normalize_embeddings=True)
            defs[r["key"]] = (a, b)
    items = [json.loads(l) for l in open(mentions_path)]
    with open(out_path, "w") as f:
        for i in range(0, len(items), batch):
            chunk = items[i:i+batch]
            embs = model.encode([c["context"] for c in chunk], normalize_embeddings=True, batch_size=64)
            for c, e in zip(chunk, embs):
                for r in pairs.get(c["term"], []):
                    a, b = defs[r["key"]]
                    sa, sb = float(e @ a), float(e @ b)
                    lab = "unsure" if abs(sa - sb) < MARGIN else ("a" if sa > sb else "b")
                    f.write(json.dumps({**c, "key": r["key"], "label": lab, "sa": round(sa, 4), "sb": round(sb, 4)}, ensure_ascii=False) + "\n")

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    from find import load_terms
    rows, _ = load_terms()
    label_file(sys.argv[1], rows, sys.argv[2])
