// Package consumer is the siem-service Kafka consumer scaffolding.
//
// SIEM-01 subscribes to no topics, but the lifecycle hooks (Start,
// Stop, Subscribe) must exist so SIEM-04 can attach handlers without
// rewriting the boot sequence. The package exposes:
//
//   - Consumer    — minimal consumer wrapper that delegates to
//     internal/events.Consumer when a real broker is
//     available, or to an in-memory queue for tests.
//   - Handler     — function signature every topic handler will
//     implement. Signature mirrors events.MessageHandler.
//
// Tests rely entirely on the in-memory path; they never bind to a
// Kafka broker.
package consumer
