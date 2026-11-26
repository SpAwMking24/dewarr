"""Built-in audiobook player API: range-stream owned audio files and sync listening position."""

import asyncio
import json
import os
import re
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from uuid import UUID

import anyio
import anyio.to_thread
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.api.dependencies import CurrentUser, Database
from app.api.reader import (
    CHUNK_SIZE,
    FALLBACK_ROOTS,
    ReadingProgressView,
    _asset_work,
    _progress_view,
)
from app.db.models import (
    AssetContains,
    ImportDestination,
    ImportEntry,
    Integration,
    Library,
    LibraryAsset,
    ReadingProgress,
    Version,
)
from app.domain.visibility import visible_library
from app.domain.work_graph import canonical_work, family_ids
from app.importing.destinations import destination_configuration
from app.importing.filesystem import beneath, directory, relative_parts

router = APIRouter(prefix="/listen", tags=["listen"])

AUDIO_FORMATS = ("m4b", "m4a", "mp3", "aac", "ogg", "opus", "flac")
MEDIA_TYPES = {
    "m4b": "audio/mp4",
    "m4a": "audio/mp4",
    "mp3": "audio/mpeg",
    "aac": "audio/aac",
    "ogg": "audio/ogg",
    "opus": "audio/ogg",
    "flac": "audio/flac",
}


class Chapter(BaseModel):
    title: str
    start: float = 0.0
    end: float | None = None


class Track(BaseModel):
    index: int
    filename: str
    format: str
    size: int | None = None
    duration: float | None = None
    chapters: list[Chapter] = Field(default_factory=list)


class ListenBookView(BaseModel):
    asset_id: UUID
    work_id: UUID | None = None
    title: str
    authors: list[str] = Field(default_factory=list)
    cover_url: str | None = None
    tracks: list[Track]
    progress: ReadingProgressView | None = None


class ListenProgressInput(BaseModel):
    """Position is stored as ``track:<index>@<seconds>`` in the shared progress record."""

    track: int = Field(ge=0, le=5000)
    seconds: float = Field(ge=0, le=10_000_000)
    fraction: float = Field(ge=0.0, le=1.0)
    chapter: str | None = Field(default=None, max_length=400)


def _natural(value: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]


def _audio_files(asset: LibraryAsset) -> list[dict]:
    found = []
    for entry in asset.files or []:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            continue
        path = entry["path"]
        fmt = str(entry.get("format") or PurePosixPath(path).suffix.lstrip(".")).lower()
        if fmt in AUDIO_FORMATS:
            found.append(
                {
                    "path": path,
                    "format": fmt,
                    "filename": PurePosixPath(path).name or f"track.{fmt}",
                    "size": entry.get("size") if isinstance(entry.get("size"), int) else None,
                }
            )
    found.sort(key=lambda item: _natural(item["path"]))
    return found


def _parse_progress(row: ReadingProgress | None) -> ReadingProgressView | None:
    return _progress_view(row)


async def _recorded_files(db, asset: LibraryAsset) -> list[dict]:
    """Use the exact paths Dewarr recorded when it published this audiobook."""
    clauses = [ImportEntry.asset_id == asset.id]
    if asset.version_id:
        clauses.append(ImportEntry.version_id == asset.version_id)
    entries = await db.scalars(
        select(ImportEntry)
        .where(
            or_(*clauses),
            ImportEntry.published_at.is_not(None),
            ImportEntry.specification.is_not(None),
        )
        .order_by(ImportEntry.asset_id.is_(None), ImportEntry.published_at.desc())
    )
    for entry in entries:
        spec = entry.specification or {}
        root, folder = spec.get("destination_root"), spec.get("folder")
        if not root or not folder:
            continue
        conversion = spec.get("conversion") or {}
        names = (
            [conversion["output_name"]]
            if conversion.get("output_name")
            else [f["name"] for f in spec.get("files") or [] if isinstance(f, dict)]
        )
        order = (entry.expected_metadata or {}).get("audio_order") or []
        if order:
            rank = {PurePosixPath(path).name: i for i, path in enumerate(order)}
            names.sort(key=lambda n: rank.get(n, len(rank)))
        else:
            names.sort(key=_natural)
        found = []
        for name in names:
            fmt = PurePosixPath(name).suffix.lstrip(".").lower()
            if fmt not in AUDIO_FORMATS:
                continue
            rel = f"{folder}/{name}"
            found.append(
                {
                    "path": f"{root}/{rel}",
                    "direct": (str(root), rel),
                    "format": fmt,
                    "filename": name,
                    "size": None,
                }
            )
        if found:
            return found
    return []


async def _load_audio_asset(db, user, asset_id: UUID):
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
        raise HTTPException(404, "Audiobook not found")
    asset, library, _ = row
    if asset.medium != "audio" or asset.state == "missing-confirmed":
        raise HTTPException(404, "This library item is not an available audiobook")
    files = await _recorded_files(db, asset) or _audio_files(asset)
    if not files:
        raise HTTPException(404, "No playable audio file found for this item")
    return asset, library, files


async def _local_candidates(db, library_id: UUID, path: str) -> list[tuple[str, str]]:
    routes = list(
        await db.scalars(
            select(ImportDestination).where(
                ImportDestination.library_id == library_id,
                ImportDestination.medium == "audio",
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
        if route.backend_path:
            try:
                rel = str(PurePosixPath(path).relative_to(PurePosixPath(route.backend_path)))
            except ValueError:
                continue
            candidates.append((str(root_path), rel))
    parts = [part for part in PurePosixPath(path).parts if part not in {"/", ""}]
    for root in [*roots, *FALLBACK_ROOTS]:
        for index in range(len(parts)):
            candidates.append((root, "/".join(parts[index:])))
    return candidates


def _open_candidate(root_path: str, rel: str):
    """Return (fd, size, absolute_path) for a regular file safely beneath root_path."""
    relative_parts(rel)
    with directory(Path(root_path)) as root_fd, beneath(root_fd, rel) as file_fd:
        dup_fd = os.dup(file_fd)
    return dup_fd, os.fstat(dup_fd).st_size, str(Path(root_path) / rel)


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _words(value: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", value.lower()) if w not in {"the", "a", "an"}}


def _words_similar(left: str, right: str) -> bool:
    a, b = _words(left), _words(right)
    return bool(a and b) and len(a & b) / len(a | b) >= 0.6


def _search_by_name(roots: list[str], path: str) -> tuple[str, str] | None:
    """Last resort: find the file beneath a root, tolerating renames and spacing changes."""
    pure = PurePosixPath(path)
    wanted = [_norm(p) for p in pure.parent.parts if p not in {"/", ""}]
    stem = _norm(pure.stem)
    best: tuple[int, int, str, str] | None = None
    seen = 0
    for root in dict.fromkeys(roots):
        for here, _dirs, names in os.walk(root, followlinks=False):
            seen += 1
            if seen > 20000:
                break
            rel_dir = os.path.relpath(here, root)
            have = [_norm(p) for p in Path(rel_dir).parts if p != "."]
            folder = 0
            for a, b in zip(reversed(wanted), reversed(have), strict=False):
                if a != b:
                    break
                folder += 1
            if folder == 0 and have and _words_similar(pure.parent.name, Path(rel_dir).name):
                folder = 2
            audio = [
                n for n in names if PurePosixPath(n).suffix.lower().lstrip(".") in AUDIO_FORMATS
            ]
            for name in audio:
                name_score = 2 if name == pure.name else 0
                if _norm(PurePosixPath(name).stem) == stem:
                    name_score = max(name_score, 1)
                if not name_score and not (folder >= 2 and len(audio) == 1):
                    continue
                key = (folder, name_score)
                if best is None or key > best[:2]:
                    best = (folder, name_score, root, os.path.join(rel_dir, name))
    if best is None or (best[0] == 0 and best[1] == 0):
        return None
    return best[2], os.path.normpath(best[3])


async def _open_audio(db, library_id: UUID, path: str, direct=None):
    if direct:
        try:
            return _open_candidate(*direct)
        except (OSError, ValueError, HTTPException):
            pass
    candidates = await _local_candidates(db, library_id, path)
    for root_path, rel in candidates:
        try:
            return _open_candidate(root_path, rel)
        except (OSError, ValueError, HTTPException):
            continue
    roots = [root for root, _ in candidates]
    found = await anyio.to_thread.run_sync(_search_by_name, roots, path)
    if found:
        try:
            return _open_candidate(*found)
        except (OSError, ValueError, HTTPException):
            return None
    return None


@lru_cache(maxsize=256)
def _probe_cached(path: str, size: int, mtime: int):
    import subprocess

    try:
        out = subprocess.run(  # noqa: S603
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_chapters",
                "-show_format",
                path,
            ],
            capture_output=True,
            timeout=20,
            check=True,
        ).stdout
        return json.loads(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}


async def _probe(path: str) -> tuple[float | None, list[Chapter]]:
    try:
        stat = os.stat(path)
    except OSError:
        return None, []
    data = await asyncio.to_thread(_probe_cached, path, stat.st_size, int(stat.st_mtime))
    try:
        duration = float((data.get("format") or {}).get("duration"))
    except (TypeError, ValueError):
        duration = None
    chapters = []
    for index, entry in enumerate(data.get("chapters") or []):
        try:
            start, end = float(entry["start_time"]), float(entry["end_time"])
        except (KeyError, TypeError, ValueError):
            continue
        title = str((entry.get("tags") or {}).get("title") or f"Chapter {index + 1}").strip()
        chapters.append(Chapter(title=title[:200], start=start, end=end))
    return duration, chapters


async def _view(db, user, asset, library, files, work) -> ListenBookView:
    tracks = []
    for index, info in enumerate(files):
        duration, chapters = None, []
        opened = await _open_audio(db, library.id, info["path"], info.get("direct"))
        if opened:
            fd, size, absolute = opened
            os.close(fd)
            duration, chapters = await _probe(absolute)
            info = {**info, "size": info["size"] or size}
        tracks.append(
            Track(
                index=index,
                filename=info["filename"],
                format=info["format"],
                size=info["size"],
                duration=duration,
                chapters=chapters,
            )
        )
    progress = await db.scalar(
        select(ReadingProgress).where(
            ReadingProgress.user_id == user.id, ReadingProgress.asset_id == asset.id
        )
    )
    return ListenBookView(
        asset_id=asset.id,
        work_id=work.id if work else None,
        title=(work.title if work else None) or asset.title or files[0]["filename"],
        authors=list(work.authors or []) if work else [],
        cover_url=work.cover_url if work else None,
        tracks=tracks,
        progress=_parse_progress(progress),
    )


@router.get("/works/{work_id}/audio", response_model=ListenBookView | None)
async def work_audio(work_id: UUID, user: CurrentUser, db: Database):
    """Return the best playable audiobook asset for a work the user owns, if any."""
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
                LibraryAsset.medium == "audio",
                LibraryAsset.state != "missing-confirmed",
                Library.accessible.is_(True),
                Integration.enabled.is_(True),
                visible_library(user),
            )
            .distinct()
        )
    )
    ranked = sorted(
        (a for a in assets if _audio_files(a)),
        key=lambda a: (0 if a.state == "present" else 1, 0 if a.full_content else 1),
    )
    if not ranked:
        return None
    asset = ranked[0]
    _, library, files = await _load_audio_asset(db, user, asset.id)
    return await _view(db, user, asset, library, files, canonical)


@router.get("/assets/{asset_id}", response_model=ListenBookView)
async def listen_book(asset_id: UUID, user: CurrentUser, db: Database):
    asset, library, files = await _load_audio_asset(db, user, asset_id)
    work = await _asset_work(db, asset)
    return await _view(db, user, asset, library, files, work)


def _range(header: str | None, size: int) -> tuple[int, int] | None:
    if not header:
        return None
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    if not match or (not match.group(1) and not match.group(2)):
        raise HTTPException(416, "Invalid range")
    if match.group(1):
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else size - 1
    else:
        start, end = max(0, size - int(match.group(2))), size - 1
    end = min(end, size - 1)
    if start > end or start >= size:
        raise HTTPException(416, "Range not satisfiable")
    return start, end


@router.get("/assets/{asset_id}/tracks/{index}")
async def listen_track(
    asset_id: UUID, index: int, request: Request, user: CurrentUser, db: Database
):
    asset, library, files = await _load_audio_asset(db, user, asset_id)
    if index < 0 or index >= len(files):
        raise HTTPException(404, "Track not found")
    info = files[index]
    opened = await _open_audio(db, library.id, info["path"], info.get("direct"))
    if not opened:
        raise HTTPException(
            404,
            "Audio file is not available in a folder Dewarr can read "
            f"(looked for {info['path']}). Mount the audiobooks folder into the container.",
        )
    fd, size, _ = opened
    try:
        span = _range(request.headers.get("range"), size)
    except HTTPException:
        os.close(fd)
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    start, end = span if span else (0, size - 1)
    length = end - start + 1
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(info['filename'])}",
        "Cache-Control": "private, max-age=300",
    }
    if span:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"

    def _iter():
        remaining = length
        try:
            with open(fd, "rb", closefd=True) as handle:
                handle.seek(start)
                while remaining > 0:
                    chunk = handle.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
        except OSError:
            return

    return StreamingResponse(
        _iter(),
        status_code=206 if span else 200,
        media_type=MEDIA_TYPES.get(info["format"], "application/octet-stream"),
        headers=headers,
    )


@router.put("/assets/{asset_id}/progress", response_model=ReadingProgressView)
async def save_listen_progress(
    asset_id: UUID, body: ListenProgressInput, user: CurrentUser, db: Database
):
    asset, _, _ = await _load_audio_asset(db, user, asset_id)
    work = await _asset_work(db, asset)
    now = datetime.now(UTC)
    position = f"track:{body.track}@{body.seconds:.1f}"
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
            cfi=position,
            fraction=body.fraction,
            chapter=body.chapter,
            updated_at=now,
        )
        db.add(row)
    else:
        if work and row.work_id != work.id:
            row.work_id = work.id
        row.cfi, row.fraction, row.chapter, row.updated_at = (
            position,
            body.fraction,
            body.chapter,
            now,
        )
    await db.commit()
    await db.refresh(row)
    return _progress_view(row)
