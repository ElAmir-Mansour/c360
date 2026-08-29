// Package producer is the siem-service Kafka emission layer.
//
// SIEM-01 does not produce any business events yet, but the scaffolding
// must exist so SIEM-04 can plug topics into a battle-tested CloudEvents
// envelope. The package exposes:
//
//   - Producer        — concrete emitter that wraps a sarama SyncProducer
//     via internal/events.Producer.
//   - FakeProducer    — in-memory test double that records every
//     publish call without touching the network.
//
// Every emitted message goes through the platform's CloudEvents factory
// (internal/events.NewEvent) so type strings receive the
// "com.clario360." prefix and sources receive the "clario360/" prefix.
// Messages without a TenantID are rejected at the producer boundary —
// the gateway already enforces tenant context, but we double-check here
// so a future bug in the calling code cannot leak cross-tenant data.
package producer
