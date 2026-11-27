"""A release identity is scoped to a source/indexer, work family, and medium."""

import re

from sqlalchemy import select

from app.db.models import ReleaseBlock
from app.domain.work_graph import canonical_work, family_ids
from app.importing.naming import fingerprint

_HEX_V1_RE = re.compile(r"^[a-fA-F0-9]{40}$")
_HEX_V2_RE = re.compile(r"^[a-fA-F0-9]{64}$")


def _extract_hash_keys(mapping) -> set[str]:
    if not isinstance(mapping, dict):
        return set()
    keys: set[str] = set()
    for field in ("infohash_v1", "infohash_v2", "artifact_sha256"):
        value = mapping.get(field)
        if isinstance(value, str) and value.strip():
            keys.add(field + ":" + value.strip().lower())
    for field in ("info_hash", "infoHash", "infohash"):
        value = mapping.get(field)
        if not isinstance(value, str):
            continue
        cleaned = value.strip().lower()
        if _HEX_V1_RE.fullmatch(cleaned):
            keys.add("infohash_v1:" + cleaned)
        elif _HEX_V2_RE.fullmatch(cleaned):
            keys.add("infohash_v2:" + cleaned)
    return keys


def release_keys(release, descriptor=None):
    if hasattr(release, "model_dump"):
        release = release.model_dump(mode="json")
    source = release["source"] + (
        ":" + str(release["indexer_id"]) if release.get("indexer_id") else ""
    )
    keys = {"release:" + fingerprint({"source": source, "id": release["source_id"]})}
    keys.update(_extract_hash_keys(descriptor))
    keys.update(_extract_hash_keys(release))
    keys.update(_extract_hash_keys(release.get("details")))
    return source, sorted(keys)


async def blocked(db, work_id, medium, release, descriptor=None):
    _, keys = release_keys(release, descriptor)
    entries = await db.scalars(
        select(ReleaseBlock).where(
            ReleaseBlock.work_id.in_(family_ids(work_id)),
            ReleaseBlock.medium == medium,
            ReleaseBlock.active.is_(True),
        )
    )
    return next((row for row in entries if set(row.identities).intersection(keys)), None)


async def active_keys(db, work_id, medium):
    """One transaction-local snapshot for ranking many candidates of one request."""
    rows = await db.scalars(
        select(ReleaseBlock.identities).where(
            ReleaseBlock.work_id.in_(family_ids(work_id)),
            ReleaseBlock.medium == medium,
            ReleaseBlock.active.is_(True),
        )
    )
    return {key for identities in rows for key in identities}


async def add(db, selection, reason, actor_id, *, automatic=True):
    work = await canonical_work(db, selection.frozen["origin_work_id"])
    release = selection.frozen["release"]
    source, keys = release_keys(release, selection.frozen["descriptor"])
    key = fingerprint({"source": source, "id": release["source_id"]})
    # Callers hold the acquisition lock for every transfer member.
    row = await db.scalar(
        select(ReleaseBlock).where(
            ReleaseBlock.work_id == work.id,
            ReleaseBlock.medium == selection.frozen["requirements"]["medium"],
            ReleaseBlock.release_key == key,
        )
    )
    if not row:
        row = ReleaseBlock(
            work_id=work.id,
            medium=selection.frozen["requirements"]["medium"],
            release_key=key,
            source=source,
            title=release["title"][:1000],
            identities=keys,
        )
        db.add(row)
    else:
        row.identities = sorted(set(row.identities or ()).union(keys))
    row.reason, row.actor_id, row.automatic, row.active = reason[:300], actor_id, automatic, True
    return row
