import os
import zipfile

from app.importing.inspection import inspect_file


def make(tmp_path, name, opf):
    path = tmp_path / name
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr(
            "META-INF/container.xml",
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
            '<rootfile full-path="c.opf"/></rootfiles></container>',
        )
        z.writestr("c.opf", opf)
    return path


def run(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        return inspect_file(fd, path.name, None)
    finally:
        os.close(fd)


def test_broken_package_with_title_author_filename_is_relaxed(tmp_path):
    result = run(make(tmp_path, "The Cutthroat - Clive Cussler.epub", "<package><metadata>&bad;"))
    assert result["state"] == "inspected" and result["metadata"]["relaxed"]


def test_broken_package_without_author_in_filename_is_still_rejected(tmp_path):
    result = run(make(tmp_path, "cutthroat.epub", "<package><metadata>&bad;"))
    assert result["state"] == "held"
