-- 0002_users.sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                     -- argon2id
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL,                     -- CHW|FACILITY_STAFF|FACILITY_INCHARGE|DISTRICT_OFFICER|MOH_ADMIN
  facility_id   UUID REFERENCES facilities(id),
  district      TEXT,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
