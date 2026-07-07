-- 0008_refresh_tokens.sql  (v0.1 auth: rotating refresh tokens, DESIGN.md §15)
-- Raw tokens are never stored; only SHA-256 hashes. Rotation chains via replaced_by;
-- presenting a revoked token revokes the whole user family (reuse = suspected theft).
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_tokens(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
