CREATE TABLE IF NOT EXISTS carnova_dealerships (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  settings JSONB NOT NULL DEFAULT '{"slot_interval_minutes":30,"business_hours":{"1":["09:00","18:00"],"2":["09:00","18:00"],"3":["09:00","18:00"],"4":["09:00","18:00"],"5":["09:00","18:00"],"6":["09:00","17:00"]}}'::jsonb,
  ai_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carnova_users (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  identity_user_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'bdc', 'salesperson')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dealership_id, email),
  UNIQUE (dealership_id, identity_user_id)
);

CREATE TABLE IF NOT EXISTS carnova_inventory (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  stock_number TEXT NOT NULL,
  vin TEXT,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  mileage INTEGER,
  price NUMERIC(12,2),
  internet_price NUMERIC(12,2),
  msrp NUMERIC(12,2),
  vehicle_type TEXT,
  condition TEXT NOT NULL CHECK (condition IN ('new', 'used', 'certified')),
  exterior_color TEXT,
  interior_color TEXT,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold', 'in_transit', 'unavailable')),
  location TEXT,
  date_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dealership_id, stock_number),
  UNIQUE (dealership_id, vin)
);

CREATE TABLE IF NOT EXISTS carnova_crm_leads (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  vehicle_interest TEXT,
  inventory_id TEXT REFERENCES carnova_inventory(id) ON DELETE SET NULL,
  trade_in TEXT,
  budget TEXT,
  financing_interest BOOLEAN,
  assigned_salesperson_id TEXT REFERENCES carnova_users(id) ON DELETE SET NULL,
  assigned_bdc_agent_id TEXT REFERENCES carnova_users(id) ON DELETE SET NULL,
  temperature TEXT NOT NULL DEFAULT 'warm' CHECK (temperature IN ('hot', 'warm', 'cold')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'engaged', 'qualified', 'appointment_set', 'appointment_confirmed', 'showed', 'sold', 'lost', 'nurture')),
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  human_handoff_required BOOLEAN NOT NULL DEFAULT FALSE,
  human_handoff_reason TEXT,
  human_handoff_requested_at TIMESTAMPTZ,
  notes TEXT,
  last_contact_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carnova_messages (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES carnova_crm_leads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'ai', 'user', 'system')),
  sender_user_id TEXT REFERENCES carnova_users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carnova_appointments (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES carnova_crm_leads(id) ON DELETE CASCADE,
  inventory_id TEXT REFERENCES carnova_inventory(id) ON DELETE SET NULL,
  salesperson_id TEXT REFERENCES carnova_users(id) ON DELETE SET NULL,
  appointment_type TEXT NOT NULL DEFAULT 'showroom' CHECK (appointment_type IN ('showroom', 'test_drive', 'trade_appraisal', 'delivery', 'finance')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'scheduled', 'confirmed', 'rescheduled', 'cancelled', 'showed', 'no_show')),
  confirmation_notes TEXT,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carnova_follow_ups (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES carnova_crm_leads(id) ON DELETE CASCADE,
  assigned_user_id TEXT REFERENCES carnova_users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('call', 'text', 'email', 'appointment_reminder', 'no_show', 'hot_lead', 'human_handoff', 'unanswered')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carnova_alerts (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES carnova_crm_leads(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES carnova_appointments(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by TEXT REFERENCES carnova_users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carnova_events (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES carnova_crm_leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT REFERENCES carnova_users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carnova_automation_rules (
  id TEXT PRIMARY KEY,
  dealership_id TEXT NOT NULL REFERENCES carnova_dealerships(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  action_type TEXT NOT NULL,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carnova_inventory_search_idx ON carnova_inventory (dealership_id, status, make, model, year);
CREATE INDEX IF NOT EXISTS carnova_crm_leads_queue_idx ON carnova_crm_leads (dealership_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS carnova_crm_leads_follow_up_idx ON carnova_crm_leads (dealership_id, next_follow_up_at);
CREATE INDEX IF NOT EXISTS carnova_messages_lead_idx ON carnova_messages (dealership_id, lead_id, created_at);
CREATE INDEX IF NOT EXISTS carnova_appointments_schedule_idx ON carnova_appointments (dealership_id, starts_at, status);
CREATE INDEX IF NOT EXISTS carnova_follow_ups_due_idx ON carnova_follow_ups (dealership_id, status, due_at);
CREATE INDEX IF NOT EXISTS carnova_alerts_open_idx ON carnova_alerts (dealership_id, acknowledged, created_at DESC);
CREATE INDEX IF NOT EXISTS carnova_events_type_idx ON carnova_events (dealership_id, event_type, created_at DESC);
