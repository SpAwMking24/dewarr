"""Typo-tolerant smart search inspired by Narratarr.

Queries Apple's public iTunes audiobook search API in parallel with catalog
search to detect and correct misspelled titles or author names, then ranks
merged results by fuzzy similarity.
"""

from __future__ import annotations

import re
import time
import unicodedata
from difflib import SequenceMatcher

import httpx

ITUNES_SEARCH_URL = "https://itunes.apple.com/search"
_CACHE_TTL_SECONDS = 600
_CACHE_MAX_ENTRIES = 300
_cache: dict[str, tuple[float, list[dict[str, str]]]] = {}

_STOPWORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "of",
        "and",
        "by",
        "in",
        "on",
        "to",
        "for",
        "with",
        "at",
        "or",
        "de",
        "la",
        "le",
    }
)
_IDENTIFIER_RE = re.compile(
    r"^(?:(?:97[89])?[\d-]{10,17}[xX]?|B0[A-Z0-9]{8}|(?:hardcover|openlibrary|audible):\S+)$",
    re.I,
)


def is_identifier_query(query: str) -> bool:
    return bool(_IDENTIFIER_RE.fullmatch(query.strip()))


def normalize(value: str) -> str:
    value = re.sub(r"['\u2019]", "", value)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^\w\s]", " ", value.lower())
    return " ".join(value.split())


def clean_title(title: str) -> str:
    """'Mistborn: The Final Empire (Unabridged) [Dramatized]' -> 'Mistborn: The Final Empire'."""
    title = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]", "", title)
    return " ".join(title.split())


def _content(value: str) -> str:
    words = [w for w in value.split() if w not in _STOPWORDS]
    return " ".join(words) or value


def fuzzy_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio() * 100.0


def token_set_ratio(a: str, b: str) -> float:
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    inter = sorted(ta & tb)
    diff_a = sorted(ta - tb)
    diff_b = sorted(tb - ta)
    s_inter = " ".join(inter)
    s_a = " ".join(inter + diff_a)
    s_b = " ".join(inter + diff_b)
    return max(
        fuzzy_ratio(s_inter, s_a) if s_inter else 0.0,
        fuzzy_ratio(s_inter, s_b) if s_inter else 0.0,
        fuzzy_ratio(s_a, s_b),
    )


def partial_ratio(short: str, long: str) -> float:
    if not short or not long:
        return 0.0
    if len(short) > len(long):
        short, long = long, short
    if short in long:
        return 100.0
    m = len(short)
    best = 0.0
    matcher = SequenceMatcher(None, short, long)
    for block in matcher.get_matching_blocks():
        start = max(0, block.b - block.a)
        window = long[start : start + m]
        if window:
            score = SequenceMatcher(None, short, window).ratio() * 100.0
            if score > best:
                best = score
    return best


def score_book(query: str, title: str, authors: list[str] | None = None) -> float:
    """Fuzzy relevance score for ranking merged literal + corrected catalog results."""
    q = _content(normalize(query))
    t = _content(normalize(clean_title(title)))
    a = _content(normalize(" ".join(authors or [])))
    if not q:
        return 0.0
    both = f"{t} {a}".strip()
    s = max(
        token_set_ratio(q, both),
        partial_ratio(q, t) if len(q) >= 4 else 0.0,
        fuzzy_ratio(q, t),
    )
    if q in both:
        s += 10.0
    if q == t:
        s += 15.0
    elif t.startswith(q):
        s += 5.0
    return float(s)


def _cache_get(key: str) -> list[dict[str, str]] | None:
    entry = _cache.get(key)
    if not entry:
        return None
    expires_at, data = entry
    if time.monotonic() > expires_at:
        _cache.pop(key, None)
        return None
    return data


def _cache_set(key: str, value: list[dict[str, str]]) -> None:
    if len(_cache) >= _CACHE_MAX_ENTRIES:
        now = time.monotonic()
        stale = [k for k, (exp, _) in _cache.items() if exp <= now]
        for k in stale[:50]:
            _cache.pop(k, None)
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            _cache.pop(next(iter(_cache)), None)
    _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


async def apple_suggestions(
    query: str,
    limit: int = 8,
    client: httpx.AsyncClient | None = None,
) -> list[dict[str, str]]:
    """Fetch typo-tolerant title/author suggestions from Apple's public audiobook search API."""
    norm = normalize(query)
    if len(norm) < 3 or is_identifier_query(query):
        return []
    key = f"{norm}:{limit}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    params = {"term": query.strip(), "media": "audiobook", "limit": limit * 2}
    try:
        if client is not None:
            resp = await client.get(ITUNES_SEARCH_URL, params=params)
        else:
            async with httpx.AsyncClient(timeout=3.5) as http:
                resp = await http.get(ITUNES_SEARCH_URL, params=params)
        resp.raise_for_status()
        results = resp.json().get("results", [])
    except (httpx.HTTPError, ValueError, TimeoutError):
        return []

    out: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for row in results:
        raw_title = row.get("collectionName") or ""
        if re.search(r"\b(summary|analysis|study guide)\b", raw_title, re.I):
            continue
        title = clean_title(raw_title)
        author = (row.get("artistName") or "").strip()
        sig = (normalize(title), normalize(author))
        if not title or sig in seen:
            continue
        seen.add(sig)
        out.append({"title": title, "author": author})
        if len(out) >= limit:
            break

    _cache_set(key, out)
    return out


def correct_words(query: str, suggestions: list[dict[str, str]]) -> str:
    """Fix misspelled words in query using vocabulary from top Apple suggestions."""
    vocab = {
        w
        for sg in suggestions[:5]
        for w in normalize(f"{sg.get('title', '')} {sg.get('author', '')}").split()
        if len(w) > 2
    }
    if not vocab:
        return normalize(query)
    fixed: list[str] = []
    for word in normalize(query).split():
        if word in vocab or len(word) <= 2:
            fixed.append(word)
            continue
        best = max(vocab, key=lambda v: fuzzy_ratio(word, v), default="")
        fixed.append(best if best and fuzzy_ratio(word, best) >= 75.0 else word)
    return " ".join(fixed)


def corrected_query(query: str, suggestions: list[dict[str, str]]) -> str | None:
    """Return a corrected query string when typos were fixed, else None."""
    if not suggestions:
        return None
    original = normalize(query)
    fixed = correct_words(query, suggestions)
    if fixed and fixed != original:
        return fixed
    return None
