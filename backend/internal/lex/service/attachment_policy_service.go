package service

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// AttachmentPolicyService administers per-request-type / service-code attachment
// requirement policies (CAP-165..170) and evaluates intake completeness against
// them. Every mutating op emits a lex audit record through the audit emitter
// seam (CAP-155/181) and a domain event, mirroring the document/contract
// services. docx/pdf support (CAP-166) and archive/versioning/classification
// (CAP-167/168) live in the document store; this service only owns the
// REQUIREMENT policy.
type AttachmentPolicyService struct {
	db        *pgxpool.Pool
	repo      *repository.AttachmentPolicyRepository
	publisher Publisher
	audit     *LexAuditEmitter
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

func NewAttachmentPolicyService(db *pgxpool.Pool, repo *repository.AttachmentPolicyRepository, publisher Publisher, audit *LexAuditEmitter, topic string, logger zerolog.Logger) *AttachmentPolicyService {
	return &AttachmentPolicyService{
		db:        db,
		repo:      repo,
		publisher: publisherOrNoop(publisher),
		audit:     audit,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-attachment-policies").Logger(),
		now:       time.Now,
	}
}

func (s *AttachmentPolicyService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateAttachmentPolicyRequest) (*model.AttachmentPolicy, error) {
	req.Normalize()
	if req.RequestType == "" && req.ServiceCode == "" {
		return nil, validationError("request_type or service_code is required", map[string]string{"request_type": "required_one_of"})
	}
	if req.Name.IsEmpty() {
		return nil, validationError("name is required", map[string]string{"name": "required"})
	}
	if err := validateAttachmentPolicyCounts(req.MinAttachmentCount, req.MaxAttachmentCount); err != nil {
		return nil, err
	}
	if err := validateSlots(req.Slots); err != nil {
		return nil, err
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	policy := &model.AttachmentPolicy{
		ID:                  uuid.New(),
		TenantID:            tenantID,
		RequestType:         req.RequestType,
		ServiceCode:         req.ServiceCode,
		Name:                req.Name,
		Description:         req.Description,
		MinAttachmentCount:  req.MinAttachmentCount,
		MaxAttachmentCount:  req.MaxAttachmentCount,
		Slots:               req.ToSlots(),
		AllowedContentTypes: req.AllowedContentTypes,
		MaxFileSizeBytes:    req.MaxFileSizeBytes,
		Active:              active,
		Metadata:            req.Metadata,
		CreatedBy:           userID,
	}
	if err := s.repo.Create(ctx, s.db, policy); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("an attachment policy already exists for this request_type/service_code")
		}
		return nil, internalError("create attachment policy", err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.attachment_policy.created", "attachment_policy.created", policy)
	return policy, nil
}

func (s *AttachmentPolicyService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateAttachmentPolicyRequest) (*model.AttachmentPolicy, error) {
	policy, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("attachment policy not found")
		}
		return nil, internalError("load attachment policy", err)
	}
	if req.RequestType != nil {
		policy.RequestType = strings.TrimSpace(*req.RequestType)
	}
	if req.ServiceCode != nil {
		policy.ServiceCode = strings.ToUpper(strings.TrimSpace(*req.ServiceCode))
	}
	if req.Name != nil {
		policy.Name = *req.Name
	}
	if req.Description != nil {
		policy.Description = *req.Description
	}
	if req.MinAttachmentCount != nil {
		policy.MinAttachmentCount = *req.MinAttachmentCount
	}
	if req.MaxAttachmentCount != nil {
		policy.MaxAttachmentCount = *req.MaxAttachmentCount
	}
	if req.Slots != nil {
		slotReqs := *req.Slots
		for i := range slotReqs {
			slotReqs[i].Normalize()
		}
		if err := validateSlots(slotReqs); err != nil {
			return nil, err
		}
		policy.Slots = dtoSlotsToModel(slotReqs)
	}
	if req.AllowedContentTypes != nil {
		policy.AllowedContentTypes = dto.NormalizeTags(*req.AllowedContentTypes)
	}
	if req.MaxFileSizeBytes != nil {
		policy.MaxFileSizeBytes = *req.MaxFileSizeBytes
	}
	if req.Active != nil {
		policy.Active = *req.Active
	}
	if req.Metadata != nil {
		policy.Metadata = req.Metadata
	}
	if policy.RequestType == "" && policy.ServiceCode == "" {
		return nil, validationError("request_type or service_code is required", map[string]string{"request_type": "required_one_of"})
	}
	if err := validateAttachmentPolicyCounts(policy.MinAttachmentCount, policy.MaxAttachmentCount); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, s.db, policy); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("an attachment policy already exists for this request_type/service_code")
		}
		return nil, internalError("update attachment policy", err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.attachment_policy.updated", "attachment_policy.updated", policy)
	return policy, nil
}

func (s *AttachmentPolicyService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.AttachmentPolicy, error) {
	policy, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("attachment policy not found")
		}
		return nil, internalError("get attachment policy", err)
	}
	return policy, nil
}

func (s *AttachmentPolicyService) List(ctx context.Context, tenantID uuid.UUID, requestType, serviceCode string, activeOnly bool, page, perPage int) ([]model.AttachmentPolicy, int, error) {
	return s.repo.List(ctx, tenantID, strings.TrimSpace(requestType), strings.ToUpper(strings.TrimSpace(serviceCode)), activeOnly, page, perPage)
}

func (s *AttachmentPolicyService) Delete(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	if err := s.repo.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("attachment policy not found")
		}
		return internalError("delete attachment policy", err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.attachment_policy.deleted", "attachment_policy.deleted", map[string]any{"id": id})
	return nil
}

// Evaluate resolves the applicable policy and judges a candidate set of provided
// slot keys / count against it. When no active policy applies the evaluation is
// trivially complete (no requirement configured).
func (s *AttachmentPolicyService) Evaluate(ctx context.Context, tenantID uuid.UUID, req dto.EvaluateAttachmentPolicyRequest) (*model.AttachmentPolicyEvaluation, error) {
	req.Normalize()
	if req.RequestType == "" && req.ServiceCode == "" {
		return nil, validationError("request_type or service_code is required", map[string]string{"request_type": "required_one_of"})
	}
	policy, err := s.repo.FindApplicable(ctx, tenantID, req.RequestType, req.ServiceCode)
	if err != nil {
		if err == pgx.ErrNoRows {
			return &model.AttachmentPolicyEvaluation{
				RequestType:     req.RequestType,
				ServiceCode:     req.ServiceCode,
				MaxAllowedCount: 0,
				ProvidedCount:   req.ProvidedCount,
				CountSatisfied:  true,
				CountExceeded:   false,
				SlotsSatisfied:  true,
				Complete:        true,
				MissingSlots:    []string{},
				EvaluatedAtUnix: s.now().UTC().Unix(),
			}, nil
		}
		return nil, internalError("resolve attachment policy", err)
	}
	return evaluateAttachmentPolicy(policy, req.ProvidedSlots, req.ProvidedCount, s.now().UTC()), nil
}

// evaluateAttachmentPolicy is the pure completeness check (no DB, no time math
// requiring the calendar — it is set/count logic only).
func evaluateAttachmentPolicy(policy *model.AttachmentPolicy, providedSlots []string, providedCount int, now time.Time) *model.AttachmentPolicyEvaluation {
	provided := map[string]bool{}
	for _, slot := range providedSlots {
		provided[strings.ToLower(strings.TrimSpace(slot))] = true
	}
	missing := make([]string, 0)
	for _, slot := range policy.Slots {
		key := strings.ToLower(strings.TrimSpace(slot.Key))
		if slot.Required && !provided[key] {
			missing = append(missing, key)
		}
	}
	sort.Strings(missing)
	countExceeded := policy.MaxAttachmentCount > 0 && providedCount > policy.MaxAttachmentCount
	countSatisfied := providedCount >= policy.MinAttachmentCount && !countExceeded
	slotsSatisfied := len(missing) == 0
	return &model.AttachmentPolicyEvaluation{
		PolicyID:        policy.ID,
		RequestType:     policy.RequestType,
		ServiceCode:     policy.ServiceCode,
		RequiredCount:   policy.MinAttachmentCount,
		MaxAllowedCount: policy.MaxAttachmentCount,
		ProvidedCount:   providedCount,
		CountSatisfied:  countSatisfied,
		CountExceeded:   countExceeded,
		MissingSlots:    missing,
		SlotsSatisfied:  slotsSatisfied,
		Complete:        countSatisfied && slotsSatisfied,
		EvaluatedAtUnix: now.Unix(),
	}
}

func (s *AttachmentPolicyService) emit(ctx context.Context, tenantID, userID uuid.UUID, eventType, action string, payload any) {
	writeEvent(ctx, s.publisher, "lex-service", s.topic, eventType, tenantID, &userID, payload, s.logger)
	if s.audit != nil {
		s.audit.Emit(ctx, LexAuditRecord{
			TenantID:     tenantID,
			ActorUserID:  &userID,
			Action:       action,
			ResourceType: "attachment_policy",
			ResourceID:   resourceIDFromPayload(payload),
			Detail:       map[string]any{"action": action},
		})
	}
}

func validateSlots(slots []dto.AttachmentSlotRequest) error {
	seen := map[string]bool{}
	for _, slot := range slots {
		if slot.Key == "" {
			return validationError("slot key is required", map[string]string{"slots": "key_required"})
		}
		if seen[slot.Key] {
			return validationError("duplicate slot key: "+slot.Key, map[string]string{"slots": "duplicate_key"})
		}
		seen[slot.Key] = true
	}
	return nil
}

func validateAttachmentPolicyCounts(minCount, maxCount int) error {
	fields := map[string]string{}
	if minCount < 0 {
		fields["min_attachment_count"] = "must be non-negative"
	}
	if maxCount < 0 {
		fields["max_attachment_count"] = "must be non-negative"
	}
	if maxCount > 0 && minCount > maxCount {
		fields["max_attachment_count"] = "must be zero/unbounded or greater than or equal to min_attachment_count"
	}
	if len(fields) > 0 {
		return validationError("invalid attachment count policy", fields)
	}
	return nil
}

func dtoSlotsToModel(in []dto.AttachmentSlotRequest) []model.AttachmentSlot {
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

func resourceIDFromPayload(payload any) string {
	switch v := payload.(type) {
	case *model.AttachmentPolicy:
		if v != nil {
			return v.ID.String()
		}
	case map[string]any:
		if id, ok := v["id"].(uuid.UUID); ok {
			return id.String()
		}
		if id, ok := v["id"].(string); ok {
			return id
		}
	}
	return ""
}
