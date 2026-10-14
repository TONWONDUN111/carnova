CREATE TABLE IF NOT EXISTS car_nova_leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  vehicle_interest TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  appointment_at TIMESTAMPTZ,
  appointment_status TEXT,
  source TEXT NOT NULL DEFAULT 'carnova-ai-bdc',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  conversation JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS car_nova_leads_appointment_at_idx
  ON car_nova_leads (appointment_at);

CREATE INDEX IF NOT EXISTS car_nova_leads_status_idx
  ON car_nova_leads (status);
