// Package sources implements the SIEM source registry and the collector
// control plane introduced in SIEM-03.
//
// Mission summary (see docs/prompts/PROMPT3.MD for the full spec):
//
//   - Persistent registry of every log source feeding the SIEM (transport,
//     parser, mTLS identity, EPS baseline, lifecycle metadata).
//   - Onboarding flow that hands out a single-use enrollment JWT (signed by
//     Vault transit, never by an in-process key) that the collector exchanges
//     for a leaf certificate via a CSR-only flow.
//   - CRUD handlers under /api/v1/siem/sources with strict RBAC, optimistic
//     concurrency (If-Match), and idempotent POSTs.
//   - Cert rotation that reuses the same atomic-claim primitive.
//   - mTLS-only heartbeat listener on :8095 feeding EPS samples.
//   - Silent-source detector with EWMA baselines, drift detection, gap
//     detection, recovery, and cert-expiry warnings, leader-elected so that
//     in a multi-replica deployment only one instance emits events.
//
// The package is the sole writer of the four siem_sources tables; a
// contract_test.go in this package fails the build if any other Go file in
// the monorepo writes to them.
package sources
