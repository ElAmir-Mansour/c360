package admin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

type Service struct {
	repo *Repo
}

func NewService(repo *Repo) *Service {
	return &Service{repo: repo}
}

var (
	parserNameRE    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,63}$`)
	parserVersionRE = regexp.MustCompile(`^[0-9]+(\.[0-9]+){0,2}([-+][A-Za-z0-9.-]+)?$`)
)

func (s *Service) CreateParser(ctx context.Context, in ParserCreateInput) (*Parser, error) {
	normalized, hash, err := normalizeParserInput(in)
	if err != nil {
		return nil, err
	}
	return s.repo.CreateParser(ctx, normalized, hash)
}

func (s *Service) GetParser(ctx context.Context, tenantID, id uuid.UUID) (*Parser, error) {
	return s.repo.GetParser(ctx, tenantID, id)
}

func (s *Service) ListParsers(ctx context.Context, tenantID uuid.UUID, lq ParserListQuery) ([]Parser, error) {
	if lq.Status != nil && !isParserStatus(*lq.Status) {
		return nil, &FieldErrors{Errors: []FieldError{{
			Field: "status", Code: "invalid", Message: "status must be draft, active, or retired",
		}}}
	}
	return s.repo.ListParsers(ctx, tenantID, lq)
}

func (s *Service) UpdateParser(ctx context.Context, tenantID, id uuid.UUID, patch ParserUpdateInput) (*Parser, error) {
	current, err := s.repo.GetParser(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if current.Status != ParserStatusDraft {
		return nil, fmt.Errorf("%w: only draft parsers are mutable", ErrInvalidState)
	}

	merged := ParserCreateInput{
		TenantID:   tenantID,
		Name:       current.Name,
		SourceType: current.SourceType,
		Version:    current.Version,
		ECSVersion: current.ECSVersion,
		Config:     current.Config,
		Fixtures:   current.Fixtures,
		CreatedBy:  current.CreatedBy,
	}
	if patch.Name != nil {
		merged.Name = *patch.Name
	}
	if patch.SourceType != nil {
		merged.SourceType = *patch.SourceType
	}
	if patch.Version != nil {
		merged.Version = *patch.Version
	}
	if patch.ECSVersion != nil {
		merged.ECSVersion = *patch.ECSVersion
	}
	if patch.Config != nil {
		merged.Config = *patch.Config
	}
	if patch.Fixtures != nil {
		merged.Fixtures = *patch.Fixtures
	}

	normalized, hash, err := normalizeParserInput(merged)
	if err != nil {
		return nil, err
	}
	return s.repo.UpdateParser(ctx, tenantID, id, normalized, hash)
}

func (s *Service) PromoteParser(ctx context.Context, tenantID, id uuid.UUID) (*Parser, error) {
	current, err := s.repo.GetParser(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if current.Status == ParserStatusRetired {
		return nil, fmt.Errorf("%w: retired parser cannot be promoted", ErrInvalidState)
	}
	return s.repo.PromoteParser(ctx, tenantID, id)
}

func (s *Service) RetireParser(ctx context.Context, tenantID, id uuid.UUID) (*Parser, error) {
	return s.repo.RetireParser(ctx, tenantID, id)
}

func (s *Service) GetSettings(ctx context.Context, tenantID uuid.UUID) (*Settings, error) {
	return s.repo.GetSettings(ctx, tenantID)
}

func (s *Service) UpdateSettings(ctx context.Context, in SettingsInput) (*Settings, error) {
	if errs := validateSettings(in); len(errs) > 0 {
		return nil, &FieldErrors{Errors: errs}
	}
	return s.repo.UpdateSettings(ctx, in)
}

func normalizeParserInput(in ParserCreateInput) (ParserCreateInput, string, error) {
	out := ParserCreateInput{
		TenantID:   in.TenantID,
		Name:       strings.ToLower(strings.TrimSpace(in.Name)),
		SourceType: strings.TrimSpace(in.SourceType),
		Version:    strings.TrimSpace(in.Version),
		ECSVersion: strings.TrimSpace(in.ECSVersion),
		CreatedBy:  in.CreatedBy,
	}
	if out.ECSVersion == "" {
		out.ECSVersion = "8.11"
	}

	var errs []FieldError
	if !parserNameRE.MatchString(out.Name) {
		errs = append(errs, FieldError{
			Field: "name", Code: "invalid",
			Message: "name must be 3-64 lowercase letters, numbers, or hyphens",
		})
	}
	if len(out.SourceType) < 2 || len(out.SourceType) > 96 {
		errs = append(errs, FieldError{
			Field: "source_type", Code: "invalid",
			Message: "source_type must be 2-96 characters",
		})
	}
	if !parserVersionRE.MatchString(out.Version) {
		errs = append(errs, FieldError{
			Field: "version", Code: "invalid",
			Message: "version must be a semantic numeric version",
		})
	}

	config, err := normalizeJSON(in.Config, json.RawMessage(`{}`), true)
	if err != nil {
		errs = append(errs, FieldError{Field: "config", Code: "invalid", Message: err.Error()})
	}
	fixtures, err := normalizeJSON(in.Fixtures, json.RawMessage(`[]`), false)
	if err != nil {
		errs = append(errs, FieldError{Field: "fixtures", Code: "invalid", Message: err.Error()})
	}
	if len(errs) > 0 {
		return ParserCreateInput{}, "", &FieldErrors{Errors: errs}
	}
	out.Config = config
	out.Fixtures = fixtures

	sumPayload := struct {
		Name       string          `json:"name"`
		SourceType string          `json:"source_type"`
		Version    string          `json:"version"`
		ECSVersion string          `json:"ecs_version"`
		Config     json.RawMessage `json:"config"`
		Fixtures   json.RawMessage `json:"fixtures"`
	}{
		Name: out.Name, SourceType: out.SourceType, Version: out.Version,
		ECSVersion: out.ECSVersion, Config: out.Config, Fixtures: out.Fixtures,
	}
	b, _ := json.Marshal(sumPayload)
	hash := sha256.Sum256(b)
	return out, fmt.Sprintf("%x", hash[:]), nil
}

func normalizeJSON(raw json.RawMessage, fallback json.RawMessage, wantObject bool) (json.RawMessage, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = fallback
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("must be valid JSON")
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	if wantObject {
		if _, ok := decoded.(map[string]any); !ok {
			return nil, fmt.Errorf("must be a JSON object")
		}
	} else {
		if _, ok := decoded.([]any); !ok {
			return nil, fmt.Errorf("must be a JSON array")
		}
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return nil, err
	}
	return json.RawMessage(buf.Bytes()), nil
}

func validateSettings(in SettingsInput) []FieldError {
	var errs []FieldError
	if in.RetentionDays < 1 || in.RetentionDays > 3650 {
		errs = append(errs, FieldError{
			Field: "retention_days", Code: "invalid",
			Message: "retention_days must be between 1 and 3650",
		})
	}
	if in.WarmTierDays < 0 {
		errs = append(errs, FieldError{
			Field: "warm_tier_days", Code: "invalid",
			Message: "warm_tier_days must be zero or greater",
		})
	}
	if in.RetentionDays > 0 && in.WarmTierDays > in.RetentionDays {
		errs = append(errs, FieldError{
			Field: "warm_tier_days", Code: "invalid",
			Message: "warm_tier_days cannot exceed retention_days",
		})
	}
	return errs
}

func isParserStatus(s ParserStatus) bool {
	return s == ParserStatusDraft || s == ParserStatusActive || s == ParserStatusRetired
}
