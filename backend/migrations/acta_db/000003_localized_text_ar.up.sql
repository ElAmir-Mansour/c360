-- Additive, backward-compatible Arabic (AR) localization columns for the Acta
-- governance catalogs. Each *_ar column is a NULLABLE sibling of the existing
-- English column. The English columns are never renamed or dropped: they stay
-- the canonical fallback that forms.LocalizedText.Localize() resolves to when the
-- AR side is empty/NULL. Consequences:
--   * An UNMIGRATED database keeps working (the seeders only write *_ar when the
--     column is present; the read path COALESCEs back to the English column).
--   * A PARTIALLY back-filled catalog still renders (NULL AR -> English fallback).
-- Idempotent (IF NOT EXISTS) so a re-run is a no-op.

ALTER TABLE committees   ADD COLUMN IF NOT EXISTS name_ar        TEXT;
ALTER TABLE committees   ADD COLUMN IF NOT EXISTS description_ar TEXT;
ALTER TABLE committees   ADD COLUMN IF NOT EXISTS charter_ar     TEXT;

ALTER TABLE meetings     ADD COLUMN IF NOT EXISTS title_ar       TEXT;
ALTER TABLE meetings     ADD COLUMN IF NOT EXISTS description_ar TEXT;

ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS title_ar       TEXT;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS description_ar TEXT;

ALTER TABLE action_items ADD COLUMN IF NOT EXISTS title_ar       TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS description_ar TEXT;
