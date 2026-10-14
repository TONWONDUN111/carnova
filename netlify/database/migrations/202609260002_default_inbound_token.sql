-- New dealerships get their inbound token (ADF lead address, feed URL, lead
-- form) automatically.
ALTER TABLE carnova_dealerships
  ALTER COLUMN inbound_token SET DEFAULT LOWER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 16));

UPDATE carnova_dealerships
SET inbound_token = LOWER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 16))
WHERE inbound_token IS NULL;
