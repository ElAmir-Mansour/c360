package dto

import (
	"strings"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// Attachment policy DTOs (CAP-165..170)
// =============================================================================

// CreateAttachmentPolicyRequest creates a per-request-type / service-code
// attachment-requirement policy.
type CreateAttachmentPolicyRequest struct {
	RequestType         string                  `json:"request_type"`
	ServiceCode         string                  `json:"service_code"`
	Name                forms.LocalizedText     `json:"name"`
	Description         forms.LocalizedText     `json:"description"`
	MinAttachmentCount  int                     `json:"min_attachment_count"`
	MaxAttachmentCount  int                     `json:"max_attachment_count"`
	Slots               []AttachmentSlotRequest `json:"slots"`
	AllowedContentTypes []string                `json:"allowed_content_types"`
	MaxFileSizeBytes    int64                   `json:"max_file_size_bytes"`
	Active              *bool                   `json:"active,omitempty"`
	Metadata            map[string]any          `json:"metadata,omitempty"`
}

// UpdateAttachmentPolicyRequest patches a policy. Nil fields are left unchanged.
type UpdateAttachmentPolicyRequest struct {
	RequestType         *string                  `json:"request_type,omitempty"`
	ServiceCode         *string                  `json:"service_code,omitempty"`
	Name                *forms.LocalizedText     `json:"name,omitempty"`
	Description         *forms.LocalizedText     `json:"description,omitempty"`
	MinAttachmentCount  *int                     `json:"min_attachment_count,omitempty"`
	MaxAttachmentCount  *int                     `json:"max_attachment_count,omitempty"`
	Slots               *[]AttachmentSlotRequest `json:"slots,omitempty"`
	AllowedContentTypes *[]string                `json:"allowed_content_types,omitempty"`
	MaxFileSizeBytes    *int64                   `json:"max_file_size_bytes,omitempty"`
	Active              *bool                    `json:"active,omitempty"`
	Metadata            map[string]any           `json:"metadata,omitempty"`
}

// AttachmentSlotRequest is one named slot in a policy create/update.
type AttachmentSlotRequest struct {
	Key                 string              `json:"key"`
	Label               forms.LocalizedText `json:"label"`
	Required            bool                `json:"required"`
	SortOrder           int                 `json:"sort_order"`
	AllowedContentTypes []string            `json:"allowed_content_types,omitempty"`
}

// EvaluateAttachmentPolicyRequest asks the service to judge a candidate set of
// provided slot keys / attachment count against the resolved policy.
type EvaluateAttachmentPolicyRequest struct {
	RequestType   string   `json:"request_type"`
	ServiceCode   string   `json:"service_code"`
	ProvidedSlots []string `json:"provided_slots"`
	ProvidedCount int      `json:"provided_count"`
}

func (r *CreateAttachmentPolicyRequest) Normalize() {
	r.RequestType = strings.TrimSpace(r.RequestType)
	r.ServiceCode = strings.ToUpper(strings.TrimSpace(r.ServiceCode))
	r.Name.AR = strings.TrimSpace(r.Name.AR)
	r.Name.EN = strings.TrimSpace(r.Name.EN)
	r.Description.AR = strings.TrimSpace(r.Description.AR)
	r.Description.EN = strings.TrimSpace(r.Description.EN)
	if r.MinAttachmentCount < 0 {
		r.MinAttachmentCount = 0
	}
	if r.MaxAttachmentCount < 0 {
		r.MaxAttachmentCount = 0
	}
	r.AllowedContentTypes = NormalizeTags(r.AllowedContentTypes)
	for i := range r.Slots {
		r.Slots[i].Normalize()
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *AttachmentSlotRequest) Normalize() {
	r.Key = strings.ToLower(strings.TrimSpace(r.Key))
	r.Label.AR = strings.TrimSpace(r.Label.AR)
	r.Label.EN = strings.TrimSpace(r.Label.EN)
	r.AllowedContentTypes = NormalizeTags(r.AllowedContentTypes)
}

func (r *EvaluateAttachmentPolicyRequest) Normalize() {
	r.RequestType = strings.TrimSpace(r.RequestType)
	r.ServiceCode = strings.ToUpper(strings.TrimSpace(r.ServiceCode))
	cleaned := make([]string, 0, len(r.ProvidedSlots))
	for _, s := range r.ProvidedSlots {
		s = strings.ToLower(strings.TrimSpace(s))
		if s != "" {
			cleaned = append(cleaned, s)
		}
	}
	r.ProvidedSlots = cleaned
	if r.ProvidedCount < 0 {
		r.ProvidedCount = 0
	}
}

// ToSlots converts the request slot DTOs to model slots.
func (r *CreateAttachmentPolicyRequest) ToSlots() []model.AttachmentSlot {
	return attachmentSlotsFromRequest(r.Slots)
}

func attachmentSlotsFromRequest(in []AttachmentSlotRequest) []model.AttachmentSlot {
	out := make([]model.AttachmentSlot, 0, len(in))
	for _, s := range in {
		out = append(out, model.AttachmentSlot{
			Key:                 s.Key,
			Label:               s.Label,
			Required:            s.Required,
			SortOrder:           s.SortOrder,
			AllowedContentTypes: s.AllowedContentTypes,
		})
	}
	return out
}

// =============================================================================
// Document full-text search DTOs (CAP-169/182)
// =============================================================================

// DocumentSearchRequest is the query for the FTS endpoint. Query is the
// free-text expression; the remaining fields are optional filters mirroring the
// legal_documents columns.
type DocumentSearchRequest struct {
	Query           string `json:"query"`
	Type            string `json:"type"`
	Status          string `json:"status"`
	Confidentiality string `json:"confidentiality"`
	Category        string `json:"category"`
	Page            int    `json:"page"`
	PerPage         int    `json:"per_page"`
}

func (r *DocumentSearchRequest) Normalize() {
	r.Query = strings.TrimSpace(r.Query)
	r.Type = strings.TrimSpace(r.Type)
	r.Status = strings.TrimSpace(r.Status)
	r.Confidentiality = strings.TrimSpace(r.Confidentiality)
	r.Category = strings.TrimSpace(r.Category)
}

// DocumentSearchHit is one FTS result row with the rank and a highlighted
// snippet computed by ts_headline.
type DocumentSearchHit struct {
	model.LegalDocument
	Rank    float64 `json:"rank"`
	Snippet string  `json:"snippet"`
}

// =============================================================================
// Integration registry DTOs (CAP-174..178)
// =============================================================================

// CreateIntegrationEndpointRequest registers a new external integration endpoint.
type CreateIntegrationEndpointRequest struct {
	Kind        model.IntegrationKind   `json:"kind"`
	Code        string                  `json:"code"`
	Name        string                  `json:"name"`
	Description string                  `json:"description"`
	Status      model.IntegrationStatus `json:"status"`
	Config      map[string]any          `json:"config"`
	Metadata    map[string]any          `json:"metadata,omitempty"`
}

// UpdateIntegrationEndpointRequest patches an endpoint. Nil fields are unchanged.
type UpdateIntegrationEndpointRequest struct {
	Name        *string                  `json:"name,omitempty"`
	Description *string                  `json:"description,omitempty"`
	Status      *model.IntegrationStatus `json:"status,omitempty"`
	Config      map[string]any           `json:"config,omitempty"`
	Metadata    map[string]any           `json:"metadata,omitempty"`
}

func (r *CreateIntegrationEndpointRequest) Normalize() {
	r.Code = strings.ToLower(strings.TrimSpace(r.Code))
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	if r.Status == "" {
		r.Status = model.IntegrationStatusPlanned
	}
	if r.Config == nil {
		r.Config = map[string]any{}
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *UpdateIntegrationEndpointRequest) Normalize() {
	if r.Name != nil {
		trimmed := strings.TrimSpace(*r.Name)
		r.Name = &trimmed
	}
	if r.Description != nil {
		trimmed := strings.TrimSpace(*r.Description)
		r.Description = &trimmed
	}
}

// =============================================================================
// Integration connector-framework DTOs (test / sync / schema). Mirror the
// framework capability outcomes; secrets are never carried.
// =============================================================================

// IntegrationFieldSpecResponse is one schema field rendered to the dynamic
// console form. It mirrors integration.FieldSpec but lives in dto so the handler
// does not import the framework package into its wire contract.
type IntegrationFieldSpecResponse struct {
	Key      string              `json:"key"`
	Label    forms.LocalizedText `json:"label"`
	Type     string              `json:"type"`
	Secret   bool                `json:"secret"`
	Required bool                `json:"required"`
	Enum     []string            `json:"enum,omitempty"`
	Default  string              `json:"default,omitempty"`
	Help     forms.LocalizedText `json:"help,omitempty"`
}

// IntegrationSchemaResponse is the GET /integrations/schema/{kind} payload: the
// kind plus its ordered field specs. Drives the DynamicConnectorForm.
type IntegrationSchemaResponse struct {
	Kind   string                         `json:"kind"`
	Fields []IntegrationFieldSpecResponse `json:"fields"`
}

// IntegrationTestResponse is the POST /integrations/{id}/test payload — the
// sanitized connection-test outcome. Never carries secrets.
type IntegrationTestResponse struct {
	EndpointID    string         `json:"endpoint_id"`
	Reachable     bool           `json:"reachable"`
	Detail        string         `json:"detail"`
	SampleCount   int            `json:"sample_count"`
	LatencyMillis int64          `json:"latency_millis"`
	CheckedAt     string         `json:"checked_at"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	// Steps (feature 2) is the per-stage diagnostic breakdown. The handler fills it
	// via integration.SynthesizeSteps so it is always non-empty for the UI.
	Steps []IntegrationDiagnosticStepResponse `json:"steps,omitempty"`
}

// IntegrationDiagnosticStepResponse (feature 2) is one diagnostic stage in API
// form. Mirrors integration.DiagnosticStep; carries no secrets.
type IntegrationDiagnosticStepResponse struct {
	Key       string              `json:"key"`
	Label     forms.LocalizedText `json:"label"`
	Status    string              `json:"status"`
	LatencyMs int64               `json:"latency_ms"`
	Detail    string              `json:"detail,omitempty"`
	Hint      string              `json:"hint,omitempty"`
}

// RotateIntegrationSecretRequest (feature 5) rotates ONE secret config field to a
// new value. The new value is write-only: it is re-encrypted and never echoed.
type RotateIntegrationSecretRequest struct {
	// Field is the secret config key to rotate (e.g. client_secret, private_key).
	Field string `json:"field"`
	// Value is the new secret value. It must be a real value (not the redaction
	// sentinel) and is never returned in any response.
	Value string `json:"value"`
}

func (r *RotateIntegrationSecretRequest) Normalize() {
	r.Field = strings.TrimSpace(r.Field)
}

// SandboxInvokeRequest (feature 9) requests a mock/sandbox connector op. It never
// touches a real upstream system.
type SandboxInvokeRequest struct {
	Operation string         `json:"operation"`
	Payload   map[string]any `json:"payload"`
}

func (r *SandboxInvokeRequest) Normalize() {
	r.Operation = strings.TrimSpace(r.Operation)
}

// IntegrationCatalogEntryResponse (feature 7) is one connector-catalog entry in API
// form: maturity, bilingual prerequisite steps, webhook/callback templates, KSA
// tags, and the self-serve flag. Secret-free and tenant-agnostic.
type IntegrationCatalogEntryResponse struct {
	Kind              string                `json:"kind"`
	Maturity          string                `json:"maturity"`
	PrerequisiteSteps []forms.LocalizedText `json:"prerequisite_steps"`
	CallbackTemplates map[string]string     `json:"callback_templates,omitempty"`
	KsaTags           []string              `json:"ksa_tags,omitempty"`
	SelfServe         bool                  `json:"self_serve"`
}

// IntegrationSyncRunResponse is one sync-run ledger row in API form.
type IntegrationSyncRunResponse struct {
	ID         string         `json:"id"`
	EndpointID string         `json:"endpoint_id"`
	Kind       string         `json:"kind"`
	Mode       string         `json:"mode"`
	Status     string         `json:"status"`
	Processed  int            `json:"processed"`
	Created    int            `json:"created"`
	Updated    int            `json:"updated"`
	Skipped    int            `json:"skipped"`
	Failed     int            `json:"failed"`
	Watermark  string         `json:"watermark,omitempty"`
	Detail     string         `json:"detail"`
	Error      string         `json:"error,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	StartedAt  string         `json:"started_at"`
	FinishedAt string         `json:"finished_at"`
}
