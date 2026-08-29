// Package crypto implements per-field AES-GCM envelope encryption for SIEM
// documents. The DEK lifecycle (generation, persistence, in-process cache,
// zeroization on eviction) and the PII path registry both live here.
//
// External dependencies:
//
//   - github.com/clario360/platform/internal/vault.Client (for Transit
//     datakey/decrypt operations).
//   - github.com/jackc/pgx/v5/pgxpool (for DEK envelope persistence in
//     siem.index_metadata).
//
// No direct use of github.com/hashicorp/vault/api is permitted in this
// package or anywhere else in internal/siem/store/...; that rule is
// enforced by the contract test in the parent store package.
package crypto
