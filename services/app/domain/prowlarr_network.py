"""Credential-scoped Prowlarr budget and generation fences around read-only I/O."""

import asyncio
import math
import os
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException

from app.adapters.contracts import AdapterError, FailureKind
from app.adapters.prowlarr import ProwlarrClient
from app.db.models import SourceConnection
from app.db.session import session_factory
from app.domain.operations import transaction_lock
from app.domain.source_network import check_actor
from app.security import decrypt_secrets

# Minimum gap between any two Prowlarr requests (all workers share it). Override with
# DEWARR_PROWLARR_INTERVAL if your indexers are stricter or more generous.
REQUEST_INTERVAL = float(os.environ.get("DEWARR_PROWLARR_INTERVAL", "2.5"))
# After a rate-limit response the whole source rests, doubling on each repeat.
COOLDOWN_BASE = 60
COOLDOWN_MAX = 900
INDEXER_CACHE_SECONDS = 300
_indexer_cache: dict[int, tuple[float, list]] = {}


def cooldown_seconds(strikes):
    """Escalating rest period: 60s, 120s, 240s ... capped at 15 minutes."""
    return min(COOLDOWN_BASE * 2 ** max(strikes - 1, 0), COOLDOWN_MAX)


async def cooling_until():
    """When Prowlarr is resting after a rate limit, else None. Callers hold off new work."""
    async with session_factory()() as db:
        row = await db.get(SourceConnection, "prowlarr")
        until = row.blocked_until if row and row.enabled else None
        return until if until and until > datetime.now(UTC) else None
# Queue behind earlier requests for up to this long before reporting a cooldown.
# A short wait here turned ordinary bursts (one search per book) into errors.
QUEUE_WAIT = 20


async def prowlarr_call(user_id, operation, argument=None, **kwargs):
    """Queue behind another in-flight Prowlarr request instead of failing the search."""
    for attempt in range(10):
        try:
            return await _prowlarr_call_once(user_id, operation, argument, **kwargs)
        except AdapterError as error:
            busy = error.kind == FailureKind.RATE_LIMIT and "another request" in str(error)
            if not busy or attempt == 9:
                raise
            await asyncio.sleep(2 + attempt * 0.5)


async def _prowlarr_call_once(
    user_id, operation, argument=None, *, expected_generation=None, recovery_guard=None
):
    token = uuid4()
    async with session_factory()() as db, db.begin():
        await check_actor(db, user_id, admin=operation == "test")
        await transaction_lock(db, "source:prowlarr")
        if recovery_guard is not None:
            await recovery_guard(db)
        row = await db.get(SourceConnection, "prowlarr")
        if not row or not row.enabled:
            raise HTTPException(409, "An administrator must connect and enable Prowlarr first")
        if expected_generation is not None and expected_generation != row.generation:
            raise HTTPException(409, "Prowlarr settings changed. Search again.")
        now = datetime.now(UTC)
        if row.lease_token and row.lease_until and row.lease_until > now:
            raise AdapterError(
                FailureKind.RATE_LIMIT, "Prowlarr is handling another request.", retry_after=2
            )
        due = max(now, row.next_request_at or now, row.blocked_until or now)
        wait = (due - now).total_seconds()
        if wait > QUEUE_WAIT:
            raise AdapterError(
                FailureKind.RATE_LIMIT, "Prowlarr is cooling down.", retry_after=math.ceil(wait)
            )
        # A dead read-only API-key request can be retried after lease expiry.
        row.lease_token, row.lease_until = token, now + timedelta(seconds=150)
        row.next_request_at = due + timedelta(seconds=REQUEST_INTERVAL)
        generation, endpoint = row.generation, row.base_url
        secrets = decrypt_secrets(row.encrypted_secrets)
        mam = await db.get(SourceConnection, "mam")
        native_mam = bool(mam and mam.enabled)
    client, failure, value = None, None, None
    try:
        if wait:
            await asyncio.sleep(wait)
        async with ProwlarrClient(endpoint, secrets["api_key"]) as client:
            if operation in {"indexers", "search", "resolve"}:
                cached = _indexer_cache.get(generation)
                if operation != "indexers" and cached and time.monotonic() - cached[0] < INDEXER_CACHE_SECONDS:
                    indexers = cached[1]
                else:
                    indexers = await client.indexers()
                    _indexer_cache.clear()
                    _indexer_cache[generation] = (time.monotonic(), indexers)
                excluded = set(secrets.get("excluded_indexers", []))
                for indexer in indexers:
                    indexer.excluded = indexer.id in excluded or (native_mam and indexer.native_mam)
                if operation == "indexers":
                    value = indexers
                else:
                    indexer_id = (
                        argument.indexer_id
                        if operation == "search"
                        else int(argument[0].indexer_id)
                    )
                    indexer = next((item for item in indexers if item.id == indexer_id), None)
                    if (
                        not indexer
                        or not indexer.enabled
                        or not indexer.supports_search
                        or indexer.excluded
                    ):
                        raise AdapterError(
                            FailureKind.UNSUPPORTED,
                            "This indexer is disabled, excluded, or handled by native MAM.",
                        )
                    if (
                        operation == "search"
                        and argument.offset
                        and not indexer.supports_pagination
                    ):
                        raise AdapterError(
                            FailureKind.UNSUPPORTED, "This indexer does not support paging."
                        )
                    value = await getattr(client, operation)(argument)
            else:
                value = await client.test()
    except AdapterError as error:
        failure = error
    # Cancellation leaves a bounded lease. A late response cannot clear a newer lease.
    async with session_factory()() as db, db.begin():
        await transaction_lock(db, "source:prowlarr")
        row = await db.get(SourceConnection, "prowlarr")
        if not row or row.lease_token != token:
            raise HTTPException(409, "Prowlarr request expired. Retry with current settings.")
        row.lease_token, row.lease_until = None, None
        row.next_request_at = datetime.now(UTC) + timedelta(seconds=REQUEST_INTERVAL)
        state = dict(row.automation_state or {})
        limited = bool(failure and failure.kind == FailureKind.RATE_LIMIT) or bool(
            client and client.cooldown
        )
        if limited and not (failure and "another request" in str(failure)):
            strikes = int(state.get("rate_strikes", 0)) + 1
            state["rate_strikes"] = strikes
            rest = max(cooldown_seconds(strikes), client.cooldown if client else 0)
            due = datetime.now(UTC) + timedelta(seconds=rest)
            row.blocked_until = max(row.blocked_until or due, due)
            row.automation_state = state
        elif not failure and state.get("rate_strikes"):
            state["rate_strikes"] = 0
            row.automation_state = state
        changed = row.generation != generation or not row.enabled
        if not changed:
            row.last_checked_at = datetime.now(UTC)
            row.status = failure.kind.value if failure else "connected"
            row.last_error = str(failure) if failure else None
            if not failure:
                row.last_success_at = datetime.now(UTC)
    if changed:
        raise HTTPException(409, "Prowlarr settings changed during this request. Search again.")
    async with session_factory()() as db:
        await check_actor(db, user_id, admin=operation == "test")
    if failure:
        raise failure
    return value, generation
