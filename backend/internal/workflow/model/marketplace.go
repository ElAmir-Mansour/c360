package model

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// MarketplaceItem is one VERSION of a governed marketplace entry: a reusable
// workflow template (kind=template) or an integration connector (kind=connector)
// that a tenant can browse and install. A logical item is the set of versions
// sharing (TenantScope, Kind, Key); each row is one immutable-once-published
// semver version of it.
//
// Phase 5 (moat): the marketplace layers publish -> review (four-eyes) -> install
// governance and provenance ON TOP of the existing data-driven template catalog
// (WorkflowTemplate / workflow_templates). It is additive — the template catalog
// and its seeder keep working unchanged; marketplace items reference the same
// definition-JSON payload shape a template carries.
type MarketplaceItem struct {
	ID string `json:"id" db:"id"`
	// TenantScope is empty for GLOBAL, platform-published items (stored with
	// tenant_id IS NULL, visible to every tenant) and a tenant UUID for a
	// tenant-published private item.
	TenantScope string `json:"tenant_id,omitempty" db:"tenant_id"`
	// Kind selects the payload semantics: MarketplaceKindTemplate (payload is a
	// WorkflowDefinition blueprint) or MarketplaceKindConnector (payload is a
	// connector manifest).
	Kind string `json:"kind" db:"kind"`
	// Key is the stable identity of the logical item across versions.
	Key string `json:"key" db:"key"`
	// TitleI18n / DescriptionI18n carry the bilingual (ar/en) display strings.
	TitleI18n       map[string]string `json:"title_i18n,omitempty" db:"title_i18n"`
	DescriptionI18n map[string]string `json:"description_i18n,omitempty" db:"description_i18n"`
	// Title / Description are localized convenience fields (English preferred),
	// populated from the i18n maps on read.
	Title       string   `json:"title" db:"-"`
	Description string   `json:"description" db:"-"`
	Category    string   `json:"category" db:"category"`
	Tags        []string `json:"tags,omitempty" db:"tags"`
	// Version is the raw semver string (e.g. "1.2.0"); Major/Minor/Patch are its
	// decomposition, used for version ordering.
	Version      string `json:"version" db:"version"`
	VersionMajor int    `json:"-" db:"version_major"`
	VersionMinor int    `json:"-" db:"version_minor"`
	VersionPatch int    `json:"-" db:"version_patch"`
	// Maturity is the lifecycle label (draft/beta/ga/deprecated), independent of
	// the publish/review Status.
	Maturity  string `json:"maturity" db:"maturity"`
	Publisher string `json:"publisher" db:"publisher"`
	// Payload is the WorkflowDefinition JSON (template) or connector manifest JSON
	// (connector) the installer acts on.
	Payload json.RawMessage `json:"payload,omitempty" db:"payload"`
	// Provenance.
	Source      string     `json:"source" db:"source"`
	Checksum    string     `json:"checksum" db:"checksum"`
	PublishedBy string     `json:"published_by" db:"published_by"`
	PublishedAt *time.Time `json:"published_at,omitempty" db:"published_at"`
	// Status is the publish/review lifecycle of this version:
	// MarketplaceStatusDraft (published-but-unreviewed) ->
	// MarketplaceStatusPublished (four-eyes reviewed, installable).
	Status string `json:"status" db:"status"`
	// Four-eyes review stamps (nil until reviewed).
	ReviewedBy   *string    `json:"reviewed_by,omitempty" db:"reviewed_by"`
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty" db:"reviewed_at"`
	ReviewReason *string    `json:"review_reason,omitempty" db:"review_reason"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at" db:"updated_at"`
}

// MarketplaceInstall is one row of the install provenance ledger: it records
// which marketplace item VERSION a tenant installed and (for a template) the
// workflow definition it instantiated. Idempotent install is keyed on
// (TenantID, MarketplaceItemID).
type MarketplaceInstall struct {
	ID                string    `json:"id" db:"id"`
	TenantID          string    `json:"tenant_id" db:"tenant_id"`
	MarketplaceItemID string    `json:"marketplace_item_id" db:"marketplace_item_id"`
	Kind              string    `json:"kind" db:"kind"`
	ItemKey           string    `json:"item_key" db:"item_key"`
	ItemVersion       string    `json:"item_version" db:"item_version"`
	DefinitionID      *string   `json:"definition_id,omitempty" db:"definition_id"`
	ConnectorKey      *string   `json:"connector_key,omitempty" db:"connector_key"`
	InstalledBy       string    `json:"installed_by" db:"installed_by"`
	InstalledAt       time.Time `json:"installed_at" db:"installed_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
}

// Marketplace item kinds.
const (
	MarketplaceKindTemplate  = "template"
	MarketplaceKindConnector = "connector"
)

// ValidMarketplaceKinds is the set of allowed item kinds.
var ValidMarketplaceKinds = map[string]bool{
	MarketplaceKindTemplate:  true,
	MarketplaceKindConnector: true,
}

// Marketplace maturity labels.
const (
	MarketplaceMaturityDraft      = "draft"
	MarketplaceMaturityBeta       = "beta"
	MarketplaceMaturityGA         = "ga"
	MarketplaceMaturityDeprecated = "deprecated"
)

// ValidMarketplaceMaturities is the set of allowed maturity labels.
var ValidMarketplaceMaturities = map[string]bool{
	MarketplaceMaturityDraft:      true,
	MarketplaceMaturityBeta:       true,
	MarketplaceMaturityGA:         true,
	MarketplaceMaturityDeprecated: true,
}

// Marketplace publish/review status.
const (
	// MarketplaceStatusDraft is a version that has been published to the catalog
	// but NOT yet cleared by a distinct reviewer (four-eyes). It is NOT installable.
	MarketplaceStatusDraft = "draft"
	// MarketplaceStatusPublished is a version the four-eyes review has cleared; it
	// is installable by tenants.
	MarketplaceStatusPublished = "published"
	// MarketplaceStatusDeprecated is a retired version.
	MarketplaceStatusDeprecated = "deprecated"
)

// ValidMarketplaceStatuses is the set of allowed status values.
var ValidMarketplaceStatuses = map[string]bool{
	MarketplaceStatusDraft:      true,
	MarketplaceStatusPublished:  true,
	MarketplaceStatusDeprecated: true,
}

// Semver is a minimal, dependency-free semantic version (major.minor.patch). The
// marketplace stores versions decomposed so ordering is a plain integer compare
// (no lexical "1.10.0" < "1.9.0" trap). Pre-release / build metadata is not
// modeled; the marketplace uses the numeric triple only.
type Semver struct {
	Major int
	Minor int
	Patch int
}

// ParseSemver parses "MAJOR.MINOR.PATCH" (a leading "v" is tolerated and missing
// minor/patch default to 0, so "1", "1.2" and "1.2.3" all parse). It rejects a
// negative or non-numeric component. This is the single canonical parse the
// repository and service use so version ordering is consistent everywhere.
func ParseSemver(s string) (Semver, error) {
	raw := strings.TrimSpace(s)
	raw = strings.TrimPrefix(raw, "v")
	if raw == "" {
		return Semver{}, fmt.Errorf("empty semver")
	}
	parts := strings.Split(raw, ".")
	if len(parts) > 3 {
		return Semver{}, fmt.Errorf("invalid semver %q: too many components", s)
	}
	out := Semver{}
	dst := []*int{&out.Major, &out.Minor, &out.Patch}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return Semver{}, fmt.Errorf("invalid semver %q: component %q is not a non-negative integer", s, p)
		}
		*dst[i] = n
	}
	return out, nil
}

// String renders the canonical "MAJOR.MINOR.PATCH" form.
func (v Semver) String() string {
	return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
}

// Compare returns -1 if v < o, 0 if equal, +1 if v > o, comparing major then
// minor then patch. It is the total order marketplace version selection uses.
func (v Semver) Compare(o Semver) int {
	switch {
	case v.Major != o.Major:
		return cmpInt(v.Major, o.Major)
	case v.Minor != o.Minor:
		return cmpInt(v.Minor, o.Minor)
	default:
		return cmpInt(v.Patch, o.Patch)
	}
}

func cmpInt(a, b int) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}
