// Package vault is the platform's single entry point for HashiCorp Vault
// Transit operations.
//
// SIEM-02 introduces tenant-scoped envelope encryption for the SIEM index
// store: each tenant has a Key Encryption Key (KEK) in Vault Transit and
// every SIEM index gets a Data Encryption Key (DEK) wrapped with that KEK.
// This package is the only place in the codebase that imports
// github.com/hashicorp/vault/api; every other package that needs a DEK or
// wants to decrypt one MUST go through the Client interface defined here.
//
// The contract (see Client in client.go) intentionally exposes only four
// domain operations:
//
//   - EnsureTransitKey  — idempotently provision a KEK by name.
//   - GenerateDataKey   — produce a fresh DEK (plaintext + wrapped envelope).
//   - Decrypt           — unwrap a DEK envelope back to its plaintext.
//   - Health            — surface Vault seal/standby state to the platform
//     health checker.
//
// Callers must:
//
//   - Always pass an explicit context.Context (no context.Background inside
//     library code).
//   - Zero the plaintext bytes returned in DataKey as soon as the per-field
//     AES-GCM operation completes. The Client does not retain a copy.
//   - Treat ErrVaultSealed and ErrStandby as transient and retryable at the
//     caller layer; this package retries only on HTTP 503 and network
//     errors, never on 4xx responses.
//
// Logs emitted from this package MUST NOT contain plaintext DEK bytes. The
// client_test.go log-capture suite enforces this invariant.
package vault
