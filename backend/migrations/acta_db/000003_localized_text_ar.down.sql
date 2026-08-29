-- Reverse of 000003_localized_text_ar.up.sql. Only the additive AR sibling
-- columns are dropped; the original English columns are untouched.

ALTER TABLE action_items DROP COLUMN IF EXISTS description_ar;
ALTER TABLE action_items DROP COLUMN IF EXISTS title_ar;

ALTER TABLE agenda_items DROP COLUMN IF EXISTS description_ar;
ALTER TABLE agenda_items DROP COLUMN IF EXISTS title_ar;

ALTER TABLE meetings     DROP COLUMN IF EXISTS description_ar;
ALTER TABLE meetings     DROP COLUMN IF EXISTS title_ar;

ALTER TABLE committees   DROP COLUMN IF EXISTS charter_ar;
ALTER TABLE committees   DROP COLUMN IF EXISTS description_ar;
ALTER TABLE committees   DROP COLUMN IF EXISTS name_ar;
