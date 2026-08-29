package model

import (
	"time"

	"github.com/google/uuid"
)

// ReferenceLibraryDocument is one row of the GLOBAL, read-only WatheeqTech
// reference library (WatheeqTech_Library_Design.md §3.2). It intentionally
// carries NO TenantID: the corpus is identical public Saudi law for every tenant
// and is read by all authenticated Watheeq users. The field shape is copied from
// RegulationLibraryItem with all mutable/governance columns stripped and the byte
// binding (byte_source / file_id / storage_key / library_tenant_id) added.
type ReferenceLibraryDocument struct {
	ID            uuid.UUID `json:"id"`
	TitleAR       string    `json:"title_ar"`
	TitleEN       string    `json:"title_en"`
	DescriptionAR string    `json:"description_ar"`
	DescriptionEN string    `json:"description_en"`
	Category      string    `json:"category"` // systems-regulations | judicial-journal | research
	DocType       string    `json:"doc_type"` // system | regulation | judicial-journal | research
	Jurisdiction  string    `json:"jurisdiction"`
	Authority     string    `json:"authority"`
	Source        string    `json:"source"`
	SourceURL     *string   `json:"source_url,omitempty"`
	Tags          []string  `json:"tags"`

	// Byte binding. byte_source discriminates the file-service path (file_id +
	// library_tenant_id) from the mounted-volume path (storage_key). Both are kept
	// so a deployment can flip between them without a schema change (design §2.3/§2.4).
	ByteSource      string     `json:"byte_source"`
	FileID          *uuid.UUID `json:"file_id,omitempty"`
	StorageKey      *string    `json:"storage_key,omitempty"`
	LibraryTenantID *uuid.UUID `json:"library_tenant_id,omitempty"`
	FileSizeBytes   *int64     `json:"file_size_bytes,omitempty"`
	ContentHash     *string    `json:"content_hash,omitempty"`

	Published     bool       `json:"published"`
	Version       int        `json:"version"`
	HijriDate     *string    `json:"hijri_date,omitempty"`
	GregorianDate *time.Time `json:"gregorian_date,omitempty"`
	// EffectiveDate is the document's issuance / last-amended AS-OF date, surfaced so
	// the frontend can render "as of {date}" and flag stale versions. Nil when the
	// current version cannot be safely asserted (the UI then shows "confirm current
	// version"). The companion Hijri as-of string, when known, lives in
	// metadata.effective_hijri.
	EffectiveDate *time.Time     `json:"effective_date,omitempty"`
	Metadata      map[string]any `json:"metadata"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     *time.Time     `json:"deleted_at,omitempty"`
}

// ReferenceLibraryListFilters are the browse/metadata-search filters for the
// global catalog. Search is a metadata FTS/ILIKE over title/description/authority/
// tags (contents search is a separate Second-Brain AI proxy). There is no
// tenant/status/governance filter — the table is global and read-only.
type ReferenceLibraryListFilters struct {
	Search   string
	Category string
	DocType  string
	Tag      string
	Page     int
	PerPage  int
}

// ReferenceLibraryFacet is one faceted-browse bucket (a category / doc_type / tag
// value and the count of published documents carrying it).
type ReferenceLibraryFacet struct {
	Value string `json:"key"`
	Count int    `json:"count"`
}

// ReferenceLibraryFacets is the faceted-browse summary over the whole published
// corpus, driving the frontend's category / doc_type / tag filter tree.
type ReferenceLibraryFacets struct {
	Categories []ReferenceLibraryFacet `json:"categories"`
	DocTypes   []ReferenceLibraryFacet `json:"doc_types"`
	Tags       []ReferenceLibraryFacet `json:"tags"`
}
