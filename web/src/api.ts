import type { AnswerEvent, Collection, DocumentRecord, Health, RetrievedChunk, SearchMode } from "./types";

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<Health>("/health"),
  collections: () => request<Collection[]>("/collections"),
  createCollection: (name: string) => request<Collection>("/collections", jsonBody("POST", { name })),
  documents: (collectionId: string) => request<DocumentRecord[]>(`/collections/${collectionId}/documents`),
  deleteDocument: (documentId: string) => request<void>(`/documents/${documentId}`, { method: "DELETE" }),

  upload(collectionId: string, files: File[]) {
    const form = new FormData();
    for (const file of files) form.append("file", file);
    return request<{ document: DocumentRecord; duplicate: boolean }[]>(`/collections/${collectionId}/documents`, {
      method: "POST",
      body: form,
    });
  },

  search: (collectionId: string, query: string, mode: SearchMode, k = 8) =>
    request<{ results: RetrievedChunk[] }>(`/collections/${collectionId}/search`, jsonBody("POST", { query, mode, k })),
};

/**
 * POSTs a chat message and calls `onEvent` for every server-sent event. EventSource only
 * supports GET, so this reads the response body stream and splits it on blank lines.
 */
export async function streamChat(
  collectionId: string,
  body: { message: string; conversationId?: string; mode: SearchMode },
  onEvent: (event: AnswerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/chat`, { ...jsonBody("POST", body), signal });
  if (!res.ok || !res.body) {
    const error = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(error?.error ?? `${res.status} ${res.statusText}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as AnswerEvent);
    }
  }
}
