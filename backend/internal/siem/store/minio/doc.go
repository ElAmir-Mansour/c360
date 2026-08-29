// Package minio is the SIEM-02 wrapper around github.com/minio/minio-go/v7.
//
// This is the ONLY package under internal/siem/store/... that imports
// minio-go/v7 — the contract test in the parent store package enforces that.
//
// The wrapper centralises three concerns:
//
//  1. Canonical object-key generation (cold/{tenant}/{yyyy}/{mm}/{idx}.ndjson.zst).
//  2. Streaming zstd-compressed seal of an index NDJSON dump.
//  3. WORM-mode (COMPLIANCE) retention calculation per data class.
//
// All public methods are concurrent-safe.
package minio
