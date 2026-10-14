ALTER TABLE car_nova_leads
  ADD COLUMN IF NOT EXISTS human_follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escalation_type TEXT,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS car_nova_leads_human_follow_up_idx
  ON car_nova_leads (human_follow_up_required, escalated_at);
