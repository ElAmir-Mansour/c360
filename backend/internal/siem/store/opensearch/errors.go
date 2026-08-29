package opensearch

import "errors"

// Sentinel errors for the OpenSearch subpackage. All errors returned from
// the Client implementation wrap one of these via fmt.Errorf("...: %w",
// ErrXxx) so callers can use errors.Is to discriminate.
var (
	// ErrIndexNotFound indicates the requested index does not exist.
	ErrIndexNotFound = errors.New("opensearch: index not found")

	// ErrMappingConflict indicates a bulk insert was rejected because of a
	// strict-mapping violation or type mismatch.
	ErrMappingConflict = errors.New("opensearch: mapping conflict")

	// ErrClusterRed indicates the cluster health probe returned status=red.
	ErrClusterRed = errors.New("opensearch: cluster status red")

	// ErrClusterUnreachable indicates the HTTP request failed at the
	// transport layer (DNS / TCP / TLS).
	ErrClusterUnreachable = errors.New("opensearch: cluster unreachable")

	// ErrTenantMismatch indicates a document's tenant_id field disagrees
	// with the tenant argument of BulkIndex.
	ErrTenantMismatch = errors.New("opensearch: tenant_id mismatch")

	// ErrSearchTargetsIndex indicates the caller-supplied DSL contains an
	// explicit _index filter or a `?_index=` parameter.
	ErrSearchTargetsIndex = errors.New("opensearch: DSL must not target _index directly")

	// ErrBadResponse indicates the cluster returned a non-2xx that did not
	// match any of the more specific sentinels.
	ErrBadResponse = errors.New("opensearch: bad response")
)
