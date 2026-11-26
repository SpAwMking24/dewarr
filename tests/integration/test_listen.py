import pytest

from tests.integration.test_reader import _seed_local_ebook

pytestmark = pytest.mark.integration


async def test_listen_streams_ranges_and_saves_position(
    client, admin, database, tmp_path, monkeypatch
):
    from app.api import listen

    work_id, asset_id, data = await _seed_local_ebook(database, tmp_path, audio_only=True)
    monkeypatch.setattr(listen, "FALLBACK_ROOTS", (str(tmp_path / "ebooks"),))

    found = await client.get(f"/api/listen/works/{work_id}/audio")
    assert found.status_code == 200, found.text
    book = found.json()
    assert book["asset_id"] == str(asset_id)
    assert book["title"] == "Piranesi"
    assert len(book["tracks"]) == 1
    assert book["progress"] is None

    full = await client.get(f"/api/listen/assets/{asset_id}/tracks/0")
    assert full.status_code == 200
    assert full.headers["accept-ranges"] == "bytes"
    assert full.content == data

    part = await client.get(
        f"/api/listen/assets/{asset_id}/tracks/0", headers={"Range": "bytes=10-19"}
    )
    assert part.status_code == 206
    assert part.content == data[10:20]
    assert part.headers["content-range"] == f"bytes 10-19/{len(data)}"

    tail = await client.get(
        f"/api/listen/assets/{asset_id}/tracks/0", headers={"Range": "bytes=-5"}
    )
    assert tail.content == data[-5:]

    bad = await client.get(
        f"/api/listen/assets/{asset_id}/tracks/0", headers={"Range": f"bytes={len(data) + 5}-"}
    )
    assert bad.status_code == 416

    saved = await client.put(
        f"/api/listen/assets/{asset_id}/progress",
        json={"track": 0, "seconds": 123.4, "fraction": 0.25, "chapter": "Chapter 3"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["cfi"] == "track:0@123.4"

    again = await client.get(f"/api/listen/assets/{asset_id}")
    assert again.json()["progress"]["fraction"] == pytest.approx(0.25)


async def test_listen_rejects_ebook_assets(client, admin, database, tmp_path):
    _, asset_id, _ = await _seed_local_ebook(database, tmp_path)
    assert (await client.get(f"/api/listen/assets/{asset_id}")).status_code == 404


def test_search_by_name_finds_relocated_file(tmp_path):
    from services.app.api import listen

    (tmp_path / "Other" / "Book").mkdir(parents=True)
    (tmp_path / "Author" / "Book").mkdir(parents=True)
    (tmp_path / "Other" / "Book" / "a.mp3").write_bytes(b"x")
    (tmp_path / "Author" / "Book" / "a.mp3").write_bytes(b"x")
    found = listen._search_by_name([str(tmp_path)], "/nas/lib/Author/Book/a.mp3")
    assert found == (str(tmp_path), "Author/Book/a.mp3")
    assert listen._search_by_name([str(tmp_path)], "/x/missing.mp3") is None


def test_search_tolerates_renamed_single_file(tmp_path):
    from services.app.api import listen

    folder = tmp_path / "Elly Griffiths" / "A Dying Fall (2012)"
    folder.mkdir(parents=True)
    (folder / "A Dying Fall.mp3").write_bytes(b"x")
    found = listen._search_by_name(
        [str(tmp_path)],
        "/data/media/audiobooks/Elly Griffiths/A Dying Fall (2012)/DYING FALL .mp3",
    )
    assert found == (str(tmp_path), "Elly Griffiths/A Dying Fall (2012)/A Dying Fall.mp3")
