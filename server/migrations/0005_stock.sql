-- 0005_stock.sql  (read model; eLMIS overlay — BioVerse never writes stock)
CREATE TABLE facility_stock_snapshot (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  item_code   TEXT NOT NULL,                       -- ZEML/eLMIS commodity code
  item_name   TEXT NOT NULL,
  status      TEXT NOT NULL,                       -- CRITICAL|ADEQUATE|SURPLUS|UNKNOWN
  source      TEXT NOT NULL,                       -- ELMIS|MANUAL|PHARMACY|STUB
  as_of       DATE,
  freshness   TEXT NOT NULL,                       -- REALTIME|DAILY|MONTHLY|STALE
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
