import type { SearchMode } from "../types";

const MODES: { value: SearchMode; label: string; hint: string }[] = [
  { value: "hybrid", label: "Hybrid", hint: "Vector + keyword, fused with Reciprocal Rank Fusion" },
  { value: "vector", label: "Vector", hint: "Embedding similarity (pgvector, cosine)" },
  { value: "keyword", label: "Keyword", hint: "Postgres full-text search" },
];

export function ModeToggle(props: { value: SearchMode; onChange: (mode: SearchMode) => void; label: string }) {
  return (
    <div className="mode-toggle" role="radiogroup" aria-label={props.label}>
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={props.value === m.value}
          className={props.value === m.value ? "on" : ""}
          title={m.hint}
          onClick={() => props.onChange(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
