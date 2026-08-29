-- GAP 3: make the signature provider-event dedup a REAL uniqueness guarantee.
--
-- Migration 000006 created a NON-unique partial index
-- idx_signature_events_provider_event on (tenant_id, provider, provider_event_id)
-- WHERE provider_event_id IS NOT NULL. SignatureService.ProviderEvent uses a
-- SELECT (ProviderEventExists) before INSERT to skip duplicate provider callbacks,
-- but that check-then-insert is a TOCTOU race: two identical callbacks delivered
-- concurrently (providers retry aggressively) can BOTH pass the SELECT and BOTH
-- INSERT, double-recording the event and double-driving the FSM.
--
-- This migration closes the hole by promoting the dedup index to a UNIQUE partial
-- index, so a concurrent duplicate fails with a 23505 unique_violation that the
-- service treats as an idempotent no-op (the SELECT remains as a cheap fast-path).

-- (a) De-duplicate any pre-existing rows so the UNIQUE index can be built. Keep the
--     EARLIEST row per (tenant_id, provider, provider_event_id) — smallest created_at,
--     tie-broken by id for determinism — and delete the rest. Only rows with a
--     non-null provider_event_id are in scope (matches the partial predicate).
DELETE FROM signature_events se
USING (
    SELECT id
    FROM (
        SELECT id,
               row_number() OVER (
                   PARTITION BY tenant_id, provider, provider_event_id
                   ORDER BY created_at ASC, id ASC
               ) AS rn
        FROM signature_events
        WHERE provider_event_id IS NOT NULL
    ) ranked
    WHERE ranked.rn > 1
) dups
WHERE se.id = dups.id;

-- (b) Drop the non-unique index it replaces.
DROP INDEX IF EXISTS idx_signature_events_provider_event;

-- (c) Create the UNIQUE partial index. A concurrent duplicate provider callback now
--     fails with unique_violation (23505) instead of double-inserting.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signature_events_provider_event
    ON signature_events (tenant_id, provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;
