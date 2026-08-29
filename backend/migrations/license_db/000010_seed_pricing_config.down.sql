-- Reversible: remove only the seeded version-1 row. Operator-published versions
-- (>= 2) are left intact so a down/up cycle never silently discards governed
-- pricing history. Idempotent.
DELETE FROM pricing_config WHERE version = 1;
