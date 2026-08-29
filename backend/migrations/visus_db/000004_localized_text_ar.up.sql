-- Additive, backward-compatible Arabic (AR) localization columns for the Visus
-- executive catalogs. Each *_ar column is a NULLABLE sibling of the existing
-- English column. The English columns are never renamed or dropped: they stay
-- the canonical fallback that forms.LocalizedText.Localize() resolves to when the
-- AR side is empty/NULL. Consequences:
--   * An UNMIGRATED database keeps working (seeders only write *_ar when the
--     column is present; the read path COALESCEs back to the English column).
--   * A PARTIALLY back-filled catalog still renders (NULL AR -> English fallback).
-- Idempotent (IF NOT EXISTS) so a re-run is a no-op.

ALTER TABLE visus_dashboards         ADD COLUMN IF NOT EXISTS name_ar        TEXT;
ALTER TABLE visus_dashboards         ADD COLUMN IF NOT EXISTS description_ar TEXT;

ALTER TABLE visus_widgets            ADD COLUMN IF NOT EXISTS title_ar       TEXT;

ALTER TABLE visus_kpi_definitions    ADD COLUMN IF NOT EXISTS name_ar        TEXT;
ALTER TABLE visus_kpi_definitions    ADD COLUMN IF NOT EXISTS description_ar TEXT;

ALTER TABLE visus_report_definitions ADD COLUMN IF NOT EXISTS name_ar        TEXT;
ALTER TABLE visus_report_definitions ADD COLUMN IF NOT EXISTS description_ar TEXT;

ALTER TABLE visus_executive_alerts   ADD COLUMN IF NOT EXISTS title_ar       TEXT;
ALTER TABLE visus_executive_alerts   ADD COLUMN IF NOT EXISTS description_ar TEXT;
