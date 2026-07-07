-- 0007_sync.sql
CREATE TABLE sync_cursors (
  client_id   TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id),
  last_pulled TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (client_id, user_id)
);
