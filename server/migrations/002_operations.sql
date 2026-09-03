-- 002_operations.sql — M3 Database: geography, operations entities, snapshot store
-- These tables form the future repository layer (M4+ writes real rows); today they
-- document the data model and back up exports. The demo runtime additionally keeps a
-- JSONB state snapshot (below) for cross-cold-start continuity on serverless hosts.

CREATE TABLE IF NOT EXISTS lgas (
  id         text PRIMARY KEY,
  code       text NOT NULL,
  name       text NOT NULL,
  senatorial text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS wards (
  id    text PRIMARY KEY,
  lga_id text NOT NULL REFERENCES lgas(id) ON DELETE CASCADE,
  name  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wards_lga ON wards(lga_id);

CREATE TABLE IF NOT EXISTS pus (
  id      text PRIMARY KEY,
  ward_id text NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  lga_id  text NOT NULL REFERENCES lgas(id) ON DELETE CASCADE,
  name    text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pus_lga ON pus(lga_id);

CREATE TABLE IF NOT EXISTS elections (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  type   text NOT NULL,
  level  text NOT NULL,
  scope  text NOT NULL DEFAULT '',
  date   text NOT NULL,
  status text NOT NULL DEFAULT 'CONFIGURED'
);

CREATE TABLE IF NOT EXISTS agents (
  id          text PRIMARY KEY,
  code        text NOT NULL,
  name        text NOT NULL DEFAULT '',
  pu_id       text,
  ward_id     text,
  lga_id      text,
  device_id   text,
  user_id     text,
  duty_state  text NOT NULL DEFAULT 'NOT_ACTIVATED',
  phone       text NOT NULL DEFAULT '',
  created_at  bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agents_lga ON agents(lga_id);

CREATE TABLE IF NOT EXISTS devices (
  id            text PRIMARY KEY,
  agent_id      text,
  model         text NOT NULL DEFAULT '',
  os            text NOT NULL DEFAULT '',
  imei          text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'APPROVED',
  registered_at bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id           text PRIMARY KEY,
  code         text NOT NULL,
  pu_id        text NOT NULL,
  ward_id      text NOT NULL,
  lga_id       text NOT NULL,
  senatorial   text NOT NULL DEFAULT '',
  election_id  text NOT NULL,
  agent_id     text NOT NULL,
  status       text NOT NULL DEFAULT 'UNVERIFIED',
  valid_votes  integer NOT NULL DEFAULT 0,
  rejected     integer NOT NULL DEFAULT 0,
  accredited   integer NOT NULL DEFAULT 0,
  registered   integer NOT NULL DEFAULT 0,
  items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  anomalies    jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at bigint NOT NULL DEFAULT 0,
  verified_at  bigint,
  version      integer NOT NULL DEFAULT 1,
  created_at   bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_submissions_lga ON submissions(lga_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

CREATE TABLE IF NOT EXISTS evidence (
  id            text PRIMARY KEY,
  code          text NOT NULL,
  submission_id text,
  kind          text NOT NULL DEFAULT 'EC8A',
  sha256        text,
  captured_at   bigint NOT NULL DEFAULT 0,
  chain         text NOT NULL DEFAULT '',
  created_at    bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_evidence_submission ON evidence(submission_id);

CREATE TABLE IF NOT EXISTS incidents (
  id          text PRIMARY KEY,
  code        text NOT NULL,
  category    text NOT NULL DEFAULT '',
  subcategory text NOT NULL DEFAULT '',
  severity    integer NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'NEW',
  pu_id       text,
  ward_id     text,
  lga_id      text,
  description text NOT NULL DEFAULT '',
  created_at  bigint NOT NULL DEFAULT 0,
  updated_at  bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incidents_lga ON incidents(lga_id);

CREATE TABLE IF NOT EXISTS sos_events (
  id         text PRIMARY KEY,
  code       text NOT NULL,
  category   text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'ACTIVE',
  pu_id      text,
  ward_id    text,
  lga_id     text,
  created_at bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS streams (
  id         text PRIMARY KEY,
  pu_id      text,
  status     text NOT NULL DEFAULT 'LIVE',
  started_at bigint NOT NULL DEFAULT 0,
  ended_at   bigint
);

CREATE TABLE IF NOT EXISTS notifications (
  id         text PRIMARY KEY,
  user_id    text,
  role_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
  title      text NOT NULL DEFAULT '',
  body       text NOT NULL DEFAULT '',
  priority   text NOT NULL DEFAULT 'MEDIUM',
  read       boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL DEFAULT 0
);

-- JSONB continuity snapshot: lets the in-memory demo runtime survive serverless
-- cold starts when no state file exists (hydrated at boot, throttled writer).
CREATE TABLE IF NOT EXISTS state_snapshots (
  id         bigserial PRIMARY KEY,
  saved_at   bigint NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  state      jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_saved ON state_snapshots(saved_at DESC);
