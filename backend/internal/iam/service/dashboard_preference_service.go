package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
)

const maxDashboardPreferenceBytes = 64 * 1024

type DashboardPreferenceService struct {
	repo repository.DashboardPreferenceRepository
}

func NewDashboardPreferenceService(repo repository.DashboardPreferenceRepository) *DashboardPreferenceService {
	return &DashboardPreferenceService{repo: repo}
}

func (s *DashboardPreferenceService) Get(ctx context.Context, tenantID, userID string) (*dto.DashboardPreferenceResponse, error) {
	preference, err := s.repo.Get(ctx, tenantID, userID)
	if err != nil {
		if err == model.ErrNotFound {
			return &dto.DashboardPreferenceResponse{Preferences: json.RawMessage(`{}`)}, nil
		}
		return nil, err
	}
	return &dto.DashboardPreferenceResponse{
		Preferences: preference.Preferences,
		UpdatedAt:   &preference.UpdatedAt,
	}, nil
}

func (s *DashboardPreferenceService) Update(
	ctx context.Context,
	tenantID, userID string,
	req *dto.DashboardPreferenceRequest,
) (*dto.DashboardPreferenceResponse, error) {
	normalized, err := validateDashboardPreferences(req.Preferences)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", err.Error(), model.ErrValidation)
	}
	preference := &model.DashboardPreference{
		TenantID:    tenantID,
		UserID:      userID,
		Preferences: normalized,
	}
	if err := s.repo.Upsert(ctx, preference); err != nil {
		return nil, err
	}
	return &dto.DashboardPreferenceResponse{
		Preferences: preference.Preferences,
		UpdatedAt:   &preference.UpdatedAt,
	}, nil
}

func (s *DashboardPreferenceService) Reset(ctx context.Context, tenantID, userID string) error {
	return s.repo.Delete(ctx, tenantID, userID)
}

func validateDashboardPreferences(raw json.RawMessage) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if len(trimmed) > maxDashboardPreferenceBytes {
		return nil, fmt.Errorf("dashboard preferences exceed %d KB", maxDashboardPreferenceBytes/1024)
	}
	var value map[string]any
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return nil, fmt.Errorf("dashboard preferences must be valid JSON")
	}
	if value == nil {
		return nil, fmt.Errorf("dashboard preferences must be a JSON object")
	}
	return json.Marshal(value)
}
