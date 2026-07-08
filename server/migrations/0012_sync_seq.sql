-- 0012_sync_seq.sql  (v0.3 sync: monotonic, skew-free cursor)
-- recorded_at has microsecond precision but a JS Date only milliseconds, so a
-- timestamp cursor re-delivers the boundary event (and clock skew across
-- devices makes wall-clock cursors unsafe anyway). A BIGSERIAL gives an exact,
-- monotonic sync cursor: pull returns events with seq > cursor, ordered by seq.
ALTER TABLE referral_events ADD COLUMN seq BIGSERIAL;
CREATE UNIQUE INDEX idx_referral_events_seq ON referral_events(seq);

-- Store the opaque cursor (last delivered seq) per device+user alongside the
-- informational last_pulled timestamp.
ALTER TABLE sync_cursors ADD COLUMN last_seq BIGINT NOT NULL DEFAULT 0;
