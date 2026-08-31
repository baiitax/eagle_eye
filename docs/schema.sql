-- ============================================================================
-- NDC E-SITUATION ROOM 2027 — PRODUCTION DATABASE SCHEMA (PostgreSQL + PostGIS)
-- The prototype ships an in-memory store with identical entity shapes; this DDL
-- is the production target. All critical records use UUIDs. Timestamps are UTC;
-- display is Africa/Lagos.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------- identity & access ----------
CREATE TABLE roles (
  id           TEXT PRIMARY KEY,               -- 'superadmin', 'director', …
  name         TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE permissions (
  role_id  TEXT REFERENCES roles(id) ON DELETE CASCADE,
  perm     TEXT NOT NULL,                      -- 'results.verify', …
  PRIMARY KEY (role_id, perm)
);
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  role_id       TEXT NOT NULL REFERENCES roles(id),
  scope_lga     TEXT,                          -- nullable scope binding
  scope_senatorial TEXT,
  password_hash TEXT NOT NULL,                 -- scrypt/argon2, never plaintext
  mfa_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',-- ACTIVE | DISABLED
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip         TEXT, device TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID,
  imei         TEXT, model TEXT, os TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',-- PENDING | APPROVED | REVOKED | LOCKED
  registered_at TIMESTAMPTZ DEFAULT now(),
  last_seen    TIMESTAMPTZ
);

-- ---------- geography (configurable hierarchy) ----------
CREATE TABLE countries (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE states    (id TEXT PRIMARY KEY, country_id TEXT NOT NULL REFERENCES countries(id), name TEXT NOT NULL);
CREATE TABLE senatorial_districts (id TEXT PRIMARY KEY, state_id TEXT NOT NULL REFERENCES states(id), name TEXT NOT NULL);
CREATE TABLE lgas (
  id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
  state_id TEXT NOT NULL REFERENCES states(id),
  senatorial_id TEXT REFERENCES senatorial_districts(id),
  name TEXT NOT NULL,
  geom GEOMETRY(MultiPolygon, 4326)
);
CREATE TABLE wards (
  id TEXT PRIMARY KEY, lga_id TEXT NOT NULL REFERENCES lgas(id),
  name TEXT NOT NULL, geom GEOMETRY(MultiPolygon, 4326)
);
CREATE TABLE polling_units (
  id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
  ward_id TEXT NOT NULL REFERENCES wards(id),
  lga_id  TEXT NOT NULL REFERENCES lgas(id),
  name TEXT NOT NULL, geom GEOMETRY(Point, 4326),
  registered_voters INTEGER
);
CREATE INDEX idx_pu_lga ON polling_units(lga_id);
CREATE INDEX idx_pu_geom ON polling_units USING GIST(geom);
CREATE INDEX idx_lga_geom ON lgas USING GIST(geom);

-- ---------- elections ----------
CREATE TABLE elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, type TEXT NOT NULL,      -- GOVERNORSHIP | SENATE | …
  level TEXT NOT NULL,                         -- STATE | SENATORIAL | CONSTITUENCY
  scope TEXT, date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIGURED'    -- CONFIGURED | ACTIVE | CLOSED | ARCHIVED
);
CREATE TABLE parties (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, color TEXT);
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id),
  party_id TEXT REFERENCES parties(id),
  name TEXT NOT NULL, running_mate TEXT
);

-- ---------- field ops ----------
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id),
  pu_id TEXT NOT NULL REFERENCES polling_units(id),
  ward_id TEXT NOT NULL REFERENCES wards(id),
  lga_id TEXT NOT NULL REFERENCES lgas(id),
  device_id UUID REFERENCES devices(id),
  duty_state TEXT NOT NULL DEFAULT 'NOT_ACTIVATED',
  gps_lat DOUBLE PRECISION, gps_lon DOUBLE PRECISION,
  online BOOLEAN DEFAULT FALSE, network TEXT, battery INTEGER,
  activated_at TIMESTAMPTZ, checked_in_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);

-- ---------- results & evidence ----------
CREATE TABLE result_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id),
  pu_id TEXT NOT NULL REFERENCES polling_units(id),
  ward_id TEXT NOT NULL, lga_id TEXT NOT NULL,
  agent_id UUID REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  -- UNVERIFIED → SUBMITTED → UNDER_REVIEW → VERIFIED | REJECTED | DISPUTED | ARCHIVED
  valid_votes INTEGER, rejected_ballots INTEGER, total_ballots INTEGER,
  accredited INTEGER, registered INTEGER,
  ocr_payload JSONB,
  submitted_at TIMESTAMPTZ, verified_at TIMESTAMPTZ, rejected_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'LIVE',        -- LIVE | SIM
  UNIQUE (election_id, pu_id)                  -- duplicates never silently overwritten
);
CREATE TABLE result_items (
  submission_id UUID NOT NULL REFERENCES result_submissions(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id),
  votes INTEGER NOT NULL,
  PRIMARY KEY (submission_id, candidate_id)
);
CREATE TABLE result_versions (                -- corrections never overwrite originals
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES result_submissions(id),
  version_no INTEGER NOT NULL,
  previous JSONB NOT NULL, changes JSONB NOT NULL,
  reason TEXT NOT NULL,
  proposed_by UUID REFERENCES users(id), approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES result_submissions(id),
  kind TEXT NOT NULL,                          -- EC8A | PHOTO | VIDEO | AUDIO
  sha256 TEXT NOT NULL,                        -- cryptographic fingerprint
  perceptual_hash TEXT,
  size_bytes BIGINT, pages INTEGER, mime TEXT,
  object_key TEXT NOT NULL,                    -- immutable object storage
  device_id UUID, agent_id UUID,
  gps_lat DOUBLE PRECISION, gps_lon DOUBLE PRECISION,
  captured_at TIMESTAMPTZ, uploaded_at TIMESTAMPTZ,
  is_original BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_evidence_sha ON evidence(sha256);
CREATE TABLE custody_events (                 -- chain of custody
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES evidence(id),
  step TEXT NOT NULL,                          -- CAPTURED → UPLOADED → RECEIVED → REVIEWED → VERIFIED → DISPUTED → ARCHIVED
  by_user TEXT, note TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES result_submissions(id),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,                        -- APPROVE | REJECT | DISPUTE | FLAG_SECOND_REVIEW | REQUEST_CLARIFICATION
  reason TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now(),
  second_reviewer_id UUID REFERENCES users(id),
  second_at TIMESTAMPTZ, second_action TEXT
);
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES result_submissions(id),
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | UNDER_REVIEW | RESOLVED | ESCALATED | CLOSED
  created_by UUID REFERENCES users(id), resolution TEXT, resolved_by UUID, resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES result_submissions(id),
  released_by TEXT, released_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- incidents / SOS / streams ----------
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL, subcategory TEXT NOT NULL, -- SECURITY | PROCESS | TECHNOLOGY | ACCESSIBILITY | OTHER
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  pu_id TEXT, ward_id TEXT, lga_id TEXT,
  gps_lat DOUBLE PRECISION, gps_lon DOUBLE PRECISION,
  reporter_id UUID, description TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',         -- NEW | ACKNOWLEDGED | INVESTIGATING | ESCALATED | RESOLVED | CLOSED | DISPUTED
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ
);
CREATE TABLE incident_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  status TEXT, note TEXT, by_user TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sos_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  agent_id UUID, pu_id TEXT, ward_id TEXT, lga_id TEXT,
  category TEXT, gps_lat DOUBLE PRECISION, gps_lon DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'ACTIVE',       -- ACTIVE | ACKNOWLEDGED | RESPONDING | RESOLVED
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ
);
CREATE TABLE sos_acks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sos_id UUID NOT NULL REFERENCES sos_events(id),
  by_user TEXT, note TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE video_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID, pu_id TEXT, lga_id TEXT,
  status TEXT NOT NULL,                        -- LIVE | BUFFERING | ENDED
  signed_url TEXT,                             -- short-lived signed streaming URL
  bitrate_kbps INTEGER, fps INTEGER, viewers INTEGER,
  started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, pinned BOOLEAN DEFAULT FALSE
);

-- ---------- notifications / audit / system ----------
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  role_ids TEXT[],
  title TEXT NOT NULL, body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',     -- CRITICAL | HIGH | MEDIUM | LOW
  link TEXT, read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (                       -- append-only / immutable
  id BIGSERIAL PRIMARY KEY,
  user_id UUID, username TEXT,
  action TEXT NOT NULL,                        -- LOGIN, RESULT_SUBMITTED, RESULT_APPROVE, …
  object_type TEXT, object_id TEXT, detail TEXT,
  ip TEXT, device TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE system_health (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL, status TEXT NOT NULL,
  metric JSONB, checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE system_config (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_by UUID, updated_at TIMESTAMPTZ);

-- ---------- data retention ----------
-- Evidence and audit rows are ARCHIVED rather than deleted. Deletion requires
-- authorization, reason, confirmation and an audit entry:
CREATE TABLE deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type TEXT, object_id TEXT,
  requested_by UUID, approved_by UUID,
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RBAC: authorization is enforced server-side on every endpoint; the database
-- additionally grants only role-scoped read paths via row-level policies in
-- production (e.g. LG coordinators see only their LGA's rows).
