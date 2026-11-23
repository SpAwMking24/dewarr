import asyncio

import httpx
import pytest

from app.adapters.contracts import AdapterError, FailureKind
from app.adapters.qbittorrent import QbitClient


def client(error):
    def handler(request):
        raise error

    return QbitClient("http://qbit:8080", "user", "pass", transport=httpx.MockTransport(handler))


def run(qbit, **kwargs):
    async def go():
        async with qbit:
            await qbit._request("GET", "torrents/files", **kwargs)

    asyncio.run(go())


def test_slow_status_check_is_transient():
    with pytest.raises(AdapterError) as error:
        run(client(httpx.ReadTimeout("slow")))
    assert error.value.kind == FailureKind.TIMEOUT


def test_unreachable_client_is_still_a_route_problem():
    with pytest.raises(AdapterError) as error:
        run(client(httpx.ConnectError("refused")))
    assert error.value.kind == FailureKind.ROUTE


def test_slow_submission_remains_uncertain():
    with pytest.raises(AdapterError) as error:
        run(client(httpx.ReadTimeout("slow")), mutating=True)
    assert error.value.kind == FailureKind.UNCERTAIN
