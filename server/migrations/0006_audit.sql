-- 0006_audit.sql  (APPEND-ONLY. Data Protection Act requirement.)
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  action        TEXT NOT NULL,                     -- READ|CREATE|UPDATE|EXPORT|LOGIN
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  ip_address    INET,
  detail        JSONB NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
