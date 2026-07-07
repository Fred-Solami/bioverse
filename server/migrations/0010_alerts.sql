-- 0010_alerts.sql  (v0.2 escalation — DESIGN.md §10)
-- Raised by the escalation worker scanning referral_events for SLA breaches.
-- One row per (referral, alert_type): the UNIQUE constraint makes the worker
-- idempotent (ON CONFLICT DO NOTHING), so re-scanning never duplicates alerts.
CREATE TABLE referral_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id     UUID NOT NULL REFERENCES referrals(id),
  alert_type      TEXT NOT NULL,   -- EMERGENCY_UNMATCHED|TRANSIT_OVERDUE|FEEDBACK_OVERDUE|REJECTED
  severity        TEXT NOT NULL,   -- CRITICAL|WARNING
  district        TEXT,            -- notified district (NULL if not district-scoped)
  facility_ids    UUID[] NOT NULL DEFAULT '{}',  -- notified facilities (referrer/receiver)
  detail          JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN|ACKNOWLEDGED
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referral_id, alert_type)
);
CREATE INDEX idx_alerts_district ON referral_alerts(district, status);
CREATE INDEX idx_alerts_facilities ON referral_alerts USING GIN(facility_ids);
