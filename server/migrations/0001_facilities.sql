-- 0001_facilities.sql  (FHIR: Organization + Location)
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE facilities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zhfr_code         TEXT UNIQUE NOT NULL,          -- official facility ID (ZHFR/MFL)
  name              TEXT NOT NULL,
  facility_type     TEXT NOT NULL,                 -- HEALTH_POST|HEALTH_CENTRE|L1_HOSPITAL|L2_HOSPITAL|L3_HOSPITAL|PHARMACY
  ownership         TEXT NOT NULL,                 -- MOH|FAITH_BASED|PRIVATE|ZDF|ZNS|POLICE|CORRECTIONAL
  district          TEXT NOT NULL,
  province          TEXT NOT NULL,
  location          GEOGRAPHY(POINT,4326),
  capabilities      JSONB NOT NULL DEFAULT '{}',   -- {"emonc":true,"csection":true,"blood_bank":false,...}
  parent_facility_id UUID REFERENCES facilities(id),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_facilities_location ON facilities USING GIST(location);
CREATE INDEX idx_facilities_district ON facilities(district);
