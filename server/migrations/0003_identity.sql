-- 0003_identity.sql  (FHIR: Patient; OpenHIE Client Registry pattern)
CREATE TABLE patients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  given_name    TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  sex           TEXT,                              -- M|F|OTHER|UNKNOWN
  birth_date    DATE,
  birth_year_approx BOOLEAN NOT NULL DEFAULT false,
  phone         TEXT,
  district      TEXT,
  home_location GEOGRAPHY(POINT,4326),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE patient_identifiers (                 -- provenance-tracked, reversible links
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID NOT NULL REFERENCES patients(id),
  id_type     TEXT NOT NULL,                       -- NRC|SMARTCARE_ID|INRIS_ID|PHONE|BIOVERSE_MPI
  id_value    TEXT NOT NULL,
  asserted_by UUID REFERENCES users(id),
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(id_type, id_value, is_active)
);

CREATE TABLE match_review_queue (                  -- borderline matches: humans decide
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_a   UUID NOT NULL REFERENCES patients(id),
  candidate_b   UUID NOT NULL REFERENCES patients(id),
  score         NUMERIC NOT NULL,
  features      JSONB NOT NULL,                    -- per-field similarity breakdown
  status        TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING|LINKED|REJECTED
  decided_by    UUID REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
