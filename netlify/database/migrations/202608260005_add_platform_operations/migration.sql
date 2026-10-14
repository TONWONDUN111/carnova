ALTER TABLE carnova_dealerships
  ADD COLUMN IF NOT EXISTS platform_status TEXT NOT NULL DEFAULT 'active'
    CHECK (platform_status IN ('active', 'suspended', 'closed', 'transferring')),
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial', 'active', 'past_due', 'cancelled')),
  ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS carnova_platform_operations (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  actor_identity_user_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('export', 'transfer', 'status_change')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carnova_platform_operations_dealership_idx
  ON carnova_platform_operations (dealership_id, created_at DESC);
