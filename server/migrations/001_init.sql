-- {{EMBEDDING_DIM}} is substituted at migration time from the configured embedder.
CREATE EXTENSION IF NOT EXISTS vector;

-- Records which embedder produced the stored vectors; mixing models in one index is silently wrong.
CREATE TABLE embedding_config (
  id integer PRIMARY KEY CHECK (id = 1),
  embedder text NOT NULL,
  dim integer NOT NULL
);

CREATE TABLE collections (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id text PRIMARY KEY,
  collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title text NOT NULL,
  source text NOT NULL,
  mime_type text NOT NULL,
  sha256 text NOT NULL,
  byte_size integer NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  error text,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, sha256)
);
CREATE INDEX documents_collection_idx ON documents (collection_id, created_at DESC);

CREATE TABLE chunks (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  -- Heading path joined with ' > ', e.g. 'On-call Runbook > Paging > Escalation'.
  section text NOT NULL DEFAULT '',
  page integer,
  content text NOT NULL,
  token_estimate integer NOT NULL,
  embedding vector({{EMBEDDING_DIM}}) NOT NULL,
  -- Headings weigh more than body text in keyword ranking.
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', section), 'A') || setweight(to_tsvector('english', content), 'B')
  ) STORED
);
CREATE INDEX chunks_collection_idx ON chunks (collection_id);
CREATE INDEX chunks_document_idx ON chunks (document_id, ordinal);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);

CREATE TABLE conversations (
  id text PRIMARY KEY,
  collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_collection_idx ON conversations (collection_id, created_at DESC);

CREATE TABLE messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  -- Assistant only: answer segments with resolved citations, and the retrieval snapshot they cite.
  segments jsonb,
  retrieval jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
