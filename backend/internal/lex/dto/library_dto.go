package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

type CreateClauseLibraryItemRequest struct {
	Code             string                       `json:"code"`
	TitleEN          string                       `json:"title_en"`
	TitleAR          string                       `json:"title_ar"`
	TextEN           string                       `json:"text_en"`
	TextAR           string                       `json:"text_ar"`
	ClauseType       model.ClauseType             `json:"clause_type"`
	Category         string                       `json:"category"`
	Jurisdiction     string                       `json:"jurisdiction"`
	Source           string                       `json:"source"`
	SourceURL        string                       `json:"source_url"`
	Version          int                          `json:"version"`
	Status           model.ClauseLibraryStatus    `json:"status"`
	GovernanceStatus model.ClauseGovernanceStatus `json:"governance_status"`
	SupersedesID     *uuid.UUID                   `json:"supersedes_id,omitempty"`
	DeprecatedByID   *uuid.UUID                   `json:"deprecated_by_id,omitempty"`
	Tags             []string                     `json:"tags"`
	Metadata         map[string]any               `json:"metadata"`
}

type UpdateClauseLibraryItemRequest struct {
	Code             *string                       `json:"code,omitempty"`
	TitleEN          *string                       `json:"title_en,omitempty"`
	TitleAR          *string                       `json:"title_ar,omitempty"`
	TextEN           *string                       `json:"text_en,omitempty"`
	TextAR           *string                       `json:"text_ar,omitempty"`
	ClauseType       *model.ClauseType             `json:"clause_type,omitempty"`
	Category         *string                       `json:"category,omitempty"`
	Jurisdiction     *string                       `json:"jurisdiction,omitempty"`
	Source           *string                       `json:"source,omitempty"`
	SourceURL        *string                       `json:"source_url,omitempty"`
	Version          *int                          `json:"version,omitempty"`
	Status           *model.ClauseLibraryStatus    `json:"status,omitempty"`
	GovernanceStatus *model.ClauseGovernanceStatus `json:"governance_status,omitempty"`
	SupersedesID     *uuid.UUID                    `json:"supersedes_id,omitempty"`
	DeprecatedByID   *uuid.UUID                    `json:"deprecated_by_id,omitempty"`
	Tags             []string                      `json:"tags,omitempty"`
	Metadata         map[string]any                `json:"metadata,omitempty"`
}

type CreateRegulationLibraryItemRequest struct {
	Code           string                 `json:"code"`
	TitleEN        string                 `json:"title_en"`
	TitleAR        string                 `json:"title_ar"`
	DescriptionEN  string                 `json:"description_en"`
	DescriptionAR  string                 `json:"description_ar"`
	Jurisdiction   string                 `json:"jurisdiction"`
	Authority      string                 `json:"authority"`
	Source         string                 `json:"source"`
	SourceURL      string                 `json:"source_url"`
	RegulationType model.RegulationType   `json:"regulation_type"`
	EffectiveDate  *time.Time             `json:"effective_date,omitempty"`
	Version        int                    `json:"version"`
	Status         model.RegulationStatus `json:"status"`
	Tags           []string               `json:"tags"`
	Metadata       map[string]any         `json:"metadata"`
}

type UpdateRegulationLibraryItemRequest struct {
	Code           *string                 `json:"code,omitempty"`
	TitleEN        *string                 `json:"title_en,omitempty"`
	TitleAR        *string                 `json:"title_ar,omitempty"`
	DescriptionEN  *string                 `json:"description_en,omitempty"`
	DescriptionAR  *string                 `json:"description_ar,omitempty"`
	Jurisdiction   *string                 `json:"jurisdiction,omitempty"`
	Authority      *string                 `json:"authority,omitempty"`
	Source         *string                 `json:"source,omitempty"`
	SourceURL      *string                 `json:"source_url,omitempty"`
	RegulationType *model.RegulationType   `json:"regulation_type,omitempty"`
	EffectiveDate  *time.Time              `json:"effective_date,omitempty"`
	Version        *int                    `json:"version,omitempty"`
	Status         *model.RegulationStatus `json:"status,omitempty"`
	Tags           []string                `json:"tags,omitempty"`
	Metadata       map[string]any          `json:"metadata,omitempty"`
}

type CreateRegulationClauseReferenceRequest struct {
	ClauseID      uuid.UUID                           `json:"clause_id"`
	ReferenceType model.RegulationClauseReferenceType `json:"reference_type"`
	Notes         string                              `json:"notes"`
}

type LibraryGovernanceDecisionRequest struct {
	Decision string         `json:"decision"`
	Activate bool           `json:"activate"`
	Notes    string         `json:"notes"`
	Evidence map[string]any `json:"evidence"`
}

func (r *CreateClauseLibraryItemRequest) Normalize() {
	r.Code = strings.TrimSpace(r.Code)
	r.TitleEN = strings.TrimSpace(r.TitleEN)
	r.TitleAR = strings.TrimSpace(r.TitleAR)
	r.TextEN = strings.TrimSpace(r.TextEN)
	r.TextAR = strings.TrimSpace(r.TextAR)
	r.Category = strings.TrimSpace(r.Category)
	r.Jurisdiction = defaultString(strings.ToUpper(strings.TrimSpace(r.Jurisdiction)), "SA")
	r.Source = strings.TrimSpace(r.Source)
	r.SourceURL = strings.TrimSpace(r.SourceURL)
	if r.Version == 0 {
		r.Version = 1
	}
	if r.Status == "" {
		r.Status = model.ClauseLibraryStatusDraft
	}
	if r.GovernanceStatus == "" {
		r.GovernanceStatus = model.ClauseGovernancePendingReview
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	r.Tags = normalizeStrings(r.Tags)
	if r.Tags == nil {
		// tags column is NOT NULL DEFAULT '{}'; never insert a NULL array.
		r.Tags = []string{}
	}
}

func (r *CreateRegulationLibraryItemRequest) Normalize() {
	r.Code = strings.TrimSpace(r.Code)
	r.TitleEN = strings.TrimSpace(r.TitleEN)
	r.TitleAR = strings.TrimSpace(r.TitleAR)
	r.DescriptionEN = strings.TrimSpace(r.DescriptionEN)
	r.DescriptionAR = strings.TrimSpace(r.DescriptionAR)
	r.Jurisdiction = defaultString(strings.ToUpper(strings.TrimSpace(r.Jurisdiction)), "SA")
	r.Authority = strings.TrimSpace(r.Authority)
	r.Source = strings.TrimSpace(r.Source)
	r.SourceURL = strings.TrimSpace(r.SourceURL)
	if r.Version == 0 {
		r.Version = 1
	}
	if r.RegulationType == "" {
		r.RegulationType = model.RegulationTypeRegulation
	}
	if r.Status == "" {
		r.Status = model.RegulationStatusActive
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	r.Tags = normalizeStrings(r.Tags)
	if r.Tags == nil {
		// tags column is NOT NULL DEFAULT '{}'; never insert a NULL array.
		r.Tags = []string{}
	}
}

func (r *CreateRegulationClauseReferenceRequest) Normalize() {
	r.Notes = strings.TrimSpace(r.Notes)
	if r.ReferenceType == "" {
		r.ReferenceType = model.RegulationClauseReferenceImplements
	}
}

func (r *LibraryGovernanceDecisionRequest) Normalize() {
	r.Decision = strings.ToLower(strings.TrimSpace(r.Decision))
	r.Notes = strings.TrimSpace(r.Notes)
	if r.Evidence == nil {
		r.Evidence = map[string]any{}
	}
}

func normalizeOptionalString(value *string, upper bool) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if upper {
		trimmed = strings.ToUpper(trimmed)
	}
	return &trimmed
}

func normalizeStrings(values []string) []string {
	if values == nil {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
