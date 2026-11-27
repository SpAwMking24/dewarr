from datetime import UTC, datetime

import httpx
import pytest

from app.adapters.sabnzbd import parse_job
from app.adapters.slskd import SlskdClient, SlskdFile, SlskdRelease


def _sample_release() -> SlskdRelease:
    return SlskdRelease(
        source_id="slskd:1",
        search_id="00000000-0000-0000-0000-000000000001",
        username="mandomungo",
        directory="Audiobooks\\Rebecca Yarros\\Onyx Storm",
        title="Onyx Storm",
        raw_title="Onyx Storm",
        medium="audio",
        observed_at=datetime.now(UTC),
        files=[
            SlskdFile(
                filename="Audiobooks\\Rebecca Yarros\\Onyx Storm\\Onyx Storm.m4b",
                size=1_000_000_000,
            )
        ],
    )


@pytest.mark.asyncio
async def test_slskd_batch_reports_inline_progress_and_speed():
    release = _sample_release()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v0/transfers/downloads/batches/batch-1"
        return httpx.Response(
            200,
            json={
                "transfers": [
                    {
                        "id": "t-1",
                        "filename": release.files[0].filename,
                        "size": 1_000_000_000,
                        "state": "InProgress",
                        "bytesTransferred": 230_000_000,
                        "percentComplete": 23.0,
                        "averageSpeed": 1_000_000.0,
                    }
                ]
            },
        )

    async with SlskdClient("http://slskd.local", "key", transport=httpx.MockTransport(handler)) as client:
        state = await client.batch("batch-1", release)

    assert state.state == "downloading"
    assert state.progress == pytest.approx(0.23, abs=0.001)
    assert state.download_speed == 1_000_000
    assert state.eta_seconds == 770


@pytest.mark.asyncio
async def test_slskd_batch_falls_back_to_user_downloads_when_batch_omits_progress():
    release = _sample_release()
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/batches/batch-2"):
            return httpx.Response(
                200,
                json={
                    "transfers": [
                        {
                            "id": "t-2",
                            "filename": release.files[0].filename,
                            "size": 1_000_000_000,
                            "state": "InProgress",
                        }
                    ]
                },
            )
        if request.url.path.endswith("/transfers/downloads/mandomungo"):
            return httpx.Response(
                200,
                json={
                    "username": "mandomungo",
                    "directories": [
                        {
                            "directory": release.directory,
                            "files": [
                                {
                                    "id": "t-2",
                                    "filename": release.files[0].filename,
                                    "size": 1_000_000_000,
                                    "percentComplete": 23.5,
                                    "averageSpeed": 500_000.0,
                                }
                            ],
                        }
                    ],
                },
            )
        raise AssertionError(f"Unexpected path: {request.url.path}")

    async with SlskdClient("http://slskd.local", "key", transport=httpx.MockTransport(handler)) as client:
        state = await client.batch("batch-2", release)

    assert len(calls) == 2
    assert state.progress == pytest.approx(0.235, abs=0.001)
    assert state.download_speed == 500_000


def test_sabnzbd_parse_job_reports_progress():
    downloading = parse_job(
        {
            "nzo_id": "SABnzbd_nzo_abc123",
            "filename": "dewarr-tag",
            "cat": "books",
            "status": "Downloading",
            "percentage": "45",
            "mb": "100.0",
            "mbleft": "55.0",
        },
        completed=False,
    )
    assert downloading.progress == pytest.approx(0.45, abs=0.001)

    finished = parse_job(
        {
            "nzo_id": "SABnzbd_nzo_abc123",
            "name": "dewarr-tag",
            "category": "books",
            "status": "Completed",
            "storage": "/downloads/complete/book",
        },
        completed=True,
    )
    assert finished.progress == 1.0
