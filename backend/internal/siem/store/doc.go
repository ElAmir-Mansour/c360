// Package store is the SIEM-02 storage facade. It composes three lower-level
// subpackages (opensearch, minio, crypto) into a single Store object that the
// rest of siem-service consumes.
//
// Boundary contract:
//
//   - All OpenSearch traffic must flow through internal/siem/store/opensearch.
//   - All MinIO/S3 traffic must flow through internal/siem/store/minio.
//   - All Vault traffic must flow through internal/vault, adapted in
//     internal/siem/store/crypto/transit.go.
//
// The boundary is enforced by contract_test.go (TestImportBoundary) which
// walks the AST of every Go file in the monorepo and rejects any import of
// the underlying SDKs from outside the allowlist.
//
// All Prometheus metrics are registered against a per-instance Registerer
// provided by the caller; we never touch prometheus.DefaultRegisterer.
package store
