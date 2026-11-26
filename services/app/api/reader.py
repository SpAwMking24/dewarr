"""Built-in ebook reader API: stream owned ebook files and sync reading progress."""

from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import CurrentUser, Database
from app.db.models import (
    AssetContains,
    ImportDestination,
    Integration,
    Library,
    LibraryAsset,
    ReadingProgress,
    Version,
    Work,
)
from app.domain.visibility import visible_library
from app.domain.work_graph import canonical_work, family_ids
from app.importing.destinations import destination_configuration
from app.importing.filesystem import beneath, directory, relative_parts
from app.security import decrypt_secrets

router = APIRouter(prefix="/reader", tags=["reader"])

READABLE_FORMATS = ("epub", "pdf", "azw3", "mobi", "azw", "fb2", "cbz")
MEDIA_TYPES = {
    "epub": "application/epub+zip",
    "pdf": "application/pdf",
    "mobi": "application/x-mobipocket-ebook",
    "azw": "application/vnd.amazon.ebook",
    "azw3": "application/vnd.amazon.ebook",
    "fb2": "application/x-fictionbook+xml",
    "cbz": "application/vnd.comicbook+zip",
}
FALLBACK_ROOTS = ("/books", "/audiobooks", "/data/media/books", "/data/media/audiobooks")
CHUNK_SIZE = 256 * 1024


class ReadingProgressView(BaseModel):
    cfi: str | None = None
    fraction: float = 0.0
    chapter: str | None = None
    updated_at: datetime


class ReadingProgressInput(BaseModel):
    cfi: str | None = Field(default=None, max_length=2000)
    fraction: float = Field(ge=0.0, le=1.0)
    chapter: str | None = Field(default=None, max_length=400)


class ReaderBookView(BaseModel):
    asset_id: UUID
    work_id: UUID | None = None
    title: str
    authors: list[str] = Field(default_factory=list)
    cover_url: str | None = None
    format: str
    filename: str
    size: int | None = None
    progress: ReadingProgressView | None = None


class ContinueReadingItem(BaseModel):
    asset_id: UUID
    work_id: UUID | None = None
    title: str
    authors: list[str] = Field(default_factory=list)
    cover_url: str | None = None
    format: str
    fraction: float
    chapter: str | None = None
    updated_at: datetime


def _pick_ebook_file(asset: LibraryAsset) -> dict | None:
    files = [
        f for f in (asset.files or []) if isinstance(f, dict) and isinstance(f.get("path"), str)
    ]
    if not files:
        return None
    priority = {fmt: idx for idx, fmt in enumerate(READABLE_FORMATS)}
    readable = []
    for entry in files:
        fmt = str(entry.get("format") or PurePosixPath(entry["path"]).suffix.lstrip(".")).lower()
        if fmt in priority:
            readable.append((priority[fmt], fmt, entry))
    if not readable:
        return None
    readable.sort(key=lambda item: item[0])
    _, fmt, entry = readable[0]
    return {
        "path": entry["path"],
        "format": fmt,
        "filename": PurePosixPath(entry["path"]).name or f"book.{fmt}",
        "size": entry.get("size") if isinstance(entry.get("size"), int) else None,
    }


async def _load_readable_asset(db, user, asset_id: UUID):
    row = (
        await db.execute(
            select(LibraryAsset, Library, Integration)
            .join(Library, LibraryAsset.library_id == Library.id)
            .join(Integration, Library.integration_id == Integration.id)
            .where(
                LibraryAsset.id == asset_id,
                Library.accessible.is_(True),
                Integration.enabled.is_(True),
                visible_library(user),
            )
        )
    ).first()
    if not row:
        raise HTTPException(404, "Ebook not found")
    asset, library, integration = row
    if asset.medium != "ebook" or asset.state == "missing-confirmed":
        raise HTTPException(404, "This library item is not an available ebook")
    file_info = _pick_ebook_file(asset)
    if not file_info:
        raise HTTPException(404, "No readable ebook file found for this item")
    return asset, library, integration, file_info


async def _asset_work(db, asset: LibraryAsset) -> Work | None:
    work_id = None
    if asset.version_id:
        version = await db.get(Version, asset.version_id)
        if version:
            work_id = version.work_id
    if work_id is None:
        work_id = await db.scalar(
            select(AssetContains.work_id).where(AssetContains.asset_id == asset.id).limit(1)
        )
    if work_id is None:
        return None
    return await canonical_work(db, work_id)


def _progress_view(row: ReadingProgress | None) -> ReadingProgressView | None:
    if not row:
        return None
    return ReadingProgressView(
        cfi=row.cfi,
        fraction=row.fraction,
        chapter=row.chapter,
        updated_at=row.updated_at,
    )


def _content_disposition(filename: str) -> str:
    safe = filename.replace('"', "").replace("\r", "").replace("\n", "")
    return f"inline; filename*=UTF-8''{quote(safe)}"


async def _open_local_stream(db, library_id: UUID, file_info: dict):
    routes = list(
        await db.scalars(
            select(ImportDestination).where(
                ImportDestination.library_id == library_id,
                ImportDestination.medium == "ebook",
                ImportDestination.deleted_at.is_(None),
            )
        )
    )
    candidates: list[tuple[str, str]] = []
    roots: list[str] = []
    for route in routes:
        try:
            config = await destination_configuration(db, route)
        except HTTPException:
            continue
        root_path = config.get("root_path")
        if not root_path:
            continue
        roots.append(str(root_path))
        backend_path = route.backend_path
        if not backend_path:
            continue
        try:
            rel = str(PurePosixPath(file_info["path"]).relative_to(PurePosixPath(backend_path)))
            relative_parts(rel)
        except ValueError:
            continue
        candidates.append((str(root_path), rel))
    # The library server may mount the same folders under different names, so also try
    # the trailing part of the stored path beneath every folder this container can see.
    parts = [part for part in PurePosixPath(file_info["path"]).parts if part not in {"/", ""}]
    for root in [*roots, *FALLBACK_ROOTS]:
        for index in range(len(parts)):
            candidates.append((root, "/".join(parts[index:])))
    for root_path, rel in candidates:
        try:
            relative_parts(rel)
            with directory(Path(root_path)) as root_fd, beneath(root_fd, rel) as file_fd:
                # Duplicate the open descriptor so we can stream safely after closing root_fd.
                import os

                dup_fd = os.dup(file_fd)
                size = os.fstat(dup_fd).st_size
        except (OSError, ValueError, HTTPException):
            continue

        def _iter_fd(fd: int):
            try:
                with open(fd, "rb", closefd=True) as handle:
                    while chunk := handle.read(CHUNK_SIZE):
                        yield chunk
            except OSError:
                return

        headers = {
            "Content-Disposition": _content_disposition(file_info["filename"]),
            "Content-Length": str(size),
            "Cache-Control": "private, max-age=300",
        }
        return StreamingResponse(
            _iter_fd(dup_fd),
            media_type=MEDIA_TYPES.get(file_info["format"], "application/octet-stream"),
            headers=headers,
        )
    return None


async def _open_remote_stream(integration: Integration, asset: LibraryAsset, file_info: dict):
    base_url = (
        getattr(integration, "base_url", None)
        or (integration.config or {}).get("url")
        or (integration.config or {}).get("base_url")
    )
    if not base_url or not integration.encrypted_secrets:
        return None
    secrets = decrypt_secrets(integration.encrypted_secrets)
    base = str(base_url).rstrip("/")
    headers = {"Accept-Encoding": "identity"}
    if integration.kind == "audiobookshelf":
        token = secrets.get("token")
        if not token:
            return None
        url = f"{base}/api/items/{asset.external_id}/ebook"
        headers["Authorization"] = f"Bearer {token}"
    elif integration.kind == "grimmory":
        token = secrets.get("token") or secrets.get("api_key")
        if not token:
            return None
        url = f"{base}/api/v1/books/{asset.external_id}/download"
        headers["Authorization"] = f"Bearer {token}"
    else:
        return None

    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=120.0), follow_redirects=True)
    try:
        request = client.build_request("GET", url, headers=headers)
        response = await client.send(request, stream=True)
    except httpx.HTTPError as err:
        await client.aclose()
        raise HTTPException(502, "Could not reach the library server to load this ebook") from err

    if response.status_code >= 400:
        await response.aclose()
        await client.aclose()
        raise HTTPException(404, "Ebook file is not available from the library server")

    async def _iter_remote():
        try:
            async for chunk in response.aiter_bytes(CHUNK_SIZE):
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    resp_headers = {
        "Content-Disposition": _content_disposition(file_info["filename"]),
        "Cache-Control": "private, max-age=300",
    }
    if (content_length := response.headers.get("content-length")) and not response.headers.get(
        "content-encoding"
    ):
        resp_headers["Content-Length"] = content_length

    return StreamingResponse(
        _iter_remote(),
        media_type=MEDIA_TYPES.get(file_info["format"], "application/octet-stream"),
        headers=resp_headers,
    )


@router.get("/works/{work_id}/ebook", response_model=ReaderBookView | None)
async def work_ebook(work_id: UUID, user: CurrentUser, db: Database):
    """Return the best readable ebook asset for a catalog work, if the user owns one."""
    canonical = await canonical_work(db, work_id)
    if not canonical:
        return None
    ids = family_ids(canonical.id)
    assets = list(
        await db.scalars(
            select(LibraryAsset)
            .join(Library, LibraryAsset.library_id == Library.id)
            .join(Integration, Library.integration_id == Integration.id)
            .outerjoin(Version, LibraryAsset.version_id == Version.id)
            .outerjoin(AssetContains, AssetContains.asset_id == LibraryAsset.id)
            .where(
                (Version.work_id.in_(ids)) | (AssetContains.work_id.in_(ids)),
                LibraryAsset.medium == "ebook",
                LibraryAsset.state != "missing-confirmed",
                Library.accessible.is_(True),
                Integration.enabled.is_(True),
                visible_library(user),
            )
            .distinct()
        )
    )
    candidates = []
    priority = {fmt: idx for idx, fmt in enumerate(READABLE_FORMATS)}
    for asset in assets:
        info = _pick_ebook_file(asset)
        if not info:
            continue
        candidates.append(
            (
                0 if asset.state == "present" else 1,
                0 if asset.full_content else 1,
                priority.get(info["format"], 99),
                asset,
                info,
            )
        )
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[:3])
    _, _, _, asset, file_info = candidates[0]
    progress = await db.scalar(
        select(ReadingProgress).where(
            ReadingProgress.user_id == user.id, ReadingProgress.asset_id == asset.id
        )
    )
    return ReaderBookView(
        asset_id=asset.id,
        work_id=canonical.id,
        title=canonical.title or asset.title or file_info["filename"],
        authors=list(canonical.authors or []),
        cover_url=canonical.cover_url,
        format=file_info["format"],
        filename=file_info["filename"],
        size=file_info["size"],
        progress=_progress_view(progress),
    )


@router.get("/continue", response_model=list[ContinueReadingItem])
async def continue_reading(user: CurrentUser, db: Database):
    """Return the current user's recently read ebooks."""
    rows = (
        await db.execute(
            select(ReadingProgress, LibraryAsset)
            .join(LibraryAsset, ReadingProgress.asset_id == LibraryAsset.id)
            .join(Library, LibraryAsset.library_id == Library.id)
            .join(Integration, Library.integration_id == Integration.id)
            .where(
                ReadingProgress.user_id == user.id,
                LibraryAsset.medium == "ebook",
                LibraryAsset.state != "missing-confirmed",
                Library.accessible.is_(True),
                Integration.enabled.is_(True),
                visible_library(user),
            )
            .order_by(ReadingProgress.updated_at.desc())
            .limit(12)
        )
    ).all()
    items: list[ContinueReadingItem] = []
    for progress, asset in rows:
        file_info = _pick_ebook_file(asset)
        if not file_info:
            continue
        work = await _asset_work(db, asset)
        items.append(
            ContinueReadingItem(
                asset_id=asset.id,
                work_id=work.id if work else progress.work_id,
                title=(work.title if work else None) or asset.title or file_info["filename"],
                authors=list(work.authors or []) if work else [],
                cover_url=work.cover_url if work else None,
                format=file_info["format"],
                fraction=progress.fraction,
                chapter=progress.chapter,
                updated_at=progress.updated_at,
            )
        )
    return items


@router.get("/assets/{asset_id}", response_model=ReaderBookView)
async def reader_book(asset_id: UUID, user: CurrentUser, db: Database):
    asset, _, _, file_info = await _load_readable_asset(db, user, asset_id)
    work = await _asset_work(db, asset)
    progress = await db.scalar(
        select(ReadingProgress).where(
            ReadingProgress.user_id == user.id, ReadingProgress.asset_id == asset.id
        )
    )
    return ReaderBookView(
        asset_id=asset.id,
        work_id=work.id if work else None,
        title=(work.title if work else None) or asset.title or file_info["filename"],
        authors=list(work.authors or []) if work else [],
        cover_url=work.cover_url if work else None,
        format=file_info["format"],
        filename=file_info["filename"],
        size=file_info["size"],
        progress=_progress_view(progress),
    )


@router.get("/assets/{asset_id}/file")
async def reader_file(asset_id: UUID, user: CurrentUser, db: Database):
    asset, library, integration, file_info = await _load_readable_asset(db, user, asset_id)
    local = await _open_local_stream(db, library.id, file_info)
    if local is not None:
        return local
    remote = await _open_remote_stream(integration, asset, file_info)
    if remote is not None:
        return remote
    raise HTTPException(
        404,
        "Ebook file is not locally mounted and could not be fetched from the library server",
    )


@router.put("/assets/{asset_id}/progress", response_model=ReadingProgressView)
async def save_progress(
    asset_id: UUID, body: ReadingProgressInput, user: CurrentUser, db: Database
):
    asset, _, _, _ = await _load_readable_asset(db, user, asset_id)
    work = await _asset_work(db, asset)
    now = datetime.now(UTC)
    row = await db.scalar(
        select(ReadingProgress).where(
            ReadingProgress.user_id == user.id, ReadingProgress.asset_id == asset.id
        )
    )
    if row is None:
        row = ReadingProgress(
            user_id=user.id,
            asset_id=asset.id,
            work_id=work.id if work else None,
            cfi=body.cfi,
            fraction=body.fraction,
            chapter=body.chapter,
            updated_at=now,
        )
        db.add(row)
    else:
        if work and row.work_id != work.id:
            row.work_id = work.id
        row.cfi = body.cfi
        row.fraction = body.fraction
        row.chapter = body.chapter
        row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return _progress_view(row)
