import zipfile

import pytest

from app.db.models import (
    ImportDestination,
    Integration,
    Library,
    LibraryAsset,
    Version,
    Work,
)
from app.domain.identity import work_key
from app.security import encrypt_secrets

pytestmark = pytest.mark.integration


def _write_minimal_epub(path) -> bytes:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        archive.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            "<rootfiles>"
            '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
            "</rootfiles>"
            "</container>",
        )
        archive.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0" encoding="utf-8"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            '<dc:identifier id="uid">urn:uuid:test-book</dc:identifier>'
            "<dc:title>Piranesi</dc:title>"
            "<dc:language>en</dc:language>"
            "</metadata>"
            "<manifest>"
            '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>'
            "</manifest>"
            '<spine><itemref idref="ch1"/></spine>'
            "</package>",
        )
        archive.writestr(
            "OEBPS/ch1.xhtml",
            '<?xml version="1.0" encoding="utf-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml">'
            "<head><title>Chapter 1</title></head>"
            "<body><h1>The House</h1><p>The Beauty of the House is immeasurable.</p></body>"
            "</html>",
        )
    return path.read_bytes()


async def _seed_local_ebook(database, tmp_path, *, audio_only: bool = False):
    root = tmp_path / "ebooks"
    book_dir = root / "Susanna Clarke" / "Piranesi"
    book_dir.mkdir(parents=True)
    epub_path = book_dir / "Piranesi.epub"
    epub_bytes = _write_minimal_epub(epub_path)

    async with database() as db, db.begin():
        work = Work(
            title="Piranesi",
            authors=["Susanna Clarke"],
            provisional=False,
            catalog_public=True,
            match_key=work_key("Piranesi", ["Susanna Clarke"]),
        )
        db.add(work)
        await db.flush()

        medium = "audio" if audio_only else "ebook"
        version = Version(work_id=work.id, medium=medium, title="Piranesi")
        db.add(version)
        await db.flush()

        integration = Integration(
            kind="audiobookshelf",
            name="Test ABS",
            base_url="http://abs.invalid",
            encrypted_secrets=encrypt_secrets({"api_key": "secret"}),
        )
        db.add(integration)
        await db.flush()

        library = Library(
            integration_id=integration.id,
            external_id="lib-ebooks",
            name="Ebooks",
        )
        db.add(library)
        await db.flush()

        destination = ImportDestination(
            root_key="ebooks-test",
            workflow="library",
            library_id=library.id,
            medium="ebook",
            backend_path=str(root),
            mode="copy",
        )
        db.add(destination)
        await db.flush()

        asset = LibraryAsset(
            library_id=library.id,
            version_id=version.id,
            external_id="item-1",
            medium=medium,
            title="Piranesi",
            files=[
                {
                    "path": str(epub_path),
                    "format": "m4b" if audio_only else "epub",
                    "size": len(epub_bytes),
                }
            ],
            state="present",
        )
        db.add(asset)
        await db.flush()
        return work.id, asset.id, epub_bytes


async def test_reader_streams_local_ebook_and_tracks_progress(
    client, admin, database, tmp_path, monkeypatch
):
    from app.config import get_settings

    work_id, asset_id, epub_bytes = await _seed_local_ebook(database, tmp_path)
    monkeypatch.setattr(get_settings(), "import_destinations", {"ebooks-test": tmp_path / "ebooks"})

    # Best ebook lookup for the work
    work_ebook = await client.get(f"/api/reader/works/{work_id}/ebook")
    assert work_ebook.status_code == 200, work_ebook.text
    payload = work_ebook.json()
    assert payload["asset_id"] == str(asset_id)
    assert payload["title"] == "Piranesi"
    assert payload["authors"] == ["Susanna Clarke"]
    assert payload["format"] == "epub"
    assert payload["progress"] is None

    # Stream the EPUB file directly from the configured import destination
    file_response = await client.get(f"/api/reader/assets/{asset_id}/file")
    assert file_response.status_code == 200, file_response.text
    assert file_response.headers["content-type"].startswith("application/epub+zip")
    assert file_response.content == epub_bytes

    # Save reading progress
    put_response = await client.put(
        f"/api/reader/assets/{asset_id}/progress",
        json={
            "cfi": "epubcfi(/6/2!/4/2/1:0)",
            "fraction": 0.37,
            "chapter": "Part One: The Albatross",
        },
    )
    assert put_response.status_code == 200, put_response.text
    saved = put_response.json()
    assert saved["cfi"] == "epubcfi(/6/2!/4/2/1:0)"
    assert saved["fraction"] == pytest.approx(0.37)
    assert saved["chapter"] == "Part One: The Albatross"

    # Update progress (upsert)
    put_again = await client.put(
        f"/api/reader/assets/{asset_id}/progress",
        json={
            "cfi": "epubcfi(/6/4!/4/2/1:12)",
            "fraction": 0.64,
            "chapter": "Part Two: The Other",
        },
    )
    assert put_again.status_code == 200, put_again.text

    # Asset metadata reflects latest saved progress
    detail = await client.get(f"/api/reader/assets/{asset_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["progress"]["fraction"] == pytest.approx(0.64)
    assert detail.json()["progress"]["chapter"] == "Part Two: The Other"

    # Continue reading shelf includes this ebook
    cont = await client.get("/api/reader/continue")
    assert cont.status_code == 200, cont.text
    items = cont.json()
    assert len(items) == 1
    assert items[0]["asset_id"] == str(asset_id)
    assert items[0]["work_id"] == str(work_id)
    assert items[0]["fraction"] == pytest.approx(0.64)
    assert items[0]["chapter"] == "Part Two: The Other"


async def test_reader_rejects_audio_assets(client, admin, database, tmp_path):
    work_id, asset_id, _ = await _seed_local_ebook(database, tmp_path, audio_only=True)

    work_ebook = await client.get(f"/api/reader/works/{work_id}/ebook")
    assert work_ebook.status_code == 200
    assert work_ebook.json() is None

    asset_detail = await client.get(f"/api/reader/assets/{asset_id}")
    assert asset_detail.status_code == 404

    asset_file = await client.get(f"/api/reader/assets/{asset_id}/file")
    assert asset_file.status_code == 404
