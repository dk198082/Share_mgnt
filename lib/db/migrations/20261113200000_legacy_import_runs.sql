-- Preview development has this table through Drizzle push.
-- External Azure application requires a separate reviewed release; no automatic
-- production migration or data import is authorized by this file.
CREATE TABLE IF NOT EXISTS legacy_import_runs (
  id text PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  status text NOT NULL,
  operator_id text NOT NULL,
  operator_name text NOT NULL,
  committed_by text,
  report jsonb NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);
