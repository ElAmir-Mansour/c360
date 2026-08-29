-- Reverse of 000039_recover_analytics_snapshot: drop the readiness-trend
-- snapshot table (and its index/policies, which drop with the table). The live
-- analytics computation owns no schema of its own, so nothing else to undo.
DROP TABLE IF EXISTS recover_readiness_snapshot;
