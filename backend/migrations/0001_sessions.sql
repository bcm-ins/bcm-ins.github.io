CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash TEXT PRIMARY KEY,
  browser_challenge TEXT NOT NULL,
  browser_state TEXT NOT NULL,
  github_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_tickets (
  ticket_hash TEXT PRIMARY KEY,
  browser_challenge TEXT NOT NULL,
  sealed_token TEXT NOT NULL,
  login TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  token_expires_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  session_hash TEXT PRIMARY KEY,
  sealed_token TEXT NOT NULL,
  login TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  user_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS flow_expiry ON oauth_flows(expires_at);
CREATE INDEX IF NOT EXISTS ticket_expiry ON login_tickets(expires_at);
