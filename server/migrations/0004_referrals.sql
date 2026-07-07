-- 0004_referrals.sql  (FHIR: ServiceRequest + Encounter)
CREATE SEQUENCE referral_reference_seq;            -- backs reference REF-YYYY-NNNNNN

CREATE TABLE referrals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             TEXT UNIQUE NOT NULL,      -- REF-2026-000123 (sequence-backed)
  patient_id            UUID NOT NULL REFERENCES patients(id),
  from_facility_id      UUID NOT NULL REFERENCES facilities(id),
  to_facility_id        UUID REFERENCES facilities(id),
  referring_user_id     UUID NOT NULL REFERENCES users(id),
  pathway               TEXT NOT NULL DEFAULT 'MATERNAL', -- MATERNAL|GENERAL (ART_LTFU later)
  reason                TEXT NOT NULL,
  clinical_summary      TEXT,
  danger_signs          JSONB NOT NULL DEFAULT '[]',
  required_capabilities JSONB NOT NULL DEFAULT '[]',
  priority              TEXT NOT NULL,             -- EMERGENCY|URGENT|ROUTINE
  current_status        TEXT NOT NULL DEFAULT 'INITIATED',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at             TIMESTAMPTZ
);
CREATE INDEX idx_referrals_status ON referrals(current_status);
CREATE INDEX idx_referrals_to_facility ON referrals(to_facility_id, current_status);

CREATE TABLE referral_events (                     -- APPEND-ONLY. The lifecycle IS this log.
  id                UUID PRIMARY KEY,              -- client-generated for offline idempotency
  referral_id       UUID NOT NULL REFERENCES referrals(id),
  from_status       TEXT,
  to_status         TEXT NOT NULL,
  actor_user_id     UUID REFERENCES users(id),
  actor_facility_id UUID REFERENCES facilities(id),
  note              TEXT,
  payload           JSONB NOT NULL DEFAULT '{}',   -- transport, feedback, rejection reason
  occurred_at       TIMESTAMPTZ NOT NULL,          -- client time
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
