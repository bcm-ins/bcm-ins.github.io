CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 1048576),
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, id)
);
CREATE INDEX IF NOT EXISTS images_user_created ON images(user_id, created_at);
