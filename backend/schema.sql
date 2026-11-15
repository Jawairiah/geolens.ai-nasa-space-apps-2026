CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS accounts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 username text UNIQUE NOT NULL, password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, account_id bigint NOT NULL REFERENCES accounts(id),
 expires timestamptz NOT NULL DEFAULT now() + interval '1 day'
);
CREATE TABLE IF NOT EXISTS projects (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id bigint NOT NULL REFERENCES accounts(id), title text NOT NULL,
 region geometry(MultiPolygon,4326) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_region ON projects USING gist(region);
CREATE TABLE IF NOT EXISTS jobs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL REFERENCES projects(id), request jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_queued ON jobs(id) WHERE status='queued';

ALTER TABLE projects ALTER COLUMN region TYPE geometry(MultiPolygon,4326) USING ST_Multi(region);
