-- SWAGReviewer Backend Schema v1
-- Postgres-first schema for GitHub PR ingestion, analysis jobs, suggestions, publishing, and feedback.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    CREATE TYPE job_status AS ENUM ('queued', 'running', 'done', 'failed', 'canceled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pr_state') THEN
    CREATE TYPE pr_state AS ENUM ('open', 'closed', 'merged');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_status') THEN
    CREATE TYPE file_status AS ENUM ('added', 'modified', 'removed', 'renamed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'suggestion_severity') THEN
    CREATE TYPE suggestion_severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'suggestion_category') THEN
    CREATE TYPE suggestion_category AS ENUM ('security', 'style', 'bugs', 'performance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'publish_mode') THEN
    CREATE TYPE publish_mode AS ENUM ('review_comments', 'issue_comments');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'comment_state') THEN
    CREATE TYPE comment_state AS ENUM ('pending', 'posted', 'failed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feedback_vote_value') THEN
    CREATE TYPE feedback_vote_value AS ENUM ('up', 'down');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS github_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_installation_id BIGINT NOT NULL UNIQUE,
  account_login TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL REFERENCES github_installations(id) ON DELETE CASCADE,
  provider_repo_id BIGINT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installation_id, provider_repo_id)
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  provider_pr_id BIGINT,
  title TEXT NOT NULL,
  state pr_state NOT NULL DEFAULT 'open',
  author_login TEXT NOT NULL,
  url TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  latest_snapshot_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_id, pr_number)
);

CREATE TABLE IF NOT EXISTS pr_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  files_count INTEGER NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pr_id, head_sha)
);

ALTER TABLE pull_requests
  DROP CONSTRAINT IF EXISTS pull_requests_latest_snapshot_id_fkey,
  ADD CONSTRAINT pull_requests_latest_snapshot_id_fkey
    FOREIGN KEY (latest_snapshot_id) REFERENCES pr_snapshots(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS snapshot_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES pr_snapshots(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  status file_status NOT NULL,
  language TEXT NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  patch TEXT NOT NULL,
  hunks JSONB,
  line_map JSONB,
  patch_hash TEXT NOT NULL,
  is_too_large BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_id, path)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_files_snapshot_id ON snapshot_files(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_files_patch_hash ON snapshot_files(patch_hash);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES pr_snapshots(id) ON DELETE CASCADE,
  status job_status NOT NULL DEFAULT 'queued',
  scope suggestion_category[] NOT NULL,
  files_filter TEXT[] NULL,
  max_comments INTEGER NOT NULL DEFAULT 50,
  progress_files_done INTEGER NOT NULL DEFAULT 0,
  progress_files_total INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL,
  timeout_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_pr_id ON analysis_jobs(pr_id);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created_at ON analysis_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_job_events_job_id ON analysis_job_events(job_id);

CREATE TABLE IF NOT EXISTS suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES pr_snapshots(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  severity suggestion_severity NOT NULL,
  category suggestion_category NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  citations JSONB NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL,
  rank_score NUMERIC(8, 3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_suggestions_job_id ON suggestions(job_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_pr_id ON suggestions(pr_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_fingerprint ON suggestions(fingerprint);

CREATE TABLE IF NOT EXISTS published_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  provider_comment_id TEXT,
  mode publish_mode NOT NULL,
  state comment_state NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pr_id, job_id, mode, suggestion_id)
);

CREATE INDEX IF NOT EXISTS idx_published_comments_pr_id ON published_comments(pr_id);
CREATE INDEX IF NOT EXISTS idx_published_comments_job_id ON published_comments(job_id);
CREATE INDEX IF NOT EXISTS idx_published_comments_idempotency ON published_comments(idempotency_key);

CREATE TABLE IF NOT EXISTS feedback_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES published_comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote feedback_vote_value NOT NULL,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_votes_comment_id ON feedback_votes(comment_id);

CREATE TABLE IF NOT EXISTS job_queue (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE UNIQUE,
  queue_name TEXT NOT NULL DEFAULT 'analysis',
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_runnable ON job_queue(queue_name, run_at, locked_at);
