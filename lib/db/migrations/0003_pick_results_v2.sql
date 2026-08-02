ALTER TABLE pick_results ADD COLUMN IF NOT EXISTS settled_value TEXT;
ALTER TABLE pick_results ADD COLUMN IF NOT EXISTS settled_source TEXT DEFAULT 'manual';
