# Transactional Outbox Write-Path Standard

The outbox package is the standard write path for service state changes that
must emit domain events. A service writes business data and the corresponding
`event_outbox` row in the same database transaction, then a relay publishes the
committed row to Kafka.

## Required Pattern

New write paths that emit an event must:

1. Start one database transaction for the business write.
2. Build a CloudEvents envelope with `events.NewEvent`.
3. Call `outbox.Write(ctx, tx, topic, event)` or a service-local stager that
   delegates to it.
4. Commit only after both the business write and outbox insert succeed.
5. Run an `outbox.Relay` for that service database so pending rows are claimed,
   published, retried, and parked as `failed` after exhausted attempts.

`outbox.Staged` exists for call sites that only have a publisher interface and
cannot yet hold the caller's transaction. New service write paths should prefer
`Write` or a typed stager that receives the open transaction.

## Current Phase 1 Anchors

- ClarioDR stages `datastream.dr.events` and `datastream.dr.alerts` through
  `backend/internal/dr/service.OutboxStager`, `backend/internal/dr/failover`,
  and `backend/internal/dr/rpo`.
- Licensing stages `platform.license.events` through
  `backend/internal/license/service.stage`.
- The API contract gate is `scripts/check-api-contracts.sh`.

Delivery is at-least-once after commit. Consumers must deduplicate with the
stable CloudEvents `id`, using the existing `events.IdempotencyGuard` where a
consumer has externally visible effects.
