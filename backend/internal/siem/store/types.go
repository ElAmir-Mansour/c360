package store

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// Document is re-exported from storetypes so callers can keep importing the
// root store package as the spec advertises. The actual type lives in
// internal/siem/store/storetypes to break the import cycle that would
// otherwise arise between this package and its subpackages.
type Document = storetypes.Document

// DataClass is re-exported from storetypes.
type DataClass = storetypes.DataClass

// Re-exported data class constants.
const (
	DataClassSwift      = storetypes.DataClassSwift
	DataClassRTGS       = storetypes.DataClassRTGS
	DataClassPII        = storetypes.DataClassPII
	DataClassCardholder = storetypes.DataClassCardholder
	DataClassInternal   = storetypes.DataClassInternal
	DataClassPublic     = storetypes.DataClassPublic
)

// IndexName builds the canonical name siem-{tenant}-{yyyy.MM.dd}.
func IndexName(tenantID uuid.UUID, t time.Time) string {
	return storetypes.IndexName(tenantID, t)
}

// WriteAlias is the alias the bulk indexer always targets.
func WriteAlias(tenantID uuid.UUID) string { return storetypes.WriteAlias(tenantID) }

// IndexPattern is the wildcard glob used in template index_patterns.
func IndexPattern(tenantID uuid.UUID) string { return storetypes.IndexPattern(tenantID) }

// TemplateName returns the OpenSearch template name for a tenant.
func TemplateName(tenantID uuid.UUID) string { return storetypes.TemplateName(tenantID) }

// TransitKeyName returns the Vault transit key name for a tenant.
func TransitKeyName(tenantID uuid.UUID) string { return storetypes.TransitKeyName(tenantID) }

// DEKRef is re-exported from storetypes.
type DEKRef = storetypes.DEKRef

// NewDEKRef builds the canonical DEKRef value.
func NewDEKRef(tenantID uuid.UUID, indexName string, kekVersion int) DEKRef {
	return storetypes.NewDEKRef(tenantID, indexName, kekVersion)
}
