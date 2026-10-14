ALTER TABLE carnova_dealerships
  ADD COLUMN IF NOT EXISTS carnova_feed_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE carnova_dealerships
SET carnova_feed_enabled = TRUE
WHERE LOWER(REGEXP_REPLACE(name, '[^a-z0-9]+', '', 'g')) = 'carnova';

