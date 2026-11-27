from datetime import UTC, datetime

from app.adapters.prowlarr import ProwlarrRelease
from app.domain.release_blocklist import release_keys
from app.domain.smart_search import (
    clean_title,
    correct_words,
    corrected_query,
    is_identifier_query,
    score_book,
)


def test_smart_search_corrects_typos_from_suggestions():
    suggestions = [
        {"title": "Project Hail Mary", "author": "Andy Weir"},
        {"title": "The Martian", "author": "Andy Weir"},
    ]
    assert correct_words("projct hail marry", suggestions) == "project hail mary"
    assert corrected_query("projct hail marry", suggestions) == "project hail mary"
    assert corrected_query("Project Hail Mary", suggestions) is None


def test_smart_search_author_and_title_typo():
    suggestions = [
        {"title": "Mistborn: The Final Empire", "author": "Brandon Sanderson"},
    ]
    assert (
        corrected_query("brandon sandersen mistborn", suggestions)
        == "brandon sanderson mistborn"
    )


def test_smart_search_skips_identifiers_and_cleans_titles():
    assert is_identifier_query("9780593135204")
    assert is_identifier_query("B08G9PRS1K")
    assert is_identifier_query("hardcover:12345")
    assert not is_identifier_query("projct hail marry")
    assert clean_title("Mistborn: The Final Empire (Unabridged) [Dramatized]") == (
        "Mistborn: The Final Empire"
    )


def test_smart_search_scores_exact_match_above_distant_match():
    exact = score_book("project hail mary", "Project Hail Mary", ["Andy Weir"])
    distant = score_book("project hail mary", "Hail to the Chief", ["Someone Else"])
    assert exact > distant
    assert exact >= 100.0


def test_cross_indexer_infohash_avoidance_matches_without_descriptor():
    shared_hash = "a" * 40
    indexer_a = ProwlarrRelease(
        source_id="101",
        indexer_id="1",
        indexer_name="Indexer A",
        title="Project Hail Mary [M4B]",
        raw_title="Project Hail Mary [M4B]",
        medium="audio",
        categories=[3030],
        protocol="torrent",
        observed_at=datetime.now(UTC),
        acquisition_supported=True,
        details={"infohash_v1": shared_hash},
    )
    indexer_b = ProwlarrRelease(
        source_id="999",
        indexer_id="2",
        indexer_name="Indexer B",
        title="Project Hail Mary - Andy Weir (M4B)",
        raw_title="Project Hail Mary - Andy Weir (M4B)",
        medium="audio",
        categories=[3030],
        protocol="torrent",
        observed_at=datetime.now(UTC),
        acquisition_supported=True,
        details={"infohash_v1": shared_hash.upper()},
    )
    _, keys_a = release_keys(indexer_a)
    _, keys_b = release_keys(indexer_b)
    assert f"infohash_v1:{shared_hash}" in keys_a
    assert f"infohash_v1:{shared_hash}" in keys_b
    assert set(keys_a).intersection(keys_b) == {f"infohash_v1:{shared_hash}"}
