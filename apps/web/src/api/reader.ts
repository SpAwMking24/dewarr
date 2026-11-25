import { ApiError, getCsrf } from "./client";

export interface ReadingProgress {
  cfi: string | null;
  fraction: number;
  chapter: string | null;
  updated_at: string;
}

export interface ReaderBook {
  asset_id: string;
  work_id: string | null;
  title: string;
  authors: string[];
  cover_url: string | null;
  format: string;
  filename: string;
  size: number | null;
  progress: ReadingProgress | null;
}

export interface ContinueReadingItem {
  asset_id: string;
  work_id: string | null;
  title: string;
  authors: string[];
  cover_url: string | null;
  format: string;
  fraction: number;
  chapter: string | null;
  updated_at: string;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "Could not load ebook.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

export async function fetchWorkEbook(
  workId: string,
  signal?: AbortSignal,
): Promise<ReaderBook | null> {
  const response = await fetch(`/api/reader/works/${workId}/ebook`, {
    credentials: "same-origin",
    signal,
  });
  return readJson<ReaderBook | null>(response);
}

export async function fetchReaderBook(
  assetId: string,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  const response = await fetch(`/api/reader/assets/${assetId}`, {
    credentials: "same-origin",
    signal,
  });
  return readJson<ReaderBook>(response);
}

export async function fetchReaderFile(
  assetId: string,
  filename: string,
  signal?: AbortSignal,
): Promise<File> {
  const response = await fetch(`/api/reader/assets/${assetId}/file`, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    let detail = "Could not load ebook file.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // ignore
    }
    throw new ApiError(detail, response.status);
  }
  const blob = await response.blob();
  return new File([blob], filename, {
    type: blob.type || "application/octet-stream",
  });
}

export async function saveReadingProgress(
  assetId: string,
  progress: { cfi: string | null; fraction: number; chapter: string | null },
  keepalive = false,
): Promise<ReadingProgress | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const csrf = getCsrf();
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const response = await fetch(`/api/reader/assets/${assetId}/progress`, {
    method: "PUT",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(progress),
    keepalive,
  });
  if (!response.ok) return null;
  return (await response.json()) as ReadingProgress;
}

export async function fetchContinueReading(
  signal?: AbortSignal,
): Promise<ContinueReadingItem[]> {
  const response = await fetch("/api/reader/continue", {
    credentials: "same-origin",
    signal,
  });
  return readJson<ContinueReadingItem[]>(response);
}
