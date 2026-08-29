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
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type caseClassificationStore interface {
	Create(ctx context.Context, q repository.Queryer, c *model.CaseClassification) error
	Update(ctx context.Context, q repository.Queryer, c *model.CaseClassification) error
	RepathDescendants(ctx context.Context, q repository.Queryer, tenantID, id uuid.UUID, newSelfPath []string) error
	Get(ctx context.Context, tenantID, id uuid.UUID) (*model.CaseClassification, error)
	GetByCode(ctx context.Context, tenantID uuid.UUID, code string) (*model.CaseClassification, error)
	List(ctx context.Context, tenantID uuid.UUID, filters model.CaseClassificationListFilters) ([]model.CaseClassification, int, error)
	ListAll(ctx context.Context, tenantID uuid.UUID) ([]model.CaseClassification, error)
	SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error
	HasChildren(ctx context.Context, tenantID, id uuid.UUID) (bool, error)
	Ancestors(ctx context.Context, tenantID, id uuid.UUID) ([]model.CaseClassification, error)
	AppendAudit(ctx context.Context, q repository.Queryer, tenantID, classificationID uuid.UUID, action string, actorID *uuid.UUID, before, after any) error
	Usage(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]int, error)
	ReassignMatters(ctx context.Context, q repository.Queryer, tenantID, source, target uuid.UUID) (int64, error)
	Deactivate(ctx context.Context, q repository.Queryer, tenantID, id uuid.UUID) error
	Activate(ctx context.Context, q repository.Queryer, tenantID, id uuid.UUID) error
	ListAudit(ctx context.Context, tenantID, classificationID uuid.UUID) ([]dto.CaseClassificationAuditEntry, error)
	SiblingIDs(ctx context.Context, tenantID uuid.UUID, parentID *uuid.UUID) (map[uuid.UUID]bool, error)
	ReorderSiblings(ctx context.Context, q repository.Queryer, tenantID uuid.UUID, parentID *uuid.UUID, orderedIDs []uuid.UUID) (int64, error)
}

// CaseClassificationService owns the admin-extensible legal-case classification
// taxonomy (CAP-074/075/076). It maintains the materialized ancestry path on
// writes, projects the flat rows into a nested tree, resolves the root -> leaf
// cascade path, and records every mutation into an append-only governance audit
// log inside the same transaction as the write.
type CaseClassificationService struct {
	db              *pgxpool.Pool
	classifications caseClassificationStore
	publisher       Publisher
	metrics         *metrics.Metrics
	topic           string
	logger          zerolog.Logger
	now             func() time.Time
}

func NewCaseClassificationService(db *pgxpool.Pool, classifications *repository.CaseClassificationRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *CaseClassificationService {
	return &CaseClassificationService{
		db:              db,
		classifications: classifications,
		publisher:       publisherOrNoop(publisher),
		metrics:         appMetrics,
		topic:           topic,
		logger:          logger.With().Str("service", "lex-case-classifications").Logger(),
		now:             time.Now,
	}
}

func (s *CaseClassificationService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateCaseClassificationRequest) (*model.CaseClassification, error) {
	req.Normalize()
	if err := validateCaseClassificationCreate(req); err != nil {
		return nil, err
	}
	path, parentID, err := s.resolvePath(ctx, tenantID, req.ParentID, uuid.Nil)
	if err != nil {
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
	classification := &model.CaseClassification{
		ID:        uuid.New(),
		TenantID:  tenantID,
		ParentID:  parentID,
		Code:      req.Code,
		Name:      req.Name,
		Path:      path,
		IsSystem:  false,
		Active:    active,
		Sort:      sortOrder,
		Metadata:  req.Metadata,
		CreatedBy: userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case classification transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.classifications.Create(ctx, tx, classification); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a case classification with this code already exists")
		}
		return nil, internalError("create case classification", err)
	}
	if err := s.classifications.AppendAudit(ctx, tx, tenantID, classification.ID, "created", &userID, nil, classification); err != nil {
		return nil, internalError("record case classification audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case classification create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case_classification.created", tenantID, &userID, map[string]any{
		"id":        classification.ID,
		"code":      classification.Code,
		"parent_id": classification.ParentID,
	}, s.logger)
	return s.Get(ctx, tenantID, classification.ID)
}

func (s *CaseClassificationService) List(ctx context.Context, tenantID uuid.UUID, filters model.CaseClassificationListFilters) ([]model.CaseClassification, int, error) {
	return s.classifications.List(ctx, tenantID, filters)
}

// Selectable returns the active root classifications used as the canonical
// case-type picker. Nested nodes remain available through Tree/Cascade for
// escalation-path display, but do not compete with root choices on intake.
func (s *CaseClassificationService) Selectable(ctx context.Context, tenantID uuid.UUID, page, perPage int, search string) ([]model.CaseClassification, int, error) {
	active := true
	return s.classifications.List(ctx, tenantID, model.CaseClassificationListFilters{
		Page:       page,
		PerPage:    perPage,
		Active:     &active,
		RootOnly:   true,
		Search:     strings.TrimSpace(search),
		SortColumn: "c.sort",
	})
}

// Tree returns the full taxonomy projected into a nested hierarchy (root nodes
// each carrying their recursively nested Children), ordered by sort then code.
func (s *CaseClassificationService) Tree(ctx context.Context, tenantID uuid.UUID) ([]model.CaseClassification, error) {
	all, err := s.classifications.ListAll(ctx, tenantID)
	if err != nil {
		return nil, internalError("list case classifications", err)
	}
	return buildCaseClassificationTree(all), nil
}

func (s *CaseClassificationService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.CaseClassification, error) {
	classification, err := s.classifications.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case classification not found")
		}
		return nil, internalError("load case classification", err)
	}
	return classification, nil
}

func (s *CaseClassificationService) GetByCode(ctx context.Context, tenantID uuid.UUID, code string) (*model.CaseClassification, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, validationError("code is required", map[string]string{"code": "required"})
	}
	classification, err := s.classifications.GetByCode(ctx, tenantID, code)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case classification not found")
		}
		return nil, internalError("load case classification by code", err)
	}
	return classification, nil
}

// Cascade resolves the root -> leaf chain for a classification (CAP-076): the
// ancestor chain (root-first) followed by the classification itself.
func (s *CaseClassificationService) Cascade(ctx context.Context, tenantID, id uuid.UUID) (*model.CaseClassificationCascade, error) {
	classification, err := s.classifications.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case classification not found")
		}
		return nil, internalError("load case classification", err)
	}
	ancestors, err := s.classifications.Ancestors(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load case classification ancestors", err)
	}
	chain := ancestors
	if len(chain) == 0 {
		chain = []model.CaseClassification{*classification}
	}
	return &model.CaseClassificationCascade{
		ClassificationID: classification.ID,
		Code:             classification.Code,
		Name:             classification.Name,
		ResolvedAt:       s.now().UTC(),
		Chain:            chain,
	}, nil
}

// Usage returns the tenant-scoped count of matters directly referencing each
// classification (direct references only; descendants excluded). Classifications
// with zero matters are omitted.
func (s *CaseClassificationService) Usage(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]int, error) {
	usage, err := s.classifications.Usage(ctx, tenantID)
	if err != nil {
		return nil, internalError("count case classification usage", err)
	}
	return usage, nil
}

// Merge deprecates the source classification and redirects every matter that
// references it to target, all inside a single transaction. The source is
// deactivated (not deleted) and both reassignment and deactivation are recorded
// in the governance audit log.
func (s *CaseClassificationService) Merge(ctx context.Context, tenantID, userID, sourceID, targetID uuid.UUID) (*dto.MergeCaseClassificationResult, error) {
	if targetID == sourceID {
		return nil, validationError("a case classification cannot be merged into itself", map[string]string{"target_id": "invalid"})
	}
	source, err := s.classifications.Get(ctx, tenantID, sourceID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case classification not found")
		}
		return nil, internalError("load source case classification", err)
	}
	if source.IsSystem {
		return nil, conflictError("a system case classification cannot be merged")
	}
	target, err := s.classifications.Get(ctx, tenantID, targetID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, validationError("target case classification not found", map[string]string{"target_id": "not found"})
		}
		return nil, internalError("load target case classification", err)
	}
	if !target.Active {
		return nil, conflictError("the target case classification is not active")
	}
	for _, ancestor := range target.Path {
		if ancestor == sourceID.String() {
			return nil, validationError("the target case classification cannot be a descendant of the source", map[string]string{"target_id": "cycle"})
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case classification merge transaction", err)
	}
	defer tx.Rollback(ctx)

	reassigned, err := s.classifications.ReassignMatters(ctx, tx, tenantID, sourceID, targetID)
	if err != nil {
		return nil, internalError("reassign matters during merge", err)
	}
	if err := s.classifications.Deactivate(ctx, tx, tenantID, sourceID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case classification not found")
		}
		return nil, internalError("deactivate source case classification", err)
	}
	mergeMeta := map[string]any{
		"merged_into": targetID,
		"reassigned":  reassigned,
	}
	if err := s.classifications.AppendAudit(ctx, tx, tenantID, sourceID, "merged", &userID, source, mergeMeta); err != nil {
		return nil, internalError("record case classification merge audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case classification merge", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case_classification.merged", tenantID, &userID, map[string]any{
		"source_id":  sourceID,
		"target_id":  targetID,
		"reassigned": reassigned,
	}, s.logger)
	return &dto.MergeCaseClassificationResult{
		SourceID:          sourceID,
		TargetID:          targetID,
		Reassigned:        reassigned,
		SourceDeactivated: true,
	}, nil
}

// Audit returns the append-only governance audit trail for one classification,
// newest-first. The classification must exist within the tenant so the read is
// tenant-scoped and does not leak ids across tenants.
func (s *CaseClassificationService) Audit(ctx context.Context, tenantID, id uuid.UUID) ([]dto.CaseClassificationAuditEntry, error) {
	if _, err := s.classifications.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case classification not found")
		}
		return nil, internalError("load case classification", err)
	}
	entries, err := s.classifications.ListAudit(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("list case classification audit", err)
	}
	return entries, nil
}

// Reorder atomically re-sequences a sibling set: each id in orderedIDs has its
// sort set to its position. Every id must be a current sibling under parentID
// (tenant-scoped) or the request is rejected before any write occurs.
func (s *CaseClassificationService) Reorder(ctx context.Context, tenantID, userID uuid.UUID, req dto.ReorderCaseClassificationsRequest) (*dto.ReorderCaseClassificationsResult, error) {
	if len(req.OrderedIDs) == 0 {
		return &dto.ReorderCaseClassificationsResult{Updated: 0}, nil
	}
	siblings, err := s.classifications.SiblingIDs(ctx, tenantID, req.ParentID)
	if err != nil {
		return nil, internalError("load case classification siblings", err)
	}
	seen := make(map[uuid.UUID]bool, len(req.OrderedIDs))
	for _, id := range req.OrderedIDs {
		if id == uuid.Nil {
			return nil, validationError("ordered_ids contains an empty id", map[string]string{"ordered_ids": "invalid"})
		}
		if seen[id] {
			return nil, validationError("ordered_ids contains a duplicate id", map[string]string{"ordered_ids": "duplicate"})
		}
		seen[id] = true
		if !siblings[id] {
			return nil, validationError("every id must be a sibling under parent_id", map[string]string{"ordered_ids": "not a sibling"})
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case classification reorder transaction", err)
	}
	defer tx.Rollback(ctx)
	updated, err := s.classifications.ReorderSiblings(ctx, tx, tenantID, req.ParentID, req.OrderedIDs)
	if err != nil {
		return nil, internalError("reorder case classifications", err)
	}
	reorderMeta := map[string]any{
		"parent_id":   req.ParentID,
		"ordered_ids": req.OrderedIDs,
	}
	for _, id := range req.OrderedIDs {
		if err := s.classifications.AppendAudit(ctx, tx, tenantID, id, "reordered", &userID, nil, reorderMeta); err != nil {
			return nil, internalError("record case classification reorder audit", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case classification reorder", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case_classification.reordered", tenantID, &userID, map[string]any{
		"parent_id": req.ParentID,
		"updated":   updated,
	}, s.logger)
	return &dto.ReorderCaseClassificationsResult{Updated: int(updated)}, nil
}

// Bulk activates or deactivates many classifications in one transaction. On
// deactivate, is_system rows are skipped (mirroring delete semantics) and counted
// out of the updated total; rows already in the target state or missing are also
// excluded. Each row actually flipped gets one governance audit entry.
func (s *CaseClassificationService) Bulk(ctx context.Context, tenantID, userID uuid.UUID, req dto.BulkCaseClassificationsRequest) (*dto.BulkCaseClassificationsResult, error) {
	activate := false
	switch req.Action {
	case "activate":
		activate = true
	case "deactivate":
		activate = false
	default:
		return nil, validationError("action must be 'activate' or 'deactivate'", map[string]string{"action": "invalid"})
	}
	if len(req.IDs) == 0 {
		return &dto.BulkCaseClassificationsResult{Updated: 0}, nil
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case classification bulk transaction", err)
	}
	defer tx.Rollback(ctx)

	updated := 0
	seen := make(map[uuid.UUID]bool, len(req.IDs))
	action := "deactivated"
	if activate {
		action = "activated"
	}
	for _, id := range req.IDs {
		if id == uuid.Nil || seen[id] {
			continue
		}
		seen[id] = true
		current, err := s.classifications.Get(ctx, tenantID, id)
		if err != nil {
			if err == pgx.ErrNoRows {
				continue // skip missing/foreign ids silently
			}
			return nil, internalError("load case classification", err)
		}
		if !activate && current.IsSystem {
			continue // a system classification cannot be deactivated
		}
		if current.Active == activate {
			continue // already in the desired state
		}
		if activate {
			err = s.classifications.Activate(ctx, tx, tenantID, id)
		} else {
			err = s.classifications.Deactivate(ctx, tx, tenantID, id)
		}
		if err != nil {
			if err == pgx.ErrNoRows {
				continue
			}
			return nil, internalError("update case classification active flag", err)
		}
		after := *current
		after.Active = activate
		if err := s.classifications.AppendAudit(ctx, tx, tenantID, id, action, &userID, current, &after); err != nil {
			return nil, internalError("record case classification bulk audit", err)
		}
		updated++
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case classification bulk update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case_classification.bulk_"+action, tenantID, &userID, map[string]any{
		"action":  req.Action,
		"updated": updated,
	}, s.logger)
	return &dto.BulkCaseClassificationsResult{Updated: updated}, nil
}

func (s *CaseClassificationService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateCaseClassificationRequest) (*model.CaseClassification, error) {
	req.Normalize()
	classification, err := s.classifications.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case classification not found")
		}
		return nil, internalError("load case classification", err)
	}
	before := *classification

	reparent := false
	if req.ParentID != nil {
		if *req.ParentID == id {
			return nil, validationError("a case classification cannot be its own parent", map[string]string{"parent_id": "invalid"})
		}
		if classification.IsSystem {
			return nil, conflictError("a system case classification cannot be reparented")
		}
		if classification.ParentID == nil || *classification.ParentID != *req.ParentID {
			reparent = true
		}
	}
	applyCaseClassificationUpdate(classification, req)
	if reparent {
		path, parentID, err := s.resolvePath(ctx, tenantID, req.ParentID, id)
		if err != nil {
			return nil, err
		}
		classification.Path = path
		classification.ParentID = parentID
	}
	if err := validateCaseClassification(classification); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case classification update transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.classifications.Update(ctx, tx, classification); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a case classification with this code already exists")
		}
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case classification not found")
		}
		return nil, internalError("update case classification", err)
	}
	if reparent {
		if err := s.classifications.RepathDescendants(ctx, tx, tenantID, id, appendSelfToPath(classification.Path, id)); err != nil {
			return nil, internalError("repath case classification descendants", err)
		}
	}
	if err := s.classifications.AppendAudit(ctx, tx, tenantID, id, "updated", &userID, before, classification); err != nil {
		return nil, internalError("record case classification audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case classification update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case_classification.updated", tenantID, &userID, map[string]any{
		"id":   classification.ID,
		"code": classification.Code,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *CaseClassificationService) Delete(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	classification, err := s.classifications.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case classification not found")
		}
		return internalError("load case classification", err)
	}
	if classification.IsSystem {
		return conflictError("a system case classification cannot be deleted")
	}
	hasChildren, err := s.classifications.HasChildren(ctx, tenantID, id)
	if err != nil {
		return internalError("check case classification children", err)
	}
	if hasChildren {
		return conflictError("cannot delete a case classification that still has child classifications")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start case classification delete transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.softDeleteTx(ctx, tx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case classification not found")
		}
		return internalError("delete case classification", err)
	}
	if err := s.classifications.AppendAudit(ctx, tx, tenantID, id, "deleted", &userID, classification, nil); err != nil {
		return internalError("record case classification audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit case classification delete", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case_classification.deleted", tenantID, &userID, map[string]any{
		"id": id,
	}, s.logger)
	return nil
}

// softDeleteTx soft-deletes inside an open transaction so the delete and its
// audit row commit atomically.
func (s *CaseClassificationService) softDeleteTx(ctx context.Context, tx repository.Queryer, tenantID, id uuid.UUID) error {
	ct, err := tx.Exec(ctx, `UPDATE legal_case_classifications SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// resolvePath materializes the ancestry path for a node whose parent is parentID.
// selfID (uuid.Nil on create) guards against a node parenting itself or one of
// its descendants. The resolved parent must be active so the taxonomy cannot be
// extended under a deactivated branch.
func (s *CaseClassificationService) resolvePath(ctx context.Context, tenantID uuid.UUID, parentID *uuid.UUID, selfID uuid.UUID) ([]string, *uuid.UUID, error) {
	if parentID == nil || *parentID == uuid.Nil {
		return []string{}, nil, nil
	}
	parent, err := s.classifications.Get(ctx, tenantID, *parentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, validationError("parent case classification not found", map[string]string{"parent_id": "not found"})
		}
		return nil, nil, internalError("load parent case classification", err)
	}
	if selfID != uuid.Nil {
		if parent.ID == selfID {
			return nil, nil, validationError("a case classification cannot be its own parent", map[string]string{"parent_id": "invalid"})
		}
		for _, ancestor := range parent.Path {
			if ancestor == selfID.String() {
				return nil, nil, validationError("a case classification cannot be parented to one of its descendants", map[string]string{"parent_id": "cycle"})
			}
		}
	}
	path := make([]string, 0, len(parent.Path)+1)
	path = append(path, parent.Path...)
	path = append(path, parent.ID.String())
	pid := parent.ID
	return path, &pid, nil
}

// buildCaseClassificationTree assembles flat rows into a nested hierarchy. Each
// node is rebuilt from a pointer map so deep branches (e.g. the 4-level
// rental-dispute chain) nest fully; roots are returned ordered by sort then code.
func buildCaseClassificationTree(rows []model.CaseClassification) []model.CaseClassification {
	nodes := make(map[uuid.UUID]*model.CaseClassification, len(rows))
	order := make([]uuid.UUID, 0, len(rows))
	for i := range rows {
		copyRow := rows[i]
		copyRow.Children = nil
		nodes[copyRow.ID] = &copyRow
		order = append(order, copyRow.ID)
	}
	out := make([]model.CaseClassification, 0)
	for _, id := range order {
		node := nodes[id]
		if node.ParentID != nil {
			if _, ok := nodes[*node.ParentID]; ok {
				// Non-root: attached to its parent during recursive materialization.
				continue
			}
		}
		out = append(out, materializeCaseClassificationNode(id, nodes, order))
	}
	sortCaseClassifications(out)
	return out
}

// materializeCaseClassificationNode recursively rebuilds a node and its subtree
// from the pointer map so deep hierarchies (e.g. the 4-level rental-dispute chain)
// are fully nested.
func materializeCaseClassificationNode(id uuid.UUID, nodes map[uuid.UUID]*model.CaseClassification, order []uuid.UUID) model.CaseClassification {
	node := *nodes[id]
	node.Children = nil
	for _, childID := range order {
		child := nodes[childID]
		if child.ParentID != nil && *child.ParentID == id {
			node.Children = append(node.Children, materializeCaseClassificationNode(childID, nodes, order))
		}
	}
	sortCaseClassifications(node.Children)
	return node
}

func sortCaseClassifications(items []model.CaseClassification) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Sort != items[j].Sort {
			return items[i].Sort < items[j].Sort
		}
		return items[i].Code < items[j].Code
	})
}

func validateCaseClassificationCreate(req dto.CreateCaseClassificationRequest) error {
	if req.Code == "" {
		return validationError("code is required", map[string]string{"code": "required"})
	}
	if req.Name.IsEmpty() {
		return validationError("name is required in at least one locale", map[string]string{"name": "required"})
	}
	return nil
}

func validateCaseClassification(c *model.CaseClassification) error {
	if strings.TrimSpace(c.Code) == "" {
		return validationError("code is required", map[string]string{"code": "required"})
	}
	if c.Name.IsEmpty() {
		return validationError("name is required in at least one locale", map[string]string{"name": "required"})
	}
	return nil
}

func applyCaseClassificationUpdate(c *model.CaseClassification, req dto.UpdateCaseClassificationRequest) {
	if req.Code != nil {
		c.Code = strings.ToUpper(strings.TrimSpace(*req.Code))
	}
	if req.Name != nil {
		c.Name = *req.Name
	}
	if req.Active != nil {
		c.Active = *req.Active
	}
	if req.Sort != nil {
		c.Sort = *req.Sort
	}
	if req.Metadata != nil {
		c.Metadata = req.Metadata
	}
}
