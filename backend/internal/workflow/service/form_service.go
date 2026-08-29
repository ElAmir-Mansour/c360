package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/workflow/model"
)

// FormService exposes tenant-scoped authoring for canonical workflow forms.
type FormService struct {
	pool  *pgxpool.Pool
	store *forms.Store
}

// NewFormService creates a FormService backed by workflow_forms.
func NewFormService(pool *pgxpool.Pool) *FormService {
	return &FormService{pool: pool, store: forms.NewStore()}
}

// CreateForm validates and persists a new form definition version.
func (s *FormService) CreateForm(ctx context.Context, tenantID string, fd *forms.FormDefinition) (*forms.FormDefinition, error) {
	tid, err := parseFormTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	normalizeFormDefinition(fd, tid.String())
	if err := validateAuthoringForm(fd, true); err != nil {
		return nil, err
	}

	var out *forms.FormDefinition
	err = database.RunWithTenant(ctx, s.pool, tid, func(tx pgx.Tx) error {
		created, err := s.store.Create(ctx, tx, fd)
		if err != nil {
			return err
		}
		out = created
		return nil
	})
	if err != nil {
		return nil, mapFormsError(err)
	}
	return out, nil
}

// GetForm loads one form definition by id.
func (s *FormService) GetForm(ctx context.Context, tenantID, id string) (*forms.FormDefinition, error) {
	tid, err := parseFormTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("form id is required")
	}

	var out *forms.FormDefinition
	err = database.RunReadWithTenant(ctx, s.pool, tid, func(tx pgx.Tx) error {
		got, err := s.store.GetByID(ctx, tx, id)
		if err != nil {
			return err
		}
		out = got
		return nil
	})
	if err != nil {
		return nil, mapFormsError(err)
	}
	return out, nil
}

// ListForms lists all visible form definitions for a tenant.
func (s *FormService) ListForms(ctx context.Context, tenantID string) ([]*forms.FormDefinition, error) {
	tid, err := parseFormTenantID(tenantID)
	if err != nil {
		return nil, err
	}

	var out []*forms.FormDefinition
	err = database.RunReadWithTenant(ctx, s.pool, tid, func(tx pgx.Tx) error {
		listed, err := s.store.List(ctx, tx)
		if err != nil {
			return err
		}
		out = listed
		return nil
	})
	if err != nil {
		return nil, mapFormsError(err)
	}
	if out == nil {
		out = []*forms.FormDefinition{}
	}
	return out, nil
}

// UpdateForm replaces the bilingual body of an existing form definition.
func (s *FormService) UpdateForm(ctx context.Context, tenantID, id string, fd *forms.FormDefinition) (*forms.FormDefinition, error) {
	tid, err := parseFormTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("form id is required")
	}
	normalizeFormDefinition(fd, tid.String())
	fd.ID = id
	if err := validateAuthoringForm(fd, false); err != nil {
		return nil, err
	}

	var out *forms.FormDefinition
	err = database.RunWithTenant(ctx, s.pool, tid, func(tx pgx.Tx) error {
		updated, err := s.store.UpdateBody(ctx, tx, fd)
		if err != nil {
			return err
		}
		out = updated
		return nil
	})
	if err != nil {
		return nil, mapFormsError(err)
	}
	return out, nil
}

// DeleteForm removes a form definition by id.
func (s *FormService) DeleteForm(ctx context.Context, tenantID, id string) error {
	tid, err := parseFormTenantID(tenantID)
	if err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("form id is required")
	}

	err = database.RunWithTenant(ctx, s.pool, tid, func(tx pgx.Tx) error {
		return s.store.Delete(ctx, tx, id)
	})
	if err != nil {
		return mapFormsError(err)
	}
	return nil
}

func parseFormTenantID(tenantID string) (uuid.UUID, error) {
	tid, err := uuid.Parse(strings.TrimSpace(tenantID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid tenant id: %w", err)
	}
	return tid, nil
}

func normalizeFormDefinition(fd *forms.FormDefinition, tenantID string) {
	if fd == nil {
		return
	}
	fd.TenantID = tenantID
	fd.Name = strings.TrimSpace(fd.Name)
	fd.DefaultLocale = strings.TrimSpace(fd.DefaultLocale)
	for idx := range fd.Locales {
		fd.Locales[idx] = strings.TrimSpace(fd.Locales[idx])
	}
	for idx := range fd.Fields {
		fd.Fields[idx].Name = strings.TrimSpace(fd.Fields[idx].Name)
	}
}

func validateAuthoringForm(fd *forms.FormDefinition, requireName bool) error {
	if fd == nil {
		return fmt.Errorf("form definition is required")
	}
	if requireName && fd.Name == "" {
		return fmt.Errorf("form name is required")
	}
	if len(fd.Locales) == 0 {
		return fmt.Errorf("form locales are required")
	}
	if fd.DefaultLocale == "" {
		return fmt.Errorf("form default_locale is required")
	}
	if len(fd.Fields) == 0 {
		return fmt.Errorf("form fields are required")
	}
	if violations := fd.Validate(); len(violations) > 0 {
		return fmt.Errorf("invalid form definition: %d violation(s), first: %s", len(violations), violations[0].String())
	}
	return nil
}

func mapFormsError(err error) error {
	switch {
	case errors.Is(err, forms.ErrNotFound):
		return fmt.Errorf("%w: form not found", model.ErrNotFound)
	case errors.Is(err, forms.ErrConflict):
		return fmt.Errorf("%w: form already exists", model.ErrConflict)
	case errors.Is(err, forms.ErrInvalid):
		return fmt.Errorf("invalid form definition: %w", err)
	default:
		return err
	}
}
