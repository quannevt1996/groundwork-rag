import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { DocumentRecord } from "./types";

/** Documents of the selected collection, re-fetched every second while any are still being processed. */
export function useDocuments(collectionId: string | null) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!collectionId) {
      setDocuments([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const docs = await api.documents(collectionId);
        if (cancelled) return;
        setDocuments(docs);
        setError(null);
        if (docs.some((d) => d.status === "queued" || d.status === "processing")) timer = setTimeout(load, 1000);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collectionId, version]);

  return { documents, error, refresh };
}
