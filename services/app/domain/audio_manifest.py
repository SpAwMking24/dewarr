"""Conservative track-name evidence before downloaded metadata is available."""

import re

from app.domain.catalog_titles import parse_title_labels
from app.domain.title_matching import compatible_title, exact_title_key

TRACK = re.compile(
    r"(?:(?:disc|cd|part)\s*(\d{1,4})(?:\s+|(?=track|chapter)))?"
    r"(?:(?:track|chapter)\s*)?(\d{1,4})"
)


def numbered_positions(stems, title=""):
    """Return unique disc/track positions established by numbered names.

    Accept equivalent title spellings, not other book titles or arbitrary suffixes.
    Completeness still requires inspection of the downloaded recording.
    """
    title_key = exact_title_key(title)
    prefixes = [title_key + " "] if title_key else []
    if title_key and not title_key.startswith("the "):
        prefixes.append("the " + title_key + " ")
    prefixes.append("")
    positions, seen = [], set()
    for stem in stems:
        key = exact_title_key(stem)
        prefix = next((value for value in prefixes if key.startswith(value)), "")
        name = key[len(prefix):]
        match = TRACK.fullmatch(name)
        if not match:
            return []
        position = (int(match[1] or 1), int(match[2]))
        if min(position) < 1 or position in seen:
            return []
        seen.add(position)
        positions.append(position)
    return positions


def distinct_numbered_tracks(stems, title):
    return bool(numbered_positions(stems, title))


def single_part_name(stem, title):
    """Explicit chapter/part evidence, excluding a book whose actual title matches."""
    return not compatible_title(stem, title) and bool(
        parse_title_labels(stem).part
        or re.fullmatch(
            r"(?:chapter|track|part|disc|cd)\s*\d{1,4}",
            exact_title_key(stem).removeprefix(exact_title_key(title) + " "),
        )
    )
