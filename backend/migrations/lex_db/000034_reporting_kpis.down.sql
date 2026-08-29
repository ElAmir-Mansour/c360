-- Phase 4 — Reporting & KPIs (CAP-133..151) — DOWN.
-- The legal_documents FTS DROP block was removed: this migration no longer owns
-- those columns (see 000034_reporting_kpis.up.sql note; canonical FTS is in
-- 000032). Dropping search_vector/extracted_text here would corrupt 000032.

DROP TABLE IF EXISTS lex_duration_facts;
