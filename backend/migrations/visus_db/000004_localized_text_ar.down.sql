-- Reverse of 000004_localized_text_ar.up.sql. Only the additive AR sibling
-- columns are dropped; the original English columns are untouched.

ALTER TABLE visus_executive_alerts   DROP COLUMN IF EXISTS description_ar;
ALTER TABLE visus_executive_alerts   DROP COLUMN IF EXISTS title_ar;

ALTER TABLE visus_report_definitions DROP COLUMN IF EXISTS description_ar;
ALTER TABLE visus_report_definitions DROP COLUMN IF EXISTS name_ar;

ALTER TABLE visus_kpi_definitions    DROP COLUMN IF EXISTS description_ar;
ALTER TABLE visus_kpi_definitions    DROP COLUMN IF EXISTS name_ar;

ALTER TABLE visus_widgets            DROP COLUMN IF EXISTS title_ar;

ALTER TABLE visus_dashboards         DROP COLUMN IF EXISTS description_ar;
ALTER TABLE visus_dashboards         DROP COLUMN IF EXISTS name_ar;
