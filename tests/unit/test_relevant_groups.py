from types import SimpleNamespace

from app.importing.automatic import relevant_groups


def group(key, *paths, title=None, medium="ebook"):
    return SimpleNamespace(
        key=key,
        title=title,
        medium=medium,
        files=[SimpleNamespace(path=path) for path in paths],
    )


def observed(*items):
    return {path: {"sha256": digest, "metadata": {}} for path, digest in items}


def test_other_books_are_ignored_and_duplicates_collapse():
    groups = [
        group("a", "Raise the Titanic! - Clive Cussler.epub"),
        group("b", "Raise the Titanic! - Clive Cussler_639131.epub"),
        group("c", "Sahara - Clive Cussler.epub"),
    ]
    files = observed(
        ("Raise the Titanic! - Clive Cussler.epub", "x"),
        ("Raise the Titanic! - Clive Cussler_639131.epub", "x"),
        ("Sahara - Clive Cussler.epub", "y"),
    )
    kept, skipped = relevant_groups(groups, files, ["Raise the Titanic!"])
    assert [g.key for g in kept] == ["a"]
    assert {item["group_key"] for item in skipped} == {"b", "c"}


def test_nothing_is_dropped_when_no_group_names_the_book():
    groups = [group("a", "One.epub"), group("b", "Two.epub")]
    files = observed(("One.epub", "1"), ("Two.epub", "2"))
    kept, skipped = relevant_groups(groups, files, ["Raise the Titanic!"])
    assert len(kept) == 2 and not skipped


def test_single_group_is_untouched():
    groups = [group("a", "Anything.epub")]
    kept, skipped = relevant_groups(groups, observed(("Anything.epub", "1")), ["Other"])
    assert kept == groups and not skipped
