import asyncio

from app.adapters.catalog_providers import OpenLibrary


def test_edition_shaped_work_keys_are_skipped_not_fatal():
    docs = [
        {
            "key": "/works/OL45804W",
            "title": "The Tale of Peter Rabbit",
            "author_name": ["Beatrix Potter"],
        },
        {"key": "/works/OL9613305M", "title": "The Tale of Peter Rabbit and Other Stories"},
        {"title": "No key at all"},
    ]

    async def request(method, path, params=None):
        return {"docs": docs, "numFound": 3}

    page = asyncio.run(OpenLibrary(request).search("peter rabbit", 1))
    assert [item.external_id for item in page.items] == ["OL45804W"]
