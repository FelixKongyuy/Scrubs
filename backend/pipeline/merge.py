"""
Combine the findings from rules (Presidio), GLiNER and the BC lexicon into one clean list.

Policy: keep EVERYTHING any layer found (a miss is a leak; an extra flag is one click),
except words on the never-redact list. When two findings overlap, join them into one span.
"""
import re

import config


def _is_medical_term(span_text: str) -> bool:
    # "Parkinson's" / "Foley" etc. look like names to a model, but they're clinical terms. The same
    # list holds abbreviations and tech terms, so "Gemini API" (every word on it) is dropped too.
    # Word processors and PDFs write a curly apostrophe (Bell’s); treat it like a straight one.
    words = re.findall(r"[\w'.]+", span_text.lower().replace("’", "'"))
    words = [w.strip(".") for w in words if w.strip(".")]
    return bool(words) and all(w in config.NEVER_REDACT for w in words)


_WORD = re.compile(r"[A-Za-z][\w'’.-]*")
_BULLETS = set("•▪●◦‣∙·*|")


def _check_name_guess(text: str, span: dict) -> dict | None:
    """
    spaCy's PERSON is a guess from capital letters, so on resumes, forms and letters it often lands
    on organizations, products and headings. Returns the span to keep, a corrected one, or None.
      - next to an organization word ("Simon Fraser University", "University of Victoria"):
        widen it and make it an Organization (MED), not a locked name
      - a bullet, a digit or a word no name contains ("Website", "Project"): not a name, drop it
    Only Presidio's guesses are checked. GLiNER reads context, so its names are trusted.
    """
    if span["source"] != "rules" or span["type"] != "PERSON":
        return span
    found = text[span["start"]:span["end"]]
    after = re.match(r"[ \t]+([A-Za-z.]+)", text[span["end"]:span["end"] + 40])
    if after and after.group(1).lower().strip(".") in config.ORG_WORDS:
        end = span["end"] + after.end()
        # "Simon Fraser University of Technology": keep the whole name
        tail = re.match(r"[ \t]+of[ \t]+((?:[A-Z][\w'’-]*[ \t]?)+)", text[end:end + 60])
        if tail:
            end += len(tail.group(0).rstrip())
        return {**span, "end": end, "type": "ORGNAME"}
    before = re.search(r"([A-Za-z]+)[ \t]+of[ \t]+(?:the[ \t]+)?$", text[max(0, span["start"] - 40):span["start"]])
    if before and before.group(1).lower() in config.ORG_WORDS:
        return {**span, "start": span["start"] - len(before.group(0)), "type": "ORGNAME"}
    words = [w.lower().strip(".") for w in _WORD.findall(found)]
    if any(ch in _BULLETS or ch.isdigit() for ch in found) or any(w in config.NOT_NAME_WORDS for w in words):
        return None
    return span


def normalize_phrase(value: str) -> str:
    """How never-mask entries and flag text are compared: case, spacing and edge punctuation ignored."""
    return re.sub(r"\s+", " ", value.replace("’", "'")).strip().strip(".,;:!?\"'()[]").lower()


def never_mask_set() -> set[str]:
    return {normalize_phrase(w) for w in config.NEVER_MASK if normalize_phrase(w)}


def is_never_mask(span_text: str, words: set[str] | None = None) -> bool:
    """True if the user put this exact word or phrase on their never-mask list (Settings)."""
    words = never_mask_set() if words is None else words
    return bool(words) and normalize_phrase(span_text) in words


def _fully_covered(text: str, span: dict, others: list[dict]) -> bool:
    """True if every word inside `span` sits inside at least one of `others`."""
    for w in re.finditer(r"\S+", text[span["start"]:span["end"]]):
        ws, we = span["start"] + w.start(), span["start"] + w.end()
        if not any(o["start"] <= ws and we <= o["end"] for o in others):
            return False
    return bool(others)


def _overlaps(a: dict, b: dict) -> bool:
    return a["start"] < b["end"] and b["start"] < a["end"]


_TIER_RANK = {"high": 2, "med": 1, "low": 0}


def _tier_rank(span: dict) -> int:
    # Unknown types count as MED, the same way risk.py treats them.
    return _TIER_RANK[config.TYPES.get(span["type"], ("", "med", ""))[1]]


def _priority(span: dict) -> tuple[int, int]:
    """
    (tier, source). The MOST PROTECTIVE type wins first: if any detector says an overlapping
    span is HIGH (a name, an MRN), it stays HIGH even if another calls it a drug or a relative.
    Otherwise a clinical label from GLiNER could unmask an identifier ("MRN 4482913" -> Drug).
    """
    if span["source"] == "rules" and span["type"] in config.STRUCTURED_TYPES:
        source = 3   # pattern/checksum match
    elif span["source"] == "gliner":
        source = 2   # specialist model, understands context
    elif span["source"] == "lexicon":
        source = 1   # exact match against our BC list, but blind to context
    else:
        source = 0   # Presidio's general-purpose PERSON guess
    return _tier_rank(span), source


def merge(text: str, rule_spans: list[dict], model_spans: list[dict],
          lexicon_spans: list[dict] | None = None) -> list[dict]:
    lexicon_spans = lexicon_spans or []

    # Ambiguous lexicon hits ("Hope", "Golden", "Nelson", "judge") are also everyday words or
    # names, so on their own they'd flag "Hope she improves". Keep them ONLY if GLiNER, which
    # understands context, flagged the same place too. Non-ambiguous hits ("Tofino",
    # "bush pilot") are always kept: that's the lexicon's whole job.
    lexicon_spans = [l for l in lexicon_spans
                     if not l.get("ambiguous") or any(_overlaps(l, g) for g in model_spans)]

    never = never_mask_set()
    rule_spans = [c for c in (_check_name_guess(text, s) for s in rule_spans) if c is not None]
    spans = [s for s in rule_spans + model_spans + lexicon_spans
             if not _is_medical_term(text[s["start"]:s["end"]])
             and not is_never_mask(text[s["start"]:s["end"]], never)]

    # If Presidio's spaCy guessed a PERSON (e.g. "Daughter Claire") and GLiNER already covers
    # every word of it with finer spans ("Daughter" = RELATION, "Claire" = PERSON), keep GLiNER's
    # version so the clinician sees two precise flags instead of one blurry one.
    # If GLiNER missed any word, we keep Presidio's span: a miss is a leak.
    # Same idea for the lexicon: spaCy's "bush" is dropped when the lexicon matched "bush pilot".
    # EXCEPT when the only thing covering the name is a family/description span with no name in
    # it: GLiNER called the patient "Mrs. Eleanor Park" a family member, and dropping spaCy's
    # PERSON there turned a locked HIGH name into an unlockable MED flag.
    precise = [s for s in spans if s["source"] in ("gliner", "lexicon")]

    def _replaced_by_precise(s: dict) -> bool:
        if not _fully_covered(text, s, precise):
            return False
        covering = [o for o in precise if _overlaps(o, s)]
        has_name = any(o["type"] in ("PERSON", "PROVIDER") for o in covering)
        only_about_a_person = all(o["type"] in ("RELATION", "DESC") for o in covering)
        return has_name or not only_about_a_person

    spans = [s for s in spans
             if not (s["source"] == "rules" and s["type"] == "PERSON" and _replaced_by_precise(s))]

    # Sort by start position; if two start together, the longer one comes first.
    spans.sort(key=lambda s: (s["start"], -(s["end"] - s["start"])))

    merged: list[dict] = []
    for s in spans:
        if merged and s["start"] < merged[-1]["end"]:          # overlaps the previous span
            m = merged[-1]
            m["end"] = max(m["end"], s["end"])                 # grow to cover both
            # Who decides the TYPE of the combined span?
            #   0. The higher tier (HIGH > MED > LOW) always wins: never unmask by merging.
            #   Within a tier:
            #   1. A structured rule (PHN checksum, MRN, phone pattern...) beats any guess.
            #   2. Then GLiNER (context-aware specialist).
            #   3. Then the lexicon (exact BC list match).
            #   4. Then Presidio's spaCy PERSON guess. Ties: higher score wins.
            if _priority(s) > _priority(m) or (_priority(s) == _priority(m) and s["score"] > m["score"]):
                m.update(type=s["type"], source=s["source"], score=s["score"])
            m["found_by"] = sorted(set(m["found_by"]) | {s["source"]})
        else:
            merged.append({**s, "found_by": [s["source"]]})

    # Two findings can join into a phrase the user put on the never-mask list: drop it too.
    merged = [m for m in merged if not is_never_mask(text[m["start"]:m["end"]], never)]

    # A detector often catches only the first copy of a repeated value ("Felix Kongyuy" twice on an
    # invoice line). Flag every other exact copy too, so Review shows all of them.
    extra: list[dict] = []
    for m in list(merged):
        value = text[m["start"]:m["end"]]
        # HIGH only: a repeated name or number is the same thing; a repeated "Hope" may not be.
        if _tier_rank(m) < 2 or len(value.strip()) < config.MIN_REPEAT_CHARS:
            continue
        for occ in re.finditer(r"(?<!\w)" + re.escape(value) + r"(?!\w)", text):
            s, e = occ.start(), occ.end()
            if not any(o["start"] < e and s < o["end"] for o in merged + extra):
                extra.append({**m, "start": s, "end": e, "found_by": list(m["found_by"])})
    if extra:
        merged = sorted(merged + extra, key=lambda s: s["start"])

    # Give each span an id (the frontend uses it for approve/reject) and its text.
    for i, m in enumerate(merged):
        m["id"] = i
        m["text"] = text[m["start"]:m["end"]]
        m.pop("ambiguous", None)                               # internal detail, not for the UI
    return merged
