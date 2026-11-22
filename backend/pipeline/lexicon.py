"""
Layer 3: the BC lexicon (a list of known identifying phrases), matched LOCALLY.

The list is data/lexicon_seed.csv in the repo (PUBLIC data only: BC towns, BC facilities,
identifying occupations). It is read once from disk, so the pipeline works fully offline.

PRIVACY RULE: matching happens here, in this process's memory. Note text never leaves it.

Why a lexicon at all? GLiNER is good at context but scores some identifiers low
(e.g. "bush pilot" ~0.3). A curated list catches known risky phrases every time.
"""
import csv
import logging
import os
import re
from pathlib import Path

log = logging.getLogger("scrubin")

SEED_CSV = Path(__file__).resolve().parents[2] / "data" / "lexicon_seed.csv"

# "csv" = load data/lexicon_seed.csv.  "off" = no lexicon.
LEXICON_SOURCE = os.getenv("LEXICON_SOURCE", "csv").lower()

_entries: dict[str, dict] | None = None   # phrase -> {"type": ..., "ambiguous": bool}
_pattern: re.Pattern | None = None
source_used = None                         # "csv" | "off", handy for /health and the demo


def _load_from_csv() -> list[dict]:
    with open(SEED_CSV, newline="", encoding="utf-8") as f:
        return [{"phrase": r["phrase"], "type": r["type"], "ambiguous": r["ambiguous"] == "1"}
                for r in csv.DictReader(f)]


def load(force: bool = False) -> str:
    """Load the lexicon once (or again with force=True). Returns which source was used."""
    global _entries, _pattern, source_used
    if _entries is not None and not force:
        return source_used

    rows: list[dict] = []
    if LEXICON_SOURCE == "off":
        source_used = "off"
    else:
        rows, source_used = _load_from_csv(), "csv"

    _entries = {r["phrase"]: r for r in rows}
    # Forms and invoices often write places in capitals ("VANCOUVER"). Match those too, except for
    # ambiguous entries, which already need GLiNER to agree.
    for r in rows:
        upper = r["phrase"].upper()
        if not r["ambiguous"] and upper != r["phrase"] and len(upper) > 3:
            _entries.setdefault(upper, r)
    # One big regex, LONGEST phrases first, so "Tofino General Hospital" wins over "Tofino".
    # Case-sensitive on purpose: "Hope" (town) vs "hope" (word).
    # (?<!\w) / (?!\w) = whole words only, so "Trail" won't match inside "Trailer".
    if _entries:
        alternatives = "|".join(re.escape(p) for p in sorted(_entries, key=len, reverse=True))
        _pattern = re.compile(rf"(?<!\w)(?:{alternatives})(?!\w)")
    else:
        _pattern = None
    log.info("lexicon: %d entries loaded from %s", len(_entries), source_used)   # counts only
    return source_used


def find(text: str) -> list[dict]:
    """Return lexicon matches in the same span format as rules.find() / detector.detect()."""
    load()
    if _pattern is None:
        return []
    spans = []
    for m in _pattern.finditer(text):
        entry = _entries[m.group()]
        spans.append({
            "start": m.start(),
            "end": m.end(),
            "type": entry["type"],
            "text": m.group(),
            "score": 1.0,                       # exact list match
            "source": "lexicon",
            # Ambiguous = also a common word or name (Hope, Golden, Nelson...).
            # merge.py only keeps these if GLiNER flagged the same place too.
            "ambiguous": entry["ambiguous"],
        })
    return spans
