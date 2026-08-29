// Package pki is the per-tenant PKI control plane. It wraps the
// Vault PKI methods (Phase 3A: backend/internal/vault/pki.go) and
// caches per-tenant intermediate-CA references so the service layer
// can issue a leaf certificate without re-reading mount metadata on
// every call.
//
// The CSR-only enrollment flow keeps the private key in the
// collector; this package never sees plaintext key material.
package pki
