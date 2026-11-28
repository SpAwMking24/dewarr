from app.domain.series_identity import series_note_agrees, title_is_series_name

SERIES = [{"name": "The Oregon Files", "position": "12"}]


def test_series_only_title_tag_is_neutral():
    assert title_is_series_name("oregon files", SERIES)
    assert title_is_series_name("The Oregon Files", SERIES)
    assert not title_is_series_name("typhoon fury", SERIES)
    assert not title_is_series_name("oregon files", [])


def test_series_note_is_case_insensitive():
    assert series_note_agrees("oregon files 12", SERIES)
