from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.domain.series_gap_watch import _recent_failure


def operation(age, payload):
    now = datetime.now(UTC)
    return SimpleNamespace(
        status="failed", updated_at=now - age, created_at=now - age, payload=payload
    )


def test_transient_failures_retry_after_fifteen_minutes():
    now = datetime.now(UTC)
    assert _recent_failure(operation(timedelta(minutes=5), {}), now)
    assert not _recent_failure(operation(timedelta(minutes=20), {}), now)


def test_merged_series_failures_wait_a_week():
    now = datetime.now(UTC)
    merged = {"permanent": True}
    assert _recent_failure(operation(timedelta(days=2), merged), now)
    assert not _recent_failure(operation(timedelta(days=8), merged), now)
