-- 0009_facility_external_ids.sql  (interop: MFL carries the join keys)
-- The MOH-Zambia MFL provides each facility's identifiers in the other
-- national systems (DHIS2, SmartCare, eLMIS). Storing them now makes the
-- dhis2 ADX export and the governance-gated SmartCare/eLMIS adapters a
-- mapping exercise instead of a re-identification project (docs/INTEROP.md).
ALTER TABLE facilities
  ADD COLUMN dhis2_uid       TEXT,
  ADD COLUMN smartcare_guid  TEXT,
  ADD COLUMN elmis_id        TEXT,
  -- Provenance + freshness contract: where this row came from and when.
  ADD COLUMN source          TEXT NOT NULL DEFAULT 'DEV',  -- DEV|MFL_GITHUB|ZHFR_API
  ADD COLUMN source_synced_at TIMESTAMPTZ;

CREATE INDEX idx_facilities_dhis2_uid ON facilities(dhis2_uid);
