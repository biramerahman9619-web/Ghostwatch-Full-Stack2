CREATE TABLE IF NOT EXISTS pick_results (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  pick_id TEXT NOT NULL,
  result TEXT CHECK (result IN ('hit', 'miss', 'push')),
  settled_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, pick_id)
);
