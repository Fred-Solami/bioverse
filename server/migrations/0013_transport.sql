-- 0013_transport.sql  (transport coordination — the evidence-backed lever)
-- Emergency transport is the intervention with the strongest mortality signal in
-- the literature (m-mama, Tanzania: cost-effective, large pre/post reductions).
-- BioVerse already models the transport phase in its state machine (DISPATCHED →
-- IN_TRANSIT → RECEIVED) and already escalates transit delays; this adds the
-- dispatch brain — a registry of vehicles/drivers and the assignment record.

CREATE TABLE transport_resources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  vehicle_type     TEXT NOT NULL,        -- AMBULANCE|COMMUNITY_DRIVER|MOTORBIKE|BOAT
  base_facility_id UUID REFERENCES facilities(id),
  location         GEOGRAPHY(POINT,4326),
  contact_phone    TEXT,
  district         TEXT,
  is_available     BOOLEAN NOT NULL DEFAULT true,
  source           TEXT NOT NULL DEFAULT 'DEV',   -- DEV|MoH|COMMUNITY|PARTNER
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transport_location ON transport_resources USING GIST(location);
CREATE INDEX idx_transport_available ON transport_resources(is_available);

-- One active transport assignment per referral (the vehicle taking the patient).
CREATE TABLE referral_transport (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id   UUID NOT NULL REFERENCES referrals(id),
  resource_id   UUID NOT NULL REFERENCES transport_resources(id),
  status        TEXT NOT NULL DEFAULT 'REQUESTED',   -- REQUESTED|DISPATCHED|ARRIVED|CANCELLED
  driver_name   TEXT,
  contact_phone TEXT,
  eta_minutes   INTEGER,
  notes         TEXT,
  requested_by  UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referral_id)
);
CREATE INDEX idx_referral_transport_resource ON referral_transport(resource_id);
