-- 001_identity.sql — M3 Database: identity, sessions, audit, config, rate policy
-- Applied by scripts/migrate.js and auto-applied at boot when DATABASE_URL is set.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id                      text PRIMARY KEY,
  username                text NOT NULL UNIQUE,
  name                    text NOT NULL DEFAULT '',
  role_id                 text NOT NULL DEFAULT '',
  scope                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  password_hash           text,
  phone                   text NOT NULL DEFAULT '',
  status                  text NOT NULL DEFAULT 'ACTIVE',
  mfa                     boolean NOT NULL DEFAULT true,
  mfa_type                text NOT NULL DEFAULT 'TOTP',
  totp_secret             text,
  agent_id                text,
  last_login_at           bigint,
  login_count             integer NOT NULL DEFAULT 0,
  failed_login_count      integer NOT NULL DEFAULT 0,
  last_failed_at          bigint,
  sessions_invalidated_at bigint NOT NULL DEFAULT 0,
  password_changed_at     bigint,
  created_at              bigint NOT NULL DEFAULT 0,
  updated_at              bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roles (
  id          text PRIMARY KEY,
  name        text NOT NULL DEFAULT '',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sessions (
  sid               text PRIMARY KEY,
  user_id           text NOT NULL,
  created_at        bigint NOT NULL,
  last_seen_at      bigint NOT NULL DEFAULT 0,
  expires_at        bigint NOT NULL,
  absolute_expiry_at bigint NOT NULL,
  ip                text NOT NULL DEFAULT '',
  device            text NOT NULL DEFAULT '',
  device_id         text NOT NULL DEFAULT '',
  gen               integer NOT NULL DEFAULT 1,
  current_token     text,
  revoked           boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS revoked_sessions (
  sid        text PRIMARY KEY,
  revoked_at bigint NOT NULL
);

-- append-only audit: seq preserves insertion order; rows are never updated/deleted
-- except by the retention policy (documented, configurable).
CREATE TABLE IF NOT EXISTS audit_log (
  seq         bigserial PRIMARY KEY,
  id          text NOT NULL,
  username    text NOT NULL DEFAULT 'system',
  action      text NOT NULL,
  object_type text NOT NULL DEFAULT '',
  object_id   text NOT NULL DEFAULT '',
  detail      text NOT NULL DEFAULT '',
  ip          text NOT NULL DEFAULT '',
  device      text NOT NULL DEFAULT '',
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, created_at);

CREATE TABLE IF NOT EXISTS app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_policy (
  key        text PRIMARY KEY,
  policy     jsonb NOT NULL,
  updated_at bigint NOT NULL
);
