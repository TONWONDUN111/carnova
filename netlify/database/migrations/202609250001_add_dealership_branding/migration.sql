ALTER TABLE carnova_dealerships
  ADD COLUMN IF NOT EXISTS trim_color TEXT NOT NULL DEFAULT 'dark_blue'
    CHECK (trim_color IN ('dark_green', 'light_green', 'light_blue', 'dark_blue', 'slate', 'burgundy', 'charcoal'));

