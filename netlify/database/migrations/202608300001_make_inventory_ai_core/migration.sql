-- Inventory becomes a first-class dependency of TITAN AI.
-- Adds normalized vehicle attributes, feed/sync freshness tracking, a real
-- lead -> vehicle relationship, and durable vehicle snapshots on leads and
-- appointments so the CRM never relies on free-text vehicle names alone.

-- 1. Normalized inventory attributes used by search and AI retrieval.
-- NOTE: vehicle_type is the body style column (SUV, Sedan, Truck, ...).
ALTER TABLE carnova_inventory
  ADD COLUMN IF NOT EXISTS fuel_type TEXT,
  ADD COLUMN IF NOT EXISTS drivetrain TEXT,
  ADD COLUMN IF NOT EXISTS transmission TEXT,
  ADD COLUMN IF NOT EXISTS engine TEXT,
  ADD COLUMN IF NOT EXISTS doors INTEGER,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_reference TEXT,
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

UPDATE carnova_inventory
SET status_changed_at = COALESCE(status_changed_at, updated_at, date_added),
    last_seen_at = COALESCE(last_seen_at, updated_at, date_added);

-- 2. Full dealership lifecycle statuses TITAN must respect.
ALTER TABLE carnova_inventory DROP CONSTRAINT IF EXISTS carnova_inventory_status_check;
ALTER TABLE carnova_inventory ADD CONSTRAINT carnova_inventory_status_check
  CHECK (status IN (
    'available', 'reserved', 'in_transit', 'sold', 'transferred', 'removed', 'unavailable'
  ));

-- 3. Inventory feed sources. Configuration only: no live DMS integration is
-- fabricated here, but CSV / dealer API / DMS feeds all synchronize through
-- this record so freshness is always attributable to a source.
CREATE TABLE IF NOT EXISTS carnova_inventory_sources (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'csv'
    CHECK (source_type IN ('manual', 'csv', 'api', 'dms')),
  provider TEXT,
  endpoint_url TEXT,
  sync_schedule TEXT NOT NULL DEFAULT 'manual'
    CHECK (sync_schedule IN ('manual', 'hourly', 'daily', 'twice_daily')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  stale_after_hours INTEGER NOT NULL DEFAULT 24,
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT NOT NULL DEFAULT 'never'
    CHECK (last_sync_status IN ('never', 'success', 'partial', 'failed')),
  last_sync_message TEXT,
  last_sync_vehicle_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dealership_id, name)
);

-- 4. Synchronization history so "last inventory sync" is auditable.
CREATE TABLE IF NOT EXISTS carnova_inventory_syncs (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES carnova_inventory_sources(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'csv',
  status TEXT NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'partial', 'failed')),
  vehicles_received INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Real CUSTOMER -> LEAD -> VEHICLE -> DEALERSHIP relationship. A lead can
-- be interested in more than one real inventory record, and the identifying
-- vehicle fields are copied so history survives inventory turnover.
CREATE TABLE IF NOT EXISTS carnova_lead_vehicles (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES carnova_crm_leads(id) ON DELETE CASCADE,
  inventory_id TEXT REFERENCES carnova_inventory(id) ON DELETE SET NULL,
  stock_number TEXT,
  vin TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  trim TEXT,
  interest_level TEXT NOT NULL DEFAULT 'interested'
    CHECK (interest_level IN ('primary', 'interested', 'alternative', 'declined')),
  captured_by TEXT NOT NULL DEFAULT 'ai'
    CHECK (captured_by IN ('ai', 'user', 'import', 'capture')),
  notes TEXT,
  first_interest_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_interest_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, inventory_id)
);

-- 6. Durable vehicle snapshots: the identifying vehicle data recorded at the
-- moment of association (vehicle id, stock number, VIN, year, make, model).
ALTER TABLE carnova_crm_leads
  ADD COLUMN IF NOT EXISTS vehicle_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE carnova_appointments
  ADD COLUMN IF NOT EXISTS vehicle_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE carnova_crm_leads l
SET vehicle_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'inventoryId', i.id,
      'stockNumber', i.stock_number,
      'vin', i.vin,
      'year', i.year,
      'make', i.make,
      'model', i.model,
      'trim', i.trim,
      'capturedAt', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
FROM carnova_inventory i
WHERE i.id = l.inventory_id
  AND i.dealership_id = l.dealership_id
  AND l.vehicle_snapshot = '{}'::jsonb;

UPDATE carnova_appointments a
SET vehicle_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'inventoryId', i.id,
      'stockNumber', i.stock_number,
      'vin', i.vin,
      'year', i.year,
      'make', i.make,
      'model', i.model,
      'trim', i.trim,
      'capturedAt', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
FROM carnova_inventory i
WHERE i.id = a.inventory_id
  AND i.dealership_id = a.dealership_id
  AND a.vehicle_snapshot = '{}'::jsonb;

-- Backfill the lead -> vehicle relationship from existing single-vehicle links.
INSERT INTO carnova_lead_vehicles (
  id, dealership_id, lead_id, inventory_id, stock_number, vin, year, make, model, trim,
  interest_level, captured_by, first_interest_at, last_interest_at
)
SELECT
  gen_random_uuid()::text, l.dealership_id, l.id, i.id, i.stock_number, i.vin,
  i.year, i.make, i.model, i.trim, 'primary', 'user', l.created_at, l.updated_at
FROM carnova_crm_leads l
JOIN carnova_inventory i
  ON i.id = l.inventory_id AND i.dealership_id = l.dealership_id
ON CONFLICT (lead_id, inventory_id) DO NOTHING;

-- 7. Search and retrieval indexes. All inventory access is dealership scoped.
CREATE INDEX IF NOT EXISTS carnova_inventory_dealer_status_idx
  ON carnova_inventory (dealership_id, status, date_added DESC);
CREATE INDEX IF NOT EXISTS carnova_inventory_make_model_idx
  ON carnova_inventory (dealership_id, LOWER(make), LOWER(model));
CREATE INDEX IF NOT EXISTS carnova_inventory_stock_idx
  ON carnova_inventory (dealership_id, LOWER(stock_number));
CREATE INDEX IF NOT EXISTS carnova_inventory_vin_idx
  ON carnova_inventory (dealership_id, LOWER(vin));
CREATE INDEX IF NOT EXISTS carnova_inventory_price_idx
  ON carnova_inventory (dealership_id, COALESCE(internet_price, price, msrp));
CREATE INDEX IF NOT EXISTS carnova_inventory_features_idx
  ON carnova_inventory USING GIN (features);
CREATE INDEX IF NOT EXISTS carnova_lead_vehicles_lead_idx
  ON carnova_lead_vehicles (dealership_id, lead_id, last_interest_at DESC);
CREATE INDEX IF NOT EXISTS carnova_lead_vehicles_inventory_idx
  ON carnova_lead_vehicles (dealership_id, inventory_id);
CREATE INDEX IF NOT EXISTS carnova_inventory_syncs_recent_idx
  ON carnova_inventory_syncs (dealership_id, started_at DESC);
CREATE INDEX IF NOT EXISTS carnova_inventory_sources_dealer_idx
  ON carnova_inventory_sources (dealership_id, enabled, last_synced_at DESC);
