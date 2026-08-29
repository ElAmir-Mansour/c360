// Package storetypes holds the leaf types shared by every subpackage of
// internal/siem/store. It exists exclusively to break the otherwise
// inevitable import cycle between the root store package (which composes
// the subpackages) and the subpackages (which need the canonical
// Document/DEKRef/DataClass types).
//
// This package must NOT import anything except the standard library and
// google/uuid. Doing so would re-introduce a cycle.
package storetypes

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Document is the canonical in-memory representation of a SIEM event
// before indexing. Encryption transforms values in-place.
type Document = map[string]any

// DataClass tags a document for retention + crypto policy.
type DataClass string

// Known data classes. Retention defaults are calculated in
// internal/siem/store/minio/retention.go.
const (
	DataClassSwift      DataClass = "swift"
	DataClassRTGS       DataClass = "rtgs"
	DataClassPII        DataClass = "pii"
	DataClassCardholder DataClass = "cardholder"
	DataClassInternal   DataClass = "internal"
	DataClassPublic     DataClass = "public"
)

// IndexName builds the canonical name siem-{tenant}-{yyyy.MM.dd}.
func IndexName(tenantID uuid.UUID, t time.Time) string {
	return fmt.Sprintf("siem-%s-%s", tenantID, t.UTC().Format("2006.01.02"))
}

// WriteAlias is the alias the bulk indexer always targets.
func WriteAlias(tenantID uuid.UUID) string {
	return fmt.Sprintf("siem-%s-write", tenantID)
}

// IndexPattern is the wildcard glob used in template index_patterns.
func IndexPattern(tenantID uuid.UUID) string {
	return fmt.Sprintf("siem-%s-*", tenantID)
}

// TemplateName returns the OpenSearch template name for a tenant.
func TemplateName(tenantID uuid.UUID) string {
	return fmt.Sprintf("siem-%s-template", tenantID)
}

// TransitKeyName returns the Vault transit key name for a tenant.
// Format: "siem-tenant-{tenantID}".
func TransitKeyName(tenantID uuid.UUID) string {
	return fmt.Sprintf("siem-tenant-%s", tenantID)
}

// DEKRef is the opaque pointer into siem.index_metadata.dek_envelope.
// Format is "siem-tenant-{tenant}/{indexName}#{kekVersion}".
type DEKRef string

// NewDEKRef builds the canonical DEKRef value.
func NewDEKRef(tenantID uuid.UUID, indexName string, kekVersion int) DEKRef {
	return DEKRef(fmt.Sprintf("%s/%s#%d", TransitKeyName(tenantID), indexName, kekVersion))
}
