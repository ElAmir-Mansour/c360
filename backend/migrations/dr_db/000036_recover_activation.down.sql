-- Reverse 000036_recover_activation: drop the Recover sub-solution activation
-- table (and with it its RLS policies and indexes). Licensing entitlement is
-- unaffected — it never lived here.
DROP TABLE IF EXISTS recover_sub_solution_activation;
