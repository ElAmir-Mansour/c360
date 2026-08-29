package service

import (
	"context"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// legalCourtCodeMaxLen bounds the admin-entered code. The column is TEXT, so the
// limit is a usability guard rather than a storage one.
const legalCourtCodeMaxLen = 64

// legalCourtNameMaxLen bounds each localized court name.
const legalCourtNameMaxLen = 200

type LegalCourtService struct {
	courts *repository.LegalCourtRepository
}

func NewLegalCourtService(courts *repository.LegalCourtRepository) *LegalCourtService {
	return &LegalCourtService{courts: courts}
}

func (s *LegalCourtService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalCourt, error) {
	court, err := s.courts.Get(ctx, tenantID, id)
	if err == pgx.ErrNoRows {
		return nil, notFoundError("legal court not found")
	}
	if err != nil {
		return nil, internalError("load legal court", err)
	}
	return court, nil
}

func (s *LegalCourtService) List(ctx context.Context, tenantID uuid.UUID, filters model.LegalCourtListFilters) ([]model.LegalCourt, int, error) {
	items, total, err := s.courts.List(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("list legal courts", err)
	}
	return items, total, nil
}

// Create adds a court to the tenant's reference list. The list ships empty on
// purpose (the customer-supplied names never arrived), so this is the only path
// by which the competent-court dropdown ever becomes populated.
func (s *LegalCourtService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateLegalCourtRequest) (*model.LegalCourt, error) {
	req.Normalize()
	if err := validateLegalCourtCode(req.Code); err != nil {
		return nil, err
	}
	if err := validateLegalCourtName(req.Name.EN, req.Name.AR); err != nil {
		return nil, err
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	sortOrder := 0
	if req.Sort != nil {
		sortOrder = *req.Sort
	}
	court := &model.LegalCourt{
		ID:        uuid.New(),
		TenantID:  tenantID,
		Code:      req.Code,
		Name:      req.Name,
		Active:    active,
		IsSystem:  false,
		Sort:      sortOrder,
		Metadata:  req.Metadata,
		CreatedBy: userID,
	}
	if err := s.courts.Create(ctx, court); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a court with this code already exists")
		}
		return nil, internalError("create legal court", err)
	}
	return s.Get(ctx, tenantID, court.ID)
}

// Update patches a court. Nil request fields are left untouched so a partial
// PUT from the admin console cannot blank a name it did not send.
func (s *LegalCourtService) Update(ctx context.Context, tenantID, id uuid.UUID, req dto.UpdateLegalCourtRequest) (*model.LegalCourt, error) {
	req.Normalize()
	court, err := s.courts.Get(ctx, tenantID, id)
	if err == pgx.ErrNoRows {
		return nil, notFoundError("legal court not found")
	}
	if err != nil {
		return nil, internalError("load legal court", err)
	}
	if req.Code != nil {
		if court.IsSystem && *req.Code != court.Code {
			return nil, conflictError("a system court code cannot be changed")
		}
		court.Code = *req.Code
	}
	if req.Name != nil {
		court.Name = *req.Name
	}
	if req.Active != nil {
		court.Active = *req.Active
	}
	if req.Sort != nil {
		court.Sort = *req.Sort
	}
	if req.Metadata != nil {
		court.Metadata = req.Metadata
	}
	if err := validateLegalCourtCode(court.Code); err != nil {
		return nil, err
	}
	if err := validateLegalCourtName(court.Name.EN, court.Name.AR); err != nil {
		return nil, err
	}
	if err := s.courts.Update(ctx, court); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a court with this code already exists")
		}
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal court not found")
		}
		return nil, internalError("update legal court", err)
	}
	return s.Get(ctx, tenantID, id)
}

// Delete tombstones a court. A court still referenced by live cases is refused
// rather than cascaded: the reference is real data, and breaking it silently
// would lose which court a case was filed in. Deactivate instead.
func (s *LegalCourtService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	court, err := s.courts.Get(ctx, tenantID, id)
	if err == pgx.ErrNoRows {
		return notFoundError("legal court not found")
	}
	if err != nil {
		return internalError("load legal court", err)
	}
	if court.IsSystem {
		return conflictError("a system court cannot be deleted")
	}
	inUse, err := s.courts.CountCasesUsing(ctx, tenantID, id)
	if err != nil {
		return internalError("count cases using legal court", err)
	}
	if inUse > 0 {
		return conflictError("this court is still referenced by existing cases; deactivate it instead of deleting it")
	}
	if err := s.courts.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal court not found")
		}
		return internalError("delete legal court", err)
	}
	return nil
}

// LegacyValues lists the distinct free-text competent-court strings still carried
// by cases that predate the reference list. It is deliberately read-only: the
// values are shown so an administrator can reconcile them by hand, never mapped
// or discarded automatically.
func (s *LegalCourtService) LegacyValues(ctx context.Context, tenantID uuid.UUID, limit int) ([]dto.LegalCourtLegacyValue, error) {
	items, err := s.courts.LegacyCourtValues(ctx, tenantID, limit)
	if err != nil {
		return nil, internalError("list legacy competent-court values", err)
	}
	return items, nil
}

func validateLegalCourtCode(code string) error {
	if strings.TrimSpace(code) == "" {
		return validationError("court code is required", map[string]string{"code": "required"})
	}
	if len(code) > legalCourtCodeMaxLen {
		return validationError("court code is too long", map[string]string{"code": "too_long"})
	}
	for _, r := range code {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			continue
		}
		return validationError(
			"court code may contain only letters, digits, hyphen and underscore",
			map[string]string{"code": "invalid"},
		)
	}
	return nil
}

func validateLegalCourtName(en, ar string) error {
	if strings.TrimSpace(en) == "" && strings.TrimSpace(ar) == "" {
		// The DB CHECK enforces the same rule; failing here yields a 422 with a
		// field hint instead of a constraint-violation 500.
		return validationError("court name is required in English or Arabic", map[string]string{"name": "required"})
	}
	if len([]rune(en)) > legalCourtNameMaxLen || len([]rune(ar)) > legalCourtNameMaxLen {
		return validationError("court name is too long", map[string]string{"name": "too_long"})
	}
	return nil
}
