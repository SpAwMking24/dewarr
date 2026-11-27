from types import SimpleNamespace as NS

from app.importing.automatic import relevant_groups


def group(key, path, title=None, authors=None):
    return NS(key=key, medium="ebook", title=title, files=[NS(path=path)]), {
        path: {"metadata": {"title": title, "authors": authors or []}, "sha256": key}
    }


def test_same_title_different_author_keeps_requested_author():
    a, fa = group("a", "Onyx Storm - Rebecca Yarros.epub", "Onyx Storm", ["Rebecca Yarros"])
    b, fb = group("b", "Onyx Storm - Someone Else.epub", "Onyx Storm", ["Someone Else"])
    kept, skipped = relevant_groups([a, b], {**fa, **fb}, ["Onyx Storm"], ["Rebecca Yarros"])
    assert [g.key for g in kept] == ["a"]
    assert skipped[0]["paths"] == ["Someone Else - Onyx Storm.epub".replace("Someone Else - Onyx Storm", "Onyx Storm - Someone Else")]


def test_other_books_ignored_with_paths():
    a, fa = group("a", "Onyx Storm.epub", "Onyx Storm")
    b, fb = group("b", "Fourth Wing.epub", "Fourth Wing")
    kept, skipped = relevant_groups([a, b], {**fa, **fb}, ["Onyx Storm"], ["Rebecca Yarros"])
    assert [g.key for g in kept] == ["a"]
    assert skipped[0]["paths"] == ["Fourth Wing.epub"]
