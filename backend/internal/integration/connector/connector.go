// Package connector defines the vendor-agnostic connector framework for the
// integration engine. A Connector is a self-describing unit: it carries a
// declarative Manifest (its config schema, capabilities and auth kind) and a
// small set of behaviors (validate, send, optionally ticket-create and test).
//
// The Manifest is the "config not code" core: a single FieldSpec list drives
// config validation, secret sanitization and (in a later phase) the admin form.
//
// This package is purely additive. It wraps — never rewrites — the existing
// slack/teams/jira/servicenow/webhook clients via thin adapters that satisfy
// these interfaces, and the Registry replaces the three dispatch type-switches
// (delivery_service.Process, integration_service.Test, config.NormalizeAndValidateConfig)
// with a single O(1) lookup.
package connector

import (
	"context"

	"github.com/clario360/platform/internal/events"
)

// Capability describes what a connector can do. A connector may notify (push
// an event as a message), open/sync a ticket, or both.
type Capability string

const (
	// CapabilityNotify means the connector delivers events as notifications
	// (slack/teams/webhook style). Such connectors implement Send.
	CapabilityNotify Capability = "notify"
	// CapabilityTicket means the connector creates/links external tickets
	// (jira/servicenow style). Such connectors implement TicketConnector.
	CapabilityTicket Capability = "ticket"
	// CapabilityBoth means the connector can both notify and ticket.
	CapabilityBoth Capability = "both"
)

// Valid reports whether the capability is one of the known values.
func (c Capability) Valid() bool {
	switch c {
	case CapabilityNotify, CapabilityTicket, CapabilityBoth:
		return true
	default:
		return false
	}
}

// CanNotify reports whether a connector with this capability is expected to
// implement Send.
func (c Capability) CanNotify() bool {
	return c == CapabilityNotify || c == CapabilityBoth
}

// CanTicket reports whether a connector with this capability is expected to
// implement TicketConnector.
func (c Capability) CanTicket() bool {
	return c == CapabilityTicket || c == CapabilityBoth
}

// AuthKind names the authentication style a connector expects in its config.
// It is descriptive metadata used by the admin UI and by operators; it does
// not by itself change validation (the FieldSpec list does that).
type AuthKind string

const (
	// AuthNone indicates the connector needs no credentials (rare; e.g. an
	// open webhook receiver).
	AuthNone AuthKind = "none"
	// AuthBearerToken indicates a single bearer/API token (slack bot token,
	// jira PAT, etc.).
	AuthBearerToken AuthKind = "bearer_token"
	// AuthBasic indicates username + password (servicenow basic auth).
	AuthBasic AuthKind = "basic"
	// AuthOAuth2 indicates an OAuth2 access/refresh token pair.
	AuthOAuth2 AuthKind = "oauth2"
	// AuthHMAC indicates a shared secret used to sign outbound requests
	// (webhook signing secret).
	AuthHMAC AuthKind = "hmac"
	// AuthAppPassword indicates an app id + password (teams bot credentials).
	AuthAppPassword AuthKind = "app_password"
)

// FieldType enumerates the value types a config field may hold. Config arrives
// as a map[string]any decoded from JSON, so int fields are accepted as JSON
// float64 and coerced (see ValidateAgainstSchema / coerceInt).
type FieldType string

const (
	// FieldTypeString is a UTF-8 string.
	FieldTypeString FieldType = "string"
	// FieldTypeInt is an integer. Accepted as Go int or as JSON float64 with
	// no fractional part, and coerced to int.
	FieldTypeInt FieldType = "int"
	// FieldTypeBool is a boolean.
	FieldTypeBool FieldType = "bool"
	// FieldTypeEnum is a string constrained to the FieldSpec.Enum set.
	FieldTypeEnum FieldType = "enum"
	// FieldTypeObject is a nested object (map[string]any) or, for convenience,
	// a map[string]string (e.g. webhook headers, jira priority mapping).
	FieldTypeObject FieldType = "object"
	// FieldTypeSecret is a string that must be masked when sanitized. Marking
	// a field FieldTypeSecret is equivalent to setting Secret=true.
	FieldTypeSecret FieldType = "secret"
)

// FieldSpec declares one configurable field of a connector. The full list of
// FieldSpecs is the connector's config schema and is the single source of
// truth for validation, sanitization, defaults and (later) form rendering.
type FieldSpec struct {
	// Name is the config map key (snake_case, matching the existing *Config
	// JSON tags, e.g. "bot_token", "channel_id", "instance_url").
	Name string `json:"name"`
	// Type is the value type. FieldTypeSecret also implies Secret=true.
	Type FieldType `json:"type"`
	// Required marks the field as mandatory. A missing or empty required field
	// is a validation error.
	Required bool `json:"required"`
	// Secret marks the field for masking by SanitizeBySchema. FieldTypeSecret
	// fields are treated as secret regardless of this flag.
	Secret bool `json:"secret"`
	// Enum lists the permitted values when Type is FieldTypeEnum. Membership
	// is checked case-sensitively.
	Enum []string `json:"enum,omitempty"`
	// Default is applied by ApplyDefaults when the field is absent. Its type
	// should match Type (string for string/enum/secret, int/float64 for int,
	// bool for bool, map for object).
	Default any `json:"default,omitempty"`
	// Description is human-readable help text for operators and the admin form.
	Description string `json:"description,omitempty"`
}

// IsSecret reports whether the field must be masked when sanitized.
func (f FieldSpec) IsSecret() bool {
	return f.Secret || f.Type == FieldTypeSecret
}

// Manifest is the declarative descriptor of a connector. It is returned by
// Connector.Manifest and is what the Registry exposes via List. It is the
// "config not code" core that drives validation, sanitization and the UI.
type Manifest struct {
	// Type is the string key identifying the connector. It must equal the
	// model.IntegrationType value (e.g. "slack", "jira", "webhook") so the
	// registry can replace the existing type-switch dispatch.
	Type string `json:"type"`
	// DisplayName is the human-friendly name shown in the admin UI.
	DisplayName string `json:"display_name"`
	// Capabilities declares whether the connector can notify, ticket or both.
	Capabilities Capability `json:"capabilities"`
	// AuthKind describes the credential style the config carries.
	AuthKind AuthKind `json:"auth_kind"`
	// ConfigSchema is the ordered list of configurable fields.
	ConfigSchema []FieldSpec `json:"config_schema"`
}

// Validate checks that the manifest is internally consistent. It is called by
// Registry.Register to reject malformed connectors at registration time.
func (m Manifest) Validate() error {
	return validateManifest(m)
}

// Result is the outcome of a connector operation (Send, CreateFromEntity,
// Test). It mirrors the (code, body, error) tuple the existing clients return,
// and additionally carries an optional ExternalRef for ticket links.
type Result struct {
	// ResponseCode is the HTTP status (or upstream API status) of the call.
	// 0 means the call did not reach a remote server (local error).
	ResponseCode int `json:"response_code"`
	// ResponseBody is the (possibly truncated) upstream response body.
	ResponseBody string `json:"response_body"`
	// ExternalRef is set by ticket connectors to the created link; nil for
	// pure notify connectors.
	ExternalRef *ExternalRef `json:"external_ref,omitempty"`
}

// ExternalRef is a connector-agnostic reference to an externally created
// artifact (a Jira issue, a ServiceNow incident). It is a projection of the
// fields a caller needs without coupling this package to the full
// model.ExternalTicketLink record.
type ExternalRef struct {
	// System is the external system name (e.g. "jira", "servicenow").
	System string `json:"system"`
	// ExternalID is the system's internal identifier (e.g. Jira issue id).
	ExternalID string `json:"external_id"`
	// ExternalKey is the human-facing key (e.g. "SEC-1234", "INC0010023").
	ExternalKey string `json:"external_key"`
	// URL is a deep link to the created artifact, if known.
	URL string `json:"url"`
}

// Connector is the core capability every connector implements. It is
// self-describing (Manifest), self-validating (ValidateConfig) and able to
// deliver an event (Send).
//
// cfg is the decrypted config as a map[string]any (the shape produced by
// encryption.ConfigEncryptor.Decrypt). Implementations decode it into their
// concrete *Config struct (via service.DecodeInto) before calling the wrapped
// client, keeping the existing client code unchanged.
type Connector interface {
	// Manifest returns the connector's declarative descriptor.
	Manifest() Manifest
	// ValidateConfig checks cfg against the connector's schema and any
	// connector-specific rules. The default implementation delegates to
	// ValidateAgainstSchema(Manifest().ConfigSchema, cfg).
	ValidateConfig(cfg map[string]any) error
	// Send delivers event using cfg. Notify-capable connectors do real work
	// here; ticket-only connectors should return an error directing callers to
	// CreateFromEntity.
	Send(ctx context.Context, cfg map[string]any, event *events.Event) (Result, error)
}

// TicketConnector is the optional capability for connectors that create or
// link external tickets (jira, servicenow). It mirrors the existing
// CreateFromEntity signature so the wrapped service code is unchanged.
type TicketConnector interface {
	Connector
	// CreateFromEntity opens (or reuses) an external ticket for the given
	// Clario entity. bearerToken is the system token used to read the entity
	// from the originating service.
	CreateFromEntity(ctx context.Context, cfg map[string]any, bearerToken, entityType, entityID string) (Result, error)
}

// Tester is the optional capability for connectors that support an explicit
// connectivity check (the existing SendTest / Test paths).
type Tester interface {
	Connector
	// Test performs a non-destructive connectivity/auth check using cfg.
	Test(ctx context.Context, cfg map[string]any) (Result, error)
}

// Compile-time assertions that the optional interfaces embed Connector, so any
// type satisfying them is usable wherever a Connector is required.
var (
	_ Connector = TicketConnector(nil)
	_ Connector = Tester(nil)
)
