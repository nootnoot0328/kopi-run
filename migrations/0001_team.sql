CREATE TABLE team_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO team_state (id, data) VALUES
  (1, '{"roster":[],"history":[],"customs":[],"groups":[]}');
