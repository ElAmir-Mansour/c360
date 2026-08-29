package model

import (
	"time"

	"github.com/google/uuid"
)

// IntegrationKind enumerates the external systems the lex suite federates with
// (CAP-174..178). These are registry entries — the actual transport is performed
// by adapter stubs behind a port interface in the service layer, so a real
// connector can be slotted in without changing call sites.
type IntegrationKind string

const (
	// IntegrationKindNajiz is the Saudi MoJ Najiz e-litigation portal (CAP-175).
	IntegrationKindNajiz IntegrationKind = "najiz"
	// IntegrationKindHR is the HR / identity system feed (CAP-176).
	IntegrationKindHR IntegrationKind = "hr"
	// IntegrationKindInternal is a generic internal-system endpoint (CAP-177).
	IntegrationKindInternal IntegrationKind = "internal"
	// IntegrationKindArchiving is the records / e-archiving system (CAP-178).
	IntegrationKindArchiving IntegrationKind = "archiving"
	// IntegrationKindEmail is the outbound email integration (CAP-174). Inbound
	// email already arrives via the Phase-1 intake webhook; outbound dispatch
	// reuses the obligation-reminder dispatcher seam.
	IntegrationKindEmail IntegrationKind = "email"
	// IntegrationKindNafathVerify is the Nafath identity-confirmation integration
	// (e-sign basis). Nafath confirms identity; it is NOT a CA, so a legally
	// binding signature pairs it with a TSP (emdha). Gov-gated.
	IntegrationKindNafathVerify IntegrationKind = "nafath_verify"
	// IntegrationKindSSO is the generic OIDC/SAML single-sign-on / SCIM
	// federation integration (Entra/Okta/Keycloak).
	IntegrationKindSSO IntegrationKind = "sso"
	// IntegrationKindEsign is the e-signature integration
	// (DocuSign/Adobe/native/emdha).
	IntegrationKindEsign IntegrationKind = "esign"
	// IntegrationKindCustom is the no-code generic REST connector (extensibility #18):
	// a CustomConnector executes a declarative REST spec carried in the endpoint's
	// config, so an operator builds a brand-new connector entirely from the console
	// without any per-integration connector code. SSRF-guarded; self-serve.
	IntegrationKindCustom IntegrationKind = "custom"
	// IntegrationKindYardi is the Yardi Voyager / Interface property-management &
	// real-estate ERP connector (Othaim PRD 14.2). Self-serve REST: it pulls Yardi
	// lease / property / unit records into lex as reference data and offers a small
	// write surface (push a note / status back). Ships fully configurable +
	// sandbox-testable; going live only needs the tenant's real Yardi base URL +
	// credentials.
	IntegrationKindYardi IntegrationKind = "yardi"
)

// IntegrationStatus is the lifecycle state of a registered endpoint. New
// endpoints default to "planned" (CAP-174) until an operator configures and
// activates them.
type IntegrationStatus string

const (
	IntegrationStatusPlanned  IntegrationStatus = "planned"
	IntegrationStatusActive   IntegrationStatus = "active"
	IntegrationStatusDisabled IntegrationStatus = "disabled"
	IntegrationStatusError    IntegrationStatus = "error"
)

// IntegrationEndpoint is a tenant-scoped registry row describing one external
// integration. The Config map holds connection settings (URLs, credentials,
// tenant-side identifiers); it is encrypted at rest with the lex FieldCrypto
// (CAP-179) — the repository encrypts on write and decrypts on read, so callers
// see plaintext Config. ConfigCiphertext holds the encrypted envelope as stored.
type IntegrationEndpoint struct {
	ID uuid.UUID `json:"id"`
	// TenantID is the owning tenant (tenant_id FIRST).
	TenantID uuid.UUID       `json:"tenant_id"`
	Kind     IntegrationKind `json:"kind"`
	// Code is a stable per-tenant identifier for this endpoint (unique per tenant).
	Code string `json:"code"`
	// Name is an operator-facing display name.
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Status      IntegrationStatus `json:"status"`
	// Config is the decrypted connection configuration. It is NEVER persisted in
	// plaintext: the repository serialises it, encrypts via FieldCrypto, and
	// stores it in the config_encrypted column.
	Config map[string]any `json:"config"`
	// Metadata holds non-sensitive operational annotations (last sync, version).
	Metadata map[string]any `json:"metadata"`
	// Encrypted reports whether the persisted config envelope is encrypted (true
	// when a FieldCrypto custody is wired; false for legacy/plaintext rows).
	Encrypted bool `json:"encrypted"`
	// LastCheckedAt records the last health/connectivity probe.
	LastCheckedAt *time.Time `json:"last_checked_at,omitempty"`
	LastError     *string    `json:"last_error,omitempty"`

	CreatedBy uuid.UUID  `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
}

// IntegrationHealth is a non-persisted health snapshot for a registered endpoint,
// returned by the registry service's readiness probe (CAP-184..186). Passive
// probes are intentionally lightweight; connector-specific adapters decide
// whether that means a live network check or configuration/readiness validation.
type IntegrationHealth struct {
	EndpointID  uuid.UUID         `json:"endpoint_id"`
	Kind        IntegrationKind   `json:"kind"`
	Code        string            `json:"code"`
	Status      IntegrationStatus `json:"status"`
	Reachable   bool              `json:"reachable"`
	Detail      string            `json:"detail"`
	CheckedUnix int64             `json:"checked_unix"`
}
