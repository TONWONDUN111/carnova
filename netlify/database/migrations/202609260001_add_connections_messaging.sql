-- Connect Dealership System, SMS messaging (Andy), follow-up sequences,
-- opt-outs, impersonation audit, wizard fields, new roles, and row level
-- security as defense in depth. Purely additive: nothing is dropped.

-- 1. Roles: add owner and sales alongside the existing admin, manager, bdc,
-- salesperson roles.
ALTER TABLE carnova_users DROP CONSTRAINT IF EXISTS carnova_users_role_check;
ALTER TABLE carnova_users ADD CONSTRAINT carnova_users_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'bdc', 'sales', 'salesperson'));

ALTER TABLE carnova_users
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notify_sms BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Dealership profile fields used by the Add Dealership wizard and by the
-- tokenized inbound endpoints (ADF email, inventory feed, lead form).
ALTER TABLE carnova_dealerships
  ADD COLUMN IF NOT EXISTS logo_key TEXT,
  ADD COLUMN IF NOT EXISTS brand_primary TEXT,
  ADD COLUMN IF NOT EXISTS brand_accent TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS inbound_token TEXT,
  ADD COLUMN IF NOT EXISTS sms_from_number TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

UPDATE carnova_dealerships
SET inbound_token = LOWER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 16))
WHERE inbound_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS carnova_dealerships_inbound_token_idx
  ON carnova_dealerships (inbound_token);
CREATE INDEX IF NOT EXISTS carnova_dealerships_sms_from_idx
  ON carnova_dealerships (sms_from_number);

-- 3. Connections to dealership systems (dealr.cloud, vAuto Provision, ProMax,
-- Other/Manual). Direct API types never become active without partner access.
CREATE TABLE IF NOT EXISTS carnova_connections (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  system TEXT NOT NULL CHECK (system IN ('dealr_cloud', 'vauto_provision', 'promax', 'manual')),
  type TEXT NOT NULL CHECK (type IN ('lead_email', 'inventory_export', 'inventory_feed', 'inventory_upload', 'lead_form', 'direct_api')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'error', 'disconnected')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dealership_id, system, type)
);
CREATE INDEX IF NOT EXISTS carnova_connections_dealer_idx
  ON carnova_connections (dealership_id, status);

CREATE TABLE IF NOT EXISTS carnova_partner_access_requests (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  system TEXT NOT NULL,
  requested_by_identity_user_id TEXT,
  requested_by_email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. SMS opt-outs. A number listed here for a dealership is never texted by
-- that dealership again.
CREATE TABLE IF NOT EXISTS carnova_opt_outs (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  keyword TEXT,
  lead_id TEXT REFERENCES carnova_crm_leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dealership_id, phone)
);

-- 5. Lead messaging state: follow-up sequence progress, first response time.
ALTER TABLE carnova_crm_leads
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sequence_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sequence_step INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sequence_next_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sequence_stopped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sequence_stop_reason TEXT,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

UPDATE carnova_crm_leads SET phone_e164 = CASE
    WHEN LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 10 THEN '+1' || REGEXP_REPLACE(phone, '[^0-9]', '', 'g')
    WHEN LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 11 AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '1%'
      THEN '+' || REGEXP_REPLACE(phone, '[^0-9]', '', 'g')
    ELSE NULL END
WHERE phone IS NOT NULL AND phone_e164 IS NULL;

CREATE INDEX IF NOT EXISTS carnova_crm_leads_phone_idx
  ON carnova_crm_leads (dealership_id, phone_e164);
CREATE INDEX IF NOT EXISTS carnova_crm_leads_email_idx
  ON carnova_crm_leads (dealership_id, LOWER(email));
CREATE INDEX IF NOT EXISTS carnova_crm_leads_sequence_idx
  ON carnova_crm_leads (sequence_next_at) WHERE sequence_stopped_at IS NULL;

-- 6. Appointment reminder bookkeeping so each reminder is sent exactly once.
ALTER TABLE carnova_appointments
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_day_before_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_morning_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS post_visit_sent_at TIMESTAMPTZ;

-- 7. Message delivery metadata for SMS.
ALTER TABLE carnova_messages
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;

-- 8. Platform owner audit: dealership creation and impersonation.
ALTER TABLE carnova_platform_operations DROP CONSTRAINT IF EXISTS carnova_platform_operations_operation_type_check;
ALTER TABLE carnova_platform_operations ADD CONSTRAINT carnova_platform_operations_operation_type_check
  CHECK (operation_type IN ('export', 'transfer', 'status_change', 'create', 'impersonate_start', 'impersonate_end'));

CREATE TABLE IF NOT EXISTS carnova_impersonations (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  actor_identity_user_id TEXT NOT NULL,
  actor_email TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Row level security. The application's server functions connect as the
-- database owner and enforce dealership scoping in every query. RLS adds a
-- second wall for every other role (read-only analysts, future direct
-- connections): they only see rows for the dealership set in the
-- app.dealership_id session setting, and nothing at all otherwise.
DO $$
DECLARE
  tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'carnova_users', 'carnova_inventory', 'carnova_crm_leads', 'carnova_messages',
    'carnova_appointments', 'carnova_follow_ups', 'carnova_alerts', 'carnova_events',
    'carnova_automation_rules', 'carnova_platform_operations', 'carnova_inventory_sources',
    'carnova_inventory_syncs', 'carnova_lead_vehicles', 'carnova_connections',
    'carnova_partner_access_requests', 'carnova_opt_outs', 'carnova_impersonations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (dealership_id = current_setting(''app.dealership_id'', true))',
      tenant_table
    );
  END LOOP;
END $$;

ALTER TABLE carnova_dealerships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON carnova_dealerships;
CREATE POLICY tenant_isolation ON carnova_dealerships
  USING (id = current_setting('app.dealership_id', true));

-- The legacy single-tenant lead table is unused by the application. It is kept
-- (nothing is deleted) but closed to every non-owner role.
ALTER TABLE car_nova_leads ENABLE ROW LEVEL SECURITY;
