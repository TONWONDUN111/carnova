ALTER TABLE carnova_crm_leads
  ADD COLUMN IF NOT EXISTS assigned_manager_id TEXT REFERENCES carnova_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS carnova_crm_leads_manager_idx
  ON carnova_crm_leads (dealership_id, assigned_manager_id);
