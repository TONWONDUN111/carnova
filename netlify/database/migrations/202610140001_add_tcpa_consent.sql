-- TCPA consent gate, urgent-keyword flags, lead-local texting window, and
-- dealr.cloud calendar sync status. Purely additive.

-- 1. One row per consent a customer gave (or a salesperson recorded). The
-- exact disclosure text and version shown are stored with it. STOP revokes.
CREATE TABLE IF NOT EXISTS carnova_consents (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES carnova_crm_leads(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('form', 'chat', 'manual')),
  disclosure_version TEXT NOT NULL,
  disclosure_text TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  recorded_by_user_id TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carnova_consents_phone_idx
  ON carnova_consents (dealership_id, phone) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS carnova_consents_lead_idx
  ON carnova_consents (dealership_id, lead_id);

ALTER TABLE carnova_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON carnova_consents;
CREATE POLICY tenant_isolation ON carnova_consents
  USING (dealership_id = current_setting('app.dealership_id', true));

-- 2. STOP confirmations are sent exactly once per opt-out.
ALTER TABLE carnova_opt_outs
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;

-- 3. Lead flags: urgent keywords, lead-local timezone from ZIP, and the single
-- after-hours reply.
ALTER TABLE carnova_crm_leads
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS lead_timezone TEXT,
  ADD COLUMN IF NOT EXISTS urgent_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS urgent_keyword TEXT,
  ADD COLUMN IF NOT EXISTS urgent_message TEXT,
  ADD COLUMN IF NOT EXISTS after_hours_reply_at TIMESTAMPTZ;

-- 4. Andy bookings: owner email and dealr.cloud calendar sync bookkeeping.
ALTER TABLE carnova_appointments
  ADD COLUMN IF NOT EXISTS owner_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dealr_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS dealr_sync_error TEXT;

-- 5. Website chat widget: the visitor's chat session is linked to the lead it
-- created, stored only as a hash.
ALTER TABLE carnova_crm_leads
  ADD COLUMN IF NOT EXISTS widget_session_hash TEXT;
CREATE INDEX IF NOT EXISTS carnova_crm_leads_widget_session_idx
  ON carnova_crm_leads (widget_session_hash) WHERE widget_session_hash IS NOT NULL;
