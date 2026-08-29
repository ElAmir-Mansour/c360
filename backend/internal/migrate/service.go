package migrate

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/recover/metastore"
)

type tenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
}

type pgxTenantRunner struct{ pool *pgxpool.Pool }

func (r pgxTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r pgxTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

type Service struct {
	tx               tenantRunner
	store            *Store
	entitlements     EntitlementResolver
	metastore        metastore.MetastoreClient
	connectors       ConnectorExecutor
	connectorWebhook ConnectorWebhookConfig
	dr               DRBridge
	approvals        ApprovalWorkflowClient
	logger           zerolog.Logger
	now              func() time.Time
}

type Option func(*Service)

func WithMetastore(client metastore.MetastoreClient) Option {
	return func(s *Service) { s.metastore = client }
}

func WithConnectorExecutor(executor ConnectorExecutor) Option {
	return func(s *Service) { s.connectors = executor }
}

// WithDRBridge wires the seam to the existing DR Runbook Studio + Topology engine.
// Migrate REUSES that engine to generate/execute wave runbooks; without a bridge
// the runbook generation/execution endpoints fail closed with ErrDRBridgeUnavailable.
func WithDRBridge(bridge DRBridge) Option {
	return func(s *Service) { s.dr = bridge }
}

// WithApprovalWorkflowClient wires the Wave-5 H2 seam to the SHARED workflow
// engine so move-group / gate / rollback-plan approvals route through a real
// human-task approval workflow instead of the local DecideMoveGroup status flip
// the audit flagged as a bypass. Without a configured client the approval-request
// path fails closed (503) and only the guarded, audited manual-override remains.
func WithApprovalWorkflowClient(client ApprovalWorkflowClient) Option {
	return func(s *Service) { s.approvals = client }
}

func NewService(pool *pgxpool.Pool, logger zerolog.Logger, entitlements EntitlementResolver, opts ...Option) *Service {
	svc := &Service{
		tx:           pgxTenantRunner{pool: pool},
		store:        NewStore(),
		entitlements: entitlements,
		logger:       logger.With().Str("component", "migrate-service").Logger(),
		now:          func() time.Time { return time.Now().UTC() },
	}
	for _, opt := range opts {
		opt(svc)
	}
	if svc.connectors == nil {
		svc.connectors = NewHTTPConnectorExecutor(EnvironmentSecretResolver{}, 30*time.Second)
	}
	return svc
}

func NewServiceWithDeps(tx tenantRunner, store *Store, logger zerolog.Logger, entitlements EntitlementResolver, opts ...Option) *Service {
	svc := &Service{
		tx:           tx,
		store:        store,
		entitlements: entitlements,
		logger:       logger.With().Str("component", "migrate-service").Logger(),
		now:          func() time.Time { return time.Now().UTC() },
		connectors:   NewHTTPConnectorExecutor(EnvironmentSecretResolver{}, 30*time.Second),
	}
	for _, opt := range opts {
		opt(svc)
	}
	return svc
}

type CreateProgramInput struct {
	Name        string
	Description string
	Owner       string
	Actor       Actor
}

type WorkloadInput struct {
	AppKey               string               `json:"app_key"`
	Name                 string               `json:"name"`
	SourceEnv            string               `json:"source_environment"`
	TargetCloud          string               `json:"target_cloud"`
	TargetAccount        string               `json:"target_account"`
	Strategy             MigrationStrategy    `json:"strategy"`
	OwnerName            string               `json:"owner_name"`
	OwnerContact         string               `json:"owner_contact"`
	Tier                 string               `json:"tier"`
	ReadinessScore       int                  `json:"readiness_score"`
	EstimatedEffortHours float64              `json:"estimated_effort_hours"`
	Dependencies         []WorkloadDependency `json:"dependencies"`
}

type ImportResult struct {
	Imported  int        `json:"imported"`
	Updated   int        `json:"updated"`
	Skipped   int        `json:"skipped"`
	Workloads []Workload `json:"workloads"`
	Errors    []string   `json:"errors,omitempty"`
}

type CreateMoveGroupInput struct {
	ProgramID   uuid.UUID
	Name        string
	Description string
	Constraints string
	AppKeys     []string
	Actor       Actor
}

type CreateWaveInput struct {
	ProgramID              uuid.UUID
	Name                   string
	Description            string
	Sequence               int
	ParentRunbookID        *uuid.UUID
	PlannedDurationSeconds int
	MoveGroupIDs           []uuid.UUID
	Actor                  Actor
}

type CreateWindowInput struct {
	ProgramID   uuid.UUID
	WaveID      uuid.UUID
	Name        string
	WindowType  WindowType
	StartsAt    time.Time
	EndsAt      time.Time
	Constraints string
	Actor       Actor
}

type DecisionInput struct {
	ID              uuid.UUID
	Decision        Decision
	Rationale       string
	ExpectedVersion int
	Actor           Actor
}

func (s *Service) Product(ctx context.Context, tenantID uuid.UUID, authorization string) (*ProductResponse, error) {
	if s.entitlements == nil {
		return nil, ErrEntitlementUnavailable
	}
	active, reason, err := s.entitlements.Resolve(ctx, tenantID.String(), authorization, EntitlementCloudMigration)
	if err != nil {
		return nil, err
	}
	state := "licensed"
	if !active {
		state = "unlicensed"
	}
	caps := []ProductCapability{
		{ID: "portfolio", Label: "Migration portfolio", Description: "Persist workloads, 6R strategy, owners, tiers, dependencies, and readiness.", EntitlementKey: EntitlementCloudMigration, Enabled: active},
		{ID: "move-groups", Label: "Move groups", Description: "Build dependency-aware move groups with completeness checks and approvals.", EntitlementKey: EntitlementCloudMigration, Enabled: active},
		{ID: "waves", Label: "Migration waves", Description: "Sequence approved move groups and compute critical path milestones.", EntitlementKey: EntitlementCloudMigration, Enabled: active},
		{ID: "cutover-windows", Label: "Cutover windows", Description: "Schedule maintenance/off-peak windows with conflict detection and go/no-go decisions.", EntitlementKey: EntitlementCloudMigration, Enabled: active},
		{ID: "readiness-validation", Label: "Readiness and validation", Description: "Gate cutover start and completion behind explicit recorded checks.", EntitlementKey: EntitlementCloudMigration, Enabled: active},
		{ID: "rollback", Label: "Rollback execution", Description: "Require approved rollback plans and validate rollback success criteria.", EntitlementKey: EntitlementCloudMigration, Enabled: active},
		{ID: "integrations", Label: "Migration-service connectors", Description: "Invoke configured HTTP migration/IaC services with idempotency and real error handling.", EntitlementKey: EntitlementCloudMigration, Enabled: active},
		{ID: "evidence", Label: "Audit and evidence", Description: "Append-only migration audit with CSV and PDF evidence export.", EntitlementKey: EntitlementCloudMigration, Enabled: active},
	}
	return &ProductResponse{
		ID:                "migrate",
		Name:              "Clario Migrate",
		EntitlementKey:    EntitlementCloudMigration,
		EntitlementState:  state,
		EntitlementReason: reason,
		Licensed:          active,
		Capabilities:      caps,
	}, nil
}

func (s *Service) CreateProgram(ctx context.Context, tenantID uuid.UUID, in CreateProgramInput) (*Program, error) {
	if !in.Actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	p := &Program{
		TenantID:    tenantID,
		Name:        in.Name,
		Description: in.Description,
		Owner:       in.Owner,
		Status:      ProgramActive,
	}
	if err := p.ValidateForCreate(); err != nil {
		return nil, err
	}
	now := s.now()
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := s.store.CreateProgram(ctx, tx, p, now); err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, p.ID, &in.Actor.UserID, "program.created", &p.ID, "program", "Migration program created", map[string]any{"reference": p.Reference, "name": p.Name}, now)
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("program_id", p.ID.String()).Str("reference", p.Reference).Msg("migrate program created")
	return p, nil
}

func (s *Service) ListPrograms(ctx context.Context, tenantID uuid.UUID, actor Actor, status *ProgramStatus, limit, offset int) ([]Program, int, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, 0, ErrUnauthorized
	}
	var out []Program
	var total int
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, total, err = s.store.ListPrograms(ctx, tx, tenantID, status, limit, offset)
		return err
	})
	return out, total, err
}

func (s *Service) GetProgram(ctx context.Context, tenantID, programID uuid.UUID, actor Actor) (*Program, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var p *Program
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		p, err = s.store.GetProgram(ctx, tx, tenantID, programID)
		return err
	})
	return p, err
}

func (s *Service) UpsertWorkload(ctx context.Context, tenantID, programID uuid.UUID, in WorkloadInput, actor Actor) (*Workload, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	w := workloadFromInput(tenantID, programID, in)
	if err := s.enrichWorkload(ctx, tenantID, &w); err != nil && !errors.Is(err, metastore.ErrNotFound) {
		return nil, err
	}
	if err := w.ValidateForCreate(); err != nil {
		return nil, err
	}
	now := s.now()
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.store.GetProgram(ctx, tx, tenantID, programID); err != nil {
			return err
		}
		if err := s.store.UpsertWorkload(ctx, tx, &w); err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, programID, &actor.UserID, "workload.upserted", &w.ID, "workload", "Workload inventory updated", map[string]any{"app_key": w.AppKey, "strategy": w.Strategy}, now)
	})
	return &w, err
}

func workloadFromInput(tenantID, programID uuid.UUID, in WorkloadInput) Workload {
	return Workload{
		TenantID:             tenantID,
		ProgramID:            programID,
		AppKey:               in.AppKey,
		Name:                 in.Name,
		SourceEnv:            in.SourceEnv,
		TargetCloud:          in.TargetCloud,
		TargetAccount:        in.TargetAccount,
		Strategy:             in.Strategy,
		OwnerName:            in.OwnerName,
		OwnerContact:         in.OwnerContact,
		Tier:                 in.Tier,
		ReadinessScore:       in.ReadinessScore,
		EstimatedEffortHours: in.EstimatedEffortHours,
		Dependencies:         in.Dependencies,
		Status:               WorkloadDiscovered,
	}
}

func (s *Service) enrichWorkload(ctx context.Context, tenantID uuid.UUID, w *Workload) error {
	if s.metastore == nil || strings.TrimSpace(w.AppKey) == "" {
		return nil
	}
	app, err := s.metastore.ResolveApplicationByKey(ctx, tenantID, w.AppKey)
	if err != nil {
		return err
	}
	if w.Name == "" {
		w.Name = app.Name
	}
	if w.Tier == "" {
		w.Tier = app.RecoveryTier
	}
	if len(w.Dependencies) == 0 {
		for _, dep := range app.Dependencies {
			w.Dependencies = append(w.Dependencies, WorkloadDependency{AppKey: dep.DependsOnAppKey, Criticality: dep.Criticality})
		}
	}
	if w.OwnerName == "" && len(app.Owners) > 0 {
		w.OwnerName = app.Owners[0].Name
		w.OwnerContact = app.Owners[0].Contact
	}
	if w.TargetCloud == "" && len(app.CloudAccounts) > 0 {
		w.TargetCloud = app.CloudAccounts[0].Provider
		w.TargetAccount = app.CloudAccounts[0].AccountRef
	}
	if w.SourceEnv == "" && len(app.Environments) > 0 {
		w.SourceEnv = app.Environments[0].Kind
	}
	return nil
}

func (s *Service) ImportWorkloadsCSV(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, r io.Reader) (*ImportResult, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	reader := csv.NewReader(r)
	reader.TrimLeadingSpace = true
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("CSV header: %w", ErrValidation)
	}
	index := map[string]int{}
	for i, col := range header {
		index[strings.ToLower(strings.TrimSpace(col))] = i
	}
	result := &ImportResult{}
	var workloads []Workload
	line := 1
	for {
		line++
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("line %d: %v", line, err))
			result.Skipped++
			continue
		}
		input := WorkloadInput{
			AppKey:               csvValue(record, index, "app_key"),
			Name:                 csvValue(record, index, "name"),
			SourceEnv:            csvValue(record, index, "source_environment"),
			TargetCloud:          csvValue(record, index, "target_cloud"),
			TargetAccount:        csvValue(record, index, "target_account"),
			Strategy:             MigrationStrategy(csvValue(record, index, "strategy")),
			OwnerName:            csvValue(record, index, "owner_name"),
			OwnerContact:         csvValue(record, index, "owner_contact"),
			Tier:                 csvValue(record, index, "tier"),
			Dependencies:         parseDependencies(csvValue(record, index, "dependencies")),
			ReadinessScore:       parseScore(csvValue(record, index, "readiness_score")),
			EstimatedEffortHours: parseEffortHours(csvValue(record, index, "estimated_effort_hours")),
		}
		w := workloadFromInput(tenantID, programID, input)
		if err := s.enrichWorkload(ctx, tenantID, &w); err != nil && !errors.Is(err, metastore.ErrNotFound) {
			return nil, err
		}
		if err := w.ValidateForCreate(); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("line %d: %v", line, err))
			result.Skipped++
			continue
		}
		workloads = append(workloads, w)
	}
	if len(workloads) == 0 && result.Skipped == 0 {
		return nil, fmt.Errorf("CSV contains no workload rows: %w", ErrValidation)
	}
	now := s.now()
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.store.GetProgram(ctx, tx, tenantID, programID); err != nil {
			return err
		}
		for i := range workloads {
			_, existingErr := s.store.GetWorkload(ctx, tx, tenantID, programID, workloads[i].AppKey)
			if err := s.store.UpsertWorkload(ctx, tx, &workloads[i]); err != nil {
				return err
			}
			if errors.Is(existingErr, ErrNotFound) {
				result.Imported++
			} else {
				result.Updated++
			}
			result.Workloads = append(result.Workloads, workloads[i])
		}
		return s.audit(ctx, tx, tenantID, programID, &actor.UserID, "portfolio.imported", &programID, "program", "Workload inventory imported", map[string]any{"imported": result.Imported, "updated": result.Updated, "skipped": result.Skipped}, now)
	})
	return result, err
}

func csvValue(record []string, index map[string]int, name string) string {
	if i, ok := index[name]; ok && i >= 0 && i < len(record) {
		return strings.TrimSpace(record[i])
	}
	return ""
}

func parseScore(raw string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(raw))
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

func parseEffortHours(raw string) float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil || n < 0 {
		return 0
	}
	if n > 100000 {
		return 100000
	}
	return n
}

func parseDependencies(raw string) []WorkloadDependency {
	var out []WorkloadDependency
	for _, part := range strings.Split(raw, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		key, criticality, ok := strings.Cut(part, ":")
		if !ok {
			criticality = "hard"
		}
		key = strings.TrimSpace(key)
		criticality = strings.TrimSpace(criticality)
		if key != "" {
			out = append(out, WorkloadDependency{AppKey: key, Criticality: criticality})
		}
	}
	return out
}

func (s *Service) ListWorkloads(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, query string, status *WorkloadStatus, limit, offset int) ([]Workload, int, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, 0, ErrUnauthorized
	}
	var out []Workload
	var total int
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, total, err = s.store.ListWorkloads(ctx, tx, tenantID, programID, query, status, limit, offset)
		return err
	})
	return out, total, err
}

func (s *Service) CreateMoveGroup(ctx context.Context, tenantID uuid.UUID, in CreateMoveGroupInput) (*MoveGroup, error) {
	if !in.Actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	m := &MoveGroup{
		TenantID:    tenantID,
		ProgramID:   in.ProgramID,
		Name:        strings.TrimSpace(in.Name),
		Description: strings.TrimSpace(in.Description),
		Constraints: strings.TrimSpace(in.Constraints),
		Status:      MoveGroupDraft,
	}
	if m.Name == "" {
		return nil, fmt.Errorf("move group name is required: %w", ErrValidation)
	}
	now := s.now()
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.store.GetProgram(ctx, tx, tenantID, in.ProgramID); err != nil {
			return err
		}
		if err := s.store.CreateMoveGroup(ctx, tx, m, now); err != nil {
			return err
		}
		if err := s.store.AssignWorkloadsToMoveGroup(ctx, tx, tenantID, in.ProgramID, m.ID, in.AppKeys); err != nil {
			return err
		}
		if refreshed, err := s.store.GetMoveGroup(ctx, tx, tenantID, m.ID); err == nil {
			*m = *refreshed
		}
		return s.audit(ctx, tx, tenantID, in.ProgramID, &in.Actor.UserID, "move_group.created", &m.ID, "move_group", "Move group created", map[string]any{"reference": m.Reference, "workloads": len(in.AppKeys)}, now)
	})
	return m, err
}

func (s *Service) ListMoveGroups(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, limit, offset int) ([]MoveGroup, int, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, 0, ErrUnauthorized
	}
	var out []MoveGroup
	var total int
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, total, err = s.store.ListMoveGroups(ctx, tx, tenantID, programID, limit, offset)
		return err
	})
	return out, total, err
}

func (s *Service) SuggestMoveGroup(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, seedAppKeys []string) ([]string, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	seeds := normalizeStrings(seedAppKeys)
	if len(seeds) == 0 {
		return nil, fmt.Errorf("at least one seed app_key is required: %w", ErrValidation)
	}
	var workloads []Workload
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		workloads, _, err = s.store.ListWorkloads(ctx, tx, tenantID, programID, "", nil, 5000, 0)
		return err
	})
	if err != nil {
		return nil, err
	}
	byKey := make(map[string]Workload, len(workloads))
	for _, w := range workloads {
		byKey[w.AppKey] = w
	}
	selected := map[string]struct{}{}
	queue := append([]string(nil), seeds...)
	for len(queue) > 0 {
		key := queue[0]
		queue = queue[1:]
		if _, ok := selected[key]; ok {
			continue
		}
		w, ok := byKey[key]
		if !ok {
			continue
		}
		selected[key] = struct{}{}
		for _, dep := range w.Dependencies {
			if strings.EqualFold(dep.Criticality, "soft") {
				continue
			}
			if _, ok := selected[dep.AppKey]; !ok {
				queue = append(queue, dep.AppKey)
			}
		}
	}
	out := make([]string, 0, len(selected))
	for key := range selected {
		out = append(out, key)
	}
	return normalizeStrings(out), nil
}

func (s *Service) ValidateMoveGroupCompleteness(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor, expectedVersion int) (*MoveGroup, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	now := s.now()
	var group *MoveGroup
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.store.GetMoveGroup(ctx, tx, tenantID, moveGroupID)
		if err != nil {
			return err
		}
		all, _, err := s.store.ListWorkloads(ctx, tx, tenantID, current.ProgramID, "", nil, 5000, 0)
		if err != nil {
			return err
		}
		allKeys := map[string]struct{}{}
		groupKeys := map[string]struct{}{}
		for _, w := range all {
			allKeys[w.AppKey] = struct{}{}
		}
		for _, w := range current.Workloads {
			groupKeys[w.AppKey] = struct{}{}
		}
		var findings []string
		for _, w := range current.Workloads {
			for _, dep := range w.Dependencies {
				if strings.EqualFold(dep.Criticality, "soft") {
					continue
				}
				if _, exists := allKeys[dep.AppKey]; !exists {
					findings = append(findings, fmt.Sprintf("%s depends on unknown hard dependency %s", w.AppKey, dep.AppKey))
					continue
				}
				if _, inGroup := groupKeys[dep.AppKey]; !inGroup {
					findings = append(findings, fmt.Sprintf("%s missing hard dependency %s", w.AppKey, dep.AppKey))
				}
			}
		}
		status := MoveGroupReady
		completeness := "complete"
		if len(findings) > 0 {
			status = MoveGroupCompletenessIssue
			completeness = "blocked"
		}
		group, err = s.store.UpdateMoveGroupCompleteness(ctx, tx, tenantID, moveGroupID, status, completeness, findings, expectedVersion)
		if err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, current.ProgramID, &actor.UserID, "move_group.completeness_checked", &moveGroupID, "move_group", "Move group completeness checked", map[string]any{"status": completeness, "findings": findings}, now)
	})
	return group, err
}

func (s *Service) SubmitMoveGroup(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor, expectedVersion int) (*MoveGroup, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	now := s.now()
	var group *MoveGroup
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.store.GetMoveGroup(ctx, tx, tenantID, moveGroupID)
		if err != nil {
			return err
		}
		if current.Status != MoveGroupReady {
			return ErrCompletenessBlocked
		}
		group, err = s.store.SubmitMoveGroup(ctx, tx, tenantID, moveGroupID, actor.UserID, now, expectedVersion)
		if err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, current.ProgramID, &actor.UserID, "move_group.approval_requested", &moveGroupID, "move_group", "Move group submitted for approval", nil, now); err != nil {
			return err
		}
		// H2: when the shared workflow engine is wired, OPEN a human-task approval
		// workflow instance in the SAME tx and persist the binding. This routes the
		// approval decision through the real engine instead of a local status flip.
		// The group carries its workloads (loaded by GetMoveGroup) so the workflow
		// input variables include the true workload count.
		group.Workloads = current.Workloads
		binding, err := s.requestMoveGroupApproval(ctx, tx, tenantID, group, actor, now)
		if err != nil {
			return err
		}
		if binding != nil {
			if err := s.audit(ctx, tx, tenantID, current.ProgramID, &actor.UserID, "move_group.approval_workflow_started", &moveGroupID, "move_group", "Approval workflow opened in the shared workflow engine", map[string]any{
				"workflow_instance_id":   binding.WorkflowInstanceID,
				"workflow_definition_id": binding.WorkflowDefinitionID,
			}, now); err != nil {
				return err
			}
		}
		// Stage the approval-request event in the SAME tx so migrate-approvers are
		// notified. This routes the approval to the real notification pipeline
		// instead of leaving the request orphaned.
		return s.stageEvent(ctx, tx, tenantID, EventMoveGroupSubmitted, &actor.UserID, MoveGroupEvent{
			ProgramID:     current.ProgramID,
			MoveGroupID:   moveGroupID,
			Reference:     group.Reference,
			Name:          group.Name,
			Status:        string(group.Status),
			SubmittedBy:   actor.UserID.String(),
			WorkloadCount: len(group.Workloads),
		})
	})
	return group, err
}

// DecideMoveGroup is the GUARDED MANUAL-OVERRIDE break-glass path (Wave 5, H2).
//
// It is NO LONGER the default approval mechanism: when the shared workflow engine
// is configured, the decision MUST come from the workflow (SyncMoveGroupApproval /
// the callback), and a direct local flip is REFUSED unless allowOverride is set —
// in which case it is loudly audited as source=manual_override so it can never be
// confused with a real workflow decision. When NO engine is wired at all, a plain
// decision is permitted (the pre-H2 behaviour) so migrate still functions without
// the engine, with the decision audited as source=manual_no_engine.
//
// This closes the Wave-4 audit finding: the local status flip is no longer a
// silent bypass of the shared approval engine.
func (s *Service) DecideMoveGroup(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor, approved bool, rationale string, expectedVersion int, allowOverride bool) (*MoveGroup, error) {
	if !actor.Can(PermMigrateApprove) {
		return nil, ErrUnauthorized
	}
	source := "manual_no_engine"
	if s.ApprovalsConfigured() {
		// The engine is wired: the local flip is a bypass unless explicitly
		// overridden (break-glass). Refuse the default path.
		if !allowOverride {
			return nil, ErrApprovalWorkflowRequired
		}
		// A manual override requires migrate:admin (break-glass privilege), not just
		// migrate:approve — the approve permission is for driving the workflow.
		if !actor.Can(PermMigrateAdmin) {
			return nil, ErrManualOverrideNotAllowed
		}
		source = "manual_override"
	}
	now := s.now()
	var group *MoveGroup
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.store.GetMoveGroup(ctx, tx, tenantID, moveGroupID)
		if err != nil {
			return err
		}
		group, err = s.store.DecideMoveGroup(ctx, tx, tenantID, moveGroupID, actor.UserID, approved, rationale, now, expectedVersion)
		if err != nil {
			return err
		}
		// If a workflow binding was in flight (override case), cancel it so its
		// completion callback cannot later re-drive this now-decided group.
		if source == "manual_override" {
			if b, berr := s.store.GetActiveApprovalBinding(ctx, tx, tenantID, ApprovalSubjectMoveGroup, moveGroupID); berr == nil {
				if _, ferr := s.store.FailApprovalBinding(ctx, tx, tenantID, b.ID, ApprovalBindingCancelled, "superseded by manual override", now); ferr != nil {
					return ferr
				}
			} else if !errors.Is(berr, ErrApprovalNotStarted) {
				return berr
			}
		}
		if err := s.audit(ctx, tx, tenantID, current.ProgramID, &actor.UserID, "move_group.approval_decided", &moveGroupID, "move_group", "Move group approval decided (manual override)", map[string]any{"approved": approved, "rationale": rationale, "source": source}, now); err != nil {
			return err
		}
		// Stage the decision event in the SAME tx (audit trail + real-time UI +
		// stakeholder notification).
		decided := approved
		return s.stageEvent(ctx, tx, tenantID, EventMoveGroupDecided, &actor.UserID, MoveGroupEvent{
			ProgramID:   current.ProgramID,
			MoveGroupID: moveGroupID,
			Reference:   group.Reference,
			Name:        group.Name,
			Status:      string(group.Status),
			DecidedBy:   actor.UserID.String(),
			Approved:    &decided,
			Rationale:   rationale,
		})
	})
	return group, err
}

func (s *Service) CreateWave(ctx context.Context, tenantID uuid.UUID, in CreateWaveInput) (*Wave, error) {
	if !in.Actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	if in.Sequence <= 0 {
		return nil, fmt.Errorf("wave sequence must be positive: %w", ErrValidation)
	}
	w := &Wave{
		TenantID:               tenantID,
		ProgramID:              in.ProgramID,
		Name:                   strings.TrimSpace(in.Name),
		Description:            strings.TrimSpace(in.Description),
		Sequence:               in.Sequence,
		Status:                 WavePlanned,
		ParentRunbookID:        in.ParentRunbookID,
		PlannedDurationSeconds: in.PlannedDurationSeconds,
	}
	if w.Name == "" {
		return nil, fmt.Errorf("wave name is required: %w", ErrValidation)
	}
	now := s.now()
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.store.GetProgram(ctx, tx, tenantID, in.ProgramID); err != nil {
			return err
		}
		for _, groupID := range in.MoveGroupIDs {
			group, err := s.store.GetMoveGroup(ctx, tx, tenantID, groupID)
			if err != nil {
				return err
			}
			if group.ProgramID != in.ProgramID || group.Status != MoveGroupApproved {
				return ErrApprovalRequired
			}
		}
		if err := s.store.CreateWave(ctx, tx, w, now); err != nil {
			return err
		}
		if err := s.store.AssignMoveGroupsToWave(ctx, tx, tenantID, w.ID, in.MoveGroupIDs, in.PlannedDurationSeconds); err != nil {
			return err
		}
		refreshed, err := s.store.GetWave(ctx, tx, tenantID, w.ID)
		if err != nil {
			return err
		}
		*w = *refreshed
		return s.audit(ctx, tx, tenantID, in.ProgramID, &in.Actor.UserID, "wave.created", &w.ID, "wave", "Migration wave created", map[string]any{"reference": w.Reference, "sequence": w.Sequence}, now)
	})
	return w, err
}

func (s *Service) ListWaves(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, limit, offset int) ([]Wave, int, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, 0, ErrUnauthorized
	}
	var out []Wave
	var total int
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, total, err = s.store.ListWaves(ctx, tx, tenantID, programID, limit, offset)
		return err
	})
	return out, total, err
}

func (s *Service) GetWave(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*Wave, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var w *Wave
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		w, err = s.store.GetWave(ctx, tx, tenantID, waveID)
		return err
	})
	return w, err
}

func (s *Service) CriticalPathForWave(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*CriticalPath, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var wave *Wave
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		wave, err = s.store.GetWave(ctx, tx, tenantID, waveID)
		return err
	})
	if err != nil {
		return nil, err
	}
	cp := computeWaveCriticalPath(*wave)
	return &cp, nil
}

// TransitionWorkload moves a single workload through one legal step of its
// lifecycle state machine. The caller supplies the target status and the
// expected row version for optimistic concurrency; the transition is rejected
// unless it is permitted by WorkloadTransitionTable. Every transition is
// recorded in the append-only audit log.
func (s *Service) TransitionWorkload(ctx context.Context, tenantID, workloadID uuid.UUID, to WorkloadStatus, expectedVersion int, reason string, actor Actor) (*Workload, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	if !to.Valid() {
		return nil, ErrInvalidStatus
	}
	reason = strings.TrimSpace(reason)
	now := s.now()
	var out *Workload
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.store.GetWorkloadByID(ctx, tx, tenantID, workloadID)
		if err != nil {
			return err
		}
		if err := ValidateWorkloadTransition(current.Status, to); err != nil {
			return err
		}
		if expectedVersion > 0 && current.RowVersion != expectedVersion {
			return ErrVersionConflict
		}
		updated, err := s.store.TransitionWorkload(ctx, tx, tenantID, workloadID, current.Status, to, current.RowVersion)
		if err != nil {
			return err
		}
		out = updated
		detail := map[string]any{"app_key": updated.AppKey, "from": current.Status, "to": to}
		if reason != "" {
			detail["reason"] = reason
		}
		return s.audit(ctx, tx, tenantID, updated.ProgramID, &actor.UserID, "workload.transitioned", &updated.ID, "workload",
			fmt.Sprintf("Workload %s moved %s -> %s", updated.AppKey, current.Status, to), detail, now)
	})
	return out, err
}

// workloadCutoverChains maps a lifecycle event to the ordered target states a
// member workload should advance through. Each hop is validated individually by
// the state machine, so workloads in different starting states converge safely
// without skipping illegal transitions.
var workloadCutoverChains = map[string][]WorkloadStatus{
	"start":    {WorkloadInMigration, WorkloadCutover},
	"complete": {WorkloadValidated, WorkloadLive},
	"rollback": {WorkloadRolledBack},
}

// advanceWaveWorkloads drives every workload in a wave toward the terminal
// state for a cutover lifecycle event, applying only the legal single-hop
// transitions from each workload's current state. It returns the number of
// individual hops applied. This is what makes the validated/live/rolled_back
// states reachable through real cutover code paths instead of leaving every
// workload pinned at "discovered".
func (s *Service) advanceWaveWorkloads(ctx context.Context, tx DBTX, tenantID, programID, waveID uuid.UUID, event string, actorID uuid.UUID, at time.Time) (int, error) {
	chain := workloadCutoverChains[event]
	if len(chain) == 0 {
		return 0, nil
	}
	target := chain[len(chain)-1]
	workloads, err := s.store.ListWorkloadsForWave(ctx, tx, tenantID, waveID)
	if err != nil {
		return 0, err
	}
	hops := 0
	for _, wl := range workloads {
		cur := wl
		// Apply each legal hop until the workload reaches the target state for
		// this event. We re-read the version from the returned row each hop.
		for cur.Status != target {
			next, ok := nextHopToward(cur.Status, target)
			if !ok {
				break // no legal path (e.g. already decommissioned/rolled_back); leave as-is
			}
			updated, err := s.store.TransitionWorkload(ctx, tx, tenantID, cur.ID, cur.Status, next, cur.RowVersion)
			if err != nil {
				if errors.Is(err, ErrVersionConflict) {
					// Concurrent change to this workload; skip it rather than
					// failing the whole cutover. The transition route remains
					// the authoritative path for that workload.
					break
				}
				return hops, err
			}
			hops++
			if err := s.audit(ctx, tx, tenantID, programID, &actorID, "workload.transitioned", &updated.ID, "workload",
				fmt.Sprintf("Workload %s moved %s -> %s (cutover %s)", updated.AppKey, cur.Status, next, event),
				map[string]any{"app_key": updated.AppKey, "from": cur.Status, "to": next, "event": event, "wave_id": waveID}, at); err != nil {
				return hops, err
			}
			cur = *updated
		}
	}
	return hops, nil
}

// nextHopToward returns the next legal workload status on the shortest forward
// path from `from` toward `target` within the lifecycle DAG, or ok=false when
// no such hop exists. It performs a breadth-first search over the real
// WorkloadTransitionTable so ordering is always state-machine-legal.
func nextHopToward(from, target WorkloadStatus) (WorkloadStatus, bool) {
	if from == target {
		return from, true
	}
	type item struct {
		node  WorkloadStatus
		first WorkloadStatus
		depth int
	}
	visited := map[WorkloadStatus]bool{from: true}
	queue := []item{}
	for _, n := range WorkloadTransitionTable[from] {
		if !visited[n] {
			visited[n] = true
			queue = append(queue, item{node: n, first: n, depth: 1})
		}
	}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur.node == target {
			return cur.first, true
		}
		for _, n := range WorkloadTransitionTable[cur.node] {
			if !visited[n] {
				visited[n] = true
				queue = append(queue, item{node: n, first: cur.first, depth: cur.depth + 1})
			}
		}
	}
	return "", false
}

func (s *Service) CreateWindow(ctx context.Context, tenantID uuid.UUID, in CreateWindowInput) (*CutoverWindow, []CutoverWindow, error) {
	if !in.Actor.Can(PermMigratePlan) {
		return nil, nil, ErrUnauthorized
	}
	if !in.WindowType.Valid() {
		return nil, nil, fmt.Errorf("invalid window_type: %w", ErrValidation)
	}
	if !in.EndsAt.After(in.StartsAt) {
		return nil, nil, fmt.Errorf("ends_at must be after starts_at: %w", ErrValidation)
	}
	w := &CutoverWindow{
		TenantID:    tenantID,
		ProgramID:   in.ProgramID,
		WaveID:      in.WaveID,
		Name:        strings.TrimSpace(in.Name),
		WindowType:  in.WindowType,
		StartsAt:    in.StartsAt,
		EndsAt:      in.EndsAt,
		Constraints: strings.TrimSpace(in.Constraints),
	}
	if w.Name == "" {
		return nil, nil, fmt.Errorf("window name is required: %w", ErrValidation)
	}
	now := s.now()
	var conflicts []CutoverWindow
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.store.GetProgram(ctx, tx, tenantID, in.ProgramID); err != nil {
			return err
		}
		if _, err := s.store.GetWave(ctx, tx, tenantID, in.WaveID); err != nil {
			return err
		}
		var err error
		conflicts, err = s.store.WindowConflicts(ctx, tx, tenantID, in.ProgramID, uuid.Nil, in.StartsAt, in.EndsAt)
		if err != nil {
			return err
		}
		if len(conflicts) > 0 {
			return ErrWindowConflict
		}
		if err := s.store.CreateWindow(ctx, tx, w, now); err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, in.ProgramID, &in.Actor.UserID, "cutover_window.created", &w.ID, "cutover_window", "Cutover window scheduled", map[string]any{"reference": w.Reference, "starts_at": w.StartsAt, "ends_at": w.EndsAt}, now)
	})
	return w, conflicts, err
}

func (s *Service) ListWindows(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, limit, offset int) ([]CutoverWindow, int, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, 0, ErrUnauthorized
	}
	var out []CutoverWindow
	var total int
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, total, err = s.store.ListWindows(ctx, tx, tenantID, programID, limit, offset)
		return err
	})
	return out, total, err
}

func (s *Service) DecideGoNoGo(ctx context.Context, tenantID uuid.UUID, in DecisionInput) (*CutoverWindow, error) {
	if !in.Actor.Can(PermMigrateCutover) && !in.Actor.Can(PermMigrateApprove) {
		return nil, ErrUnauthorized
	}
	if in.Decision != DecisionGo && in.Decision != DecisionNoGo {
		return nil, fmt.Errorf("decision must be go or no_go: %w", ErrValidation)
	}
	now := s.now()
	var window *CutoverWindow
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.store.GetWindow(ctx, tx, tenantID, in.ID)
		if err != nil {
			return err
		}
		window, err = s.store.DecideWindow(ctx, tx, tenantID, in.ID, in.Actor.UserID, in.Decision, in.Rationale, now, in.ExpectedVersion)
		if err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, current.ProgramID, &in.Actor.UserID, "cutover.gonogo_decided", &in.ID, "cutover_window", "Go/no-go decision recorded", map[string]any{"decision": in.Decision, "rationale": in.Rationale}, now); err != nil {
			return err
		}
		// Stage the go/no-go gate decision in the SAME tx so cutover executors are
		// notified of the decision on the window.
		return s.stageEvent(ctx, tx, tenantID, EventGateDecided, actorPtr(in.Actor.UserID), GateEvent{
			ProgramID: current.ProgramID,
			WaveID:    window.WaveID,
			WindowID:  in.ID,
			Reference: window.Reference,
			Decision:  string(in.Decision),
			Rationale: in.Rationale,
			DecidedBy: in.Actor.UserID.String(),
		})
	})
	return window, err
}

func (s *Service) StartCutover(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*CutoverWindow, error) {
	if !actor.Can(PermMigrateCutover) {
		return nil, ErrUnauthorized
	}
	now := s.now()
	var window *CutoverWindow
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		if window.Decision != DecisionGo {
			return ErrGoNoGoRequired
		}
		plan, err := s.store.GetRollbackPlanForWindow(ctx, tx, tenantID, windowID)
		if err != nil || plan.Decision != DecisionApproved {
			return ErrRollbackPlanRequired
		}
		readinessKind := CheckReadiness
		checks, err := s.store.ListGateChecks(ctx, tx, tenantID, windowID, &readinessKind)
		if err != nil {
			return err
		}
		if requiredChecksBlock(checks) {
			return ErrReadinessBlocked
		}
		wave, err := s.store.GetWave(ctx, tx, tenantID, window.WaveID)
		if err != nil {
			return err
		}
		if _, err := s.store.UpdateWaveStatus(ctx, tx, tenantID, wave.ID, wave.Status, WaveInProgress, wave.RowVersion, now); err != nil && !errors.Is(err, ErrVersionConflict) {
			return err
		}
		// Drive member workloads into the migration/cutover phase. This is the
		// real lifecycle progression: planned -> in_migration -> cutover.
		if _, err := s.advanceWaveWorkloads(ctx, tx, tenantID, window.ProgramID, wave.ID, "start", actor.UserID, now); err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, window.ProgramID, &actor.UserID, "cutover.started", &windowID, "cutover_window", "Cutover started after readiness and rollback gates passed", nil, now); err != nil {
			return err
		}
		// Wave/cutover started (gate-passed, non-DR-bridge path). Stage the event in
		// the SAME tx as the wave -> in_progress transition + workload advance.
		return s.stageEvent(ctx, tx, tenantID, EventCutoverStarted, &actor.UserID, CutoverEvent{
			ProgramID: window.ProgramID,
			WaveID:    window.WaveID,
			WindowID:  windowID,
			Reference: window.Reference,
			ActorID:   actor.UserID.String(),
		})
	})
	return window, err
}

func (s *Service) CompleteCutover(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*CutoverWindow, error) {
	if !actor.Can(PermMigrateCutover) {
		return nil, ErrUnauthorized
	}
	now := s.now()
	var window *CutoverWindow
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		validationKind := CheckValidation
		checks, err := s.store.ListGateChecks(ctx, tx, tenantID, windowID, &validationKind)
		if err != nil {
			return err
		}
		if requiredChecksBlock(checks) {
			return ErrValidationBlocked
		}
		wave, err := s.store.GetWave(ctx, tx, tenantID, window.WaveID)
		if err != nil {
			return err
		}
		if _, err := s.store.UpdateWaveStatus(ctx, tx, tenantID, wave.ID, wave.Status, WaveCompleted, wave.RowVersion, now); err != nil && !errors.Is(err, ErrVersionConflict) {
			return err
		}
		// Validation gates passed: advance member workloads to their live
		// state (cutover -> validated -> live), so they are no longer pinned to
		// an in-progress status once the wave completes successfully.
		if _, err := s.advanceWaveWorkloads(ctx, tx, tenantID, window.ProgramID, wave.ID, "complete", actor.UserID, now); err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, window.ProgramID, &actor.UserID, "cutover.completed", &windowID, "cutover_window", "Cutover completed after validation gates passed", nil, now); err != nil {
			return err
		}
		// Cutover completed (workloads live) via the non-DR-bridge gate path. Stage
		// the completion event in the SAME tx as the wave -> completed transition.
		return s.stageEvent(ctx, tx, tenantID, EventCutoverCompleted, &actor.UserID, CutoverEvent{
			ProgramID: window.ProgramID,
			WaveID:    window.WaveID,
			WindowID:  windowID,
			Reference: window.Reference,
			ActorID:   actor.UserID.String(),
		})
	})
	return window, err
}

// RollbackCutover reverses an in-flight cutover. It requires a recorded,
// passing rollback_success gate check for the window (the honest signal that
// the rollback procedure actually succeeded), then transitions the wave and all
// of its member workloads to the rolled_back state. This makes the rolled_back
// states reachable through a real, gated code path.
func (s *Service) RollbackCutover(ctx context.Context, tenantID, windowID uuid.UUID, reason string, actor Actor) (*CutoverWindow, error) {
	if !actor.Can(PermMigrateRollback) {
		return nil, ErrUnauthorized
	}
	reason = strings.TrimSpace(reason)
	now := s.now()
	var window *CutoverWindow
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		plan, err := s.store.GetRollbackPlanForWindow(ctx, tx, tenantID, windowID)
		if err != nil || plan.Decision != DecisionApproved {
			return ErrRollbackPlanRequired
		}
		rollbackKind := CheckRollbackSuccess
		checks, err := s.store.ListGateChecks(ctx, tx, tenantID, windowID, &rollbackKind)
		if err != nil {
			return err
		}
		if requiredChecksBlock(checks) {
			return ErrValidationBlocked
		}
		wave, err := s.store.GetWave(ctx, tx, tenantID, window.WaveID)
		if err != nil {
			return err
		}
		if _, err := s.store.UpdateWaveStatus(ctx, tx, tenantID, wave.ID, wave.Status, WaveRolledBack, wave.RowVersion, now); err != nil && !errors.Is(err, ErrVersionConflict) {
			return err
		}
		if _, err := s.advanceWaveWorkloads(ctx, tx, tenantID, window.ProgramID, wave.ID, "rollback", actor.UserID, now); err != nil {
			return err
		}
		detail := map[string]any{"wave_id": wave.ID}
		if reason != "" {
			detail["reason"] = reason
		}
		if err := s.audit(ctx, tx, tenantID, window.ProgramID, &actor.UserID, "cutover.rolled_back", &windowID, "cutover_window", "Cutover rolled back after rollback-success gate passed", detail, now); err != nil {
			return err
		}
		// Rollback executed (wave + workloads rolled back) via the non-DR-bridge
		// gate path. Stage the completion event in the SAME tx as the terminal
		// state change.
		return s.stageEvent(ctx, tx, tenantID, EventRollbackCompleted, &actor.UserID, RollbackEvent{
			ProgramID:   window.ProgramID,
			WaveID:      wave.ID,
			WindowID:    windowID,
			Reference:   window.Reference,
			Reason:      reason,
			TriggeredBy: actor.UserID.String(),
		})
	})
	return window, err
}

func requiredChecksBlock(checks []GateCheck) bool {
	requiredCount := 0
	for _, check := range checks {
		if !check.Required {
			continue
		}
		requiredCount++
		if check.Status != CheckPassed && check.Status != CheckOverridden {
			return true
		}
	}
	return requiredCount == 0
}

func (s *Service) UpsertRollbackPlan(ctx context.Context, tenantID uuid.UUID, plan RollbackPlan, actor Actor) (*RollbackPlan, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	plan.TenantID = tenantID
	plan.Strategy = strings.TrimSpace(plan.Strategy)
	plan.Procedures = strings.TrimSpace(plan.Procedures)
	plan.SuccessCriteria = strings.TrimSpace(plan.SuccessCriteria)
	if plan.WindowID == uuid.Nil || plan.Strategy == "" || plan.Procedures == "" || plan.SuccessCriteria == "" {
		return nil, fmt.Errorf("window_id, strategy, procedures, and success_criteria are required: %w", ErrValidation)
	}
	now := s.now()
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		window, err := s.store.GetWindow(ctx, tx, tenantID, plan.WindowID)
		if err != nil {
			return err
		}
		plan.ProgramID = window.ProgramID
		if err := s.store.UpsertRollbackPlan(ctx, tx, &plan); err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, plan.ProgramID, &actor.UserID, "rollback_plan.upserted", &plan.ID, "rollback_plan", "Rollback plan saved", map[string]any{"strategy": plan.Strategy}, now)
	})
	return &plan, err
}

func (s *Service) GetRollbackPlan(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*RollbackPlan, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var plan *RollbackPlan
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		plan, err = s.store.GetRollbackPlanForWindow(ctx, tx, tenantID, windowID)
		if errors.Is(err, ErrNotFound) {
			plan = nil
			return nil
		}
		return err
	})
	return plan, err
}

func (s *Service) DecideRollbackPlan(ctx context.Context, tenantID uuid.UUID, in DecisionInput) (*RollbackPlan, error) {
	if !in.Actor.Can(PermMigrateRollback) && !in.Actor.Can(PermMigrateApprove) {
		return nil, ErrUnauthorized
	}
	if in.Decision != DecisionApproved && in.Decision != DecisionRejected {
		return nil, fmt.Errorf("rollback decision must be approved or rejected: %w", ErrValidation)
	}
	now := s.now()
	var plan *RollbackPlan
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		plan, err = s.store.DecideRollbackPlan(ctx, tx, tenantID, in.ID, in.Actor.UserID, in.Decision, in.Rationale, now, in.ExpectedVersion)
		if err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, plan.ProgramID, &in.Actor.UserID, "rollback_plan.decided", &plan.ID, "rollback_plan", "Rollback plan decision recorded", map[string]any{"decision": in.Decision, "rationale": in.Rationale}, now)
	})
	return plan, err
}

func (s *Service) CreateGateCheck(ctx context.Context, tenantID uuid.UUID, check GateCheck, actor Actor) (*GateCheck, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	check.TenantID = tenantID
	check.Name = strings.TrimSpace(check.Name)
	if check.WindowID == uuid.Nil || !check.Kind.Valid() || check.Name == "" {
		return nil, fmt.Errorf("window_id, kind, and name are required: %w", ErrValidation)
	}
	if check.Status == "" {
		check.Status = CheckPending
	}
	if !check.Status.Valid() {
		return nil, ErrInvalidStatus
	}
	now := s.now()
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		window, err := s.store.GetWindow(ctx, tx, tenantID, check.WindowID)
		if err != nil {
			return err
		}
		check.ProgramID = window.ProgramID
		if err := s.store.CreateGateCheck(ctx, tx, &check); err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, check.ProgramID, &actor.UserID, "gate_check.created", &check.ID, "gate_check", "Migration gate check created", map[string]any{"kind": check.Kind, "name": check.Name}, now)
	})
	return &check, err
}

func (s *Service) ListGateChecks(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor, kind *CheckKind) ([]GateCheck, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	if kind != nil && !kind.Valid() {
		return nil, ErrInvalidStatus
	}
	var checks []GateCheck
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		checks, err = s.store.ListGateChecks(ctx, tx, tenantID, windowID, kind)
		return err
	})
	return checks, err
}

func (s *Service) RecordGateCheck(ctx context.Context, tenantID, checkID uuid.UUID, actor Actor, status CheckStatus, evidence, result string) (*GateCheck, error) {
	if !actor.Can(PermMigrateCutover) && !actor.Can(PermMigrateApprove) {
		return nil, ErrUnauthorized
	}
	if !status.Valid() {
		return nil, ErrInvalidStatus
	}
	now := s.now()
	var check *GateCheck
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		check, err = s.store.RecordGateCheck(ctx, tx, tenantID, checkID, actor.UserID, status, strings.TrimSpace(evidence), strings.TrimSpace(result), now)
		if err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, check.ProgramID, &actor.UserID, "gate_check.recorded", &check.ID, "gate_check", "Migration gate check result recorded", map[string]any{"kind": check.Kind, "status": check.Status}, now)
	})
	return check, err
}

func (s *Service) CommandCenter(ctx context.Context, tenantID, programID uuid.UUID, actor Actor) (*CommandCenter, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var out CommandCenter
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		agg, err := s.loadProgramAggregate(ctx, tx, tenantID, programID)
		if err != nil {
			return err
		}
		out.Program = agg.program
		out.Summary = agg.summary
		out.Waves = agg.waves
		out.WaveStatuses = agg.waveStatuses
		out.VarianceSeconds = agg.varianceSeconds
		out.ReadinessBlockers = agg.blockers

		if out.MoveGroups, _, err = s.store.ListMoveGroups(ctx, tx, tenantID, programID, 50, 0); err != nil {
			return err
		}
		if out.UpcomingWindows, _, err = s.store.ListWindows(ctx, tx, tenantID, programID, 20, 0); err != nil {
			return err
		}
		if len(out.Waves) > 0 {
			out.CriticalPath = computeWaveCriticalPath(out.Waves[0])
		}
		out.RecentAudit, err = s.store.RecentAudit(ctx, tx, tenantID, programID, 25)
		return err
	})
	return &out, err
}

// programAggregate is the shared, batch-loaded projection of a program used by both
// the command center and the exec status summary. Loading it once (with the
// batched HydrateWaves + single blocker/run-status queries) means there is NO
// per-wave GetWave N+1 and no per-window gate-check loop.
type programAggregate struct {
	program         Program
	summary         PortfolioSummary
	waves           []Wave
	waveStatuses    []WaveStatusView
	blockers        []GateCheck
	varianceSeconds int
}

// loadProgramAggregate batch-loads a program's portfolio summary, waves (hydrated
// with their move groups + workloads in a bounded number of queries), per-wave
// status rollups (with live run status), the open readiness blockers, and the
// program-level schedule variance. It must run inside a read tenant transaction.
func (s *Service) loadProgramAggregate(ctx context.Context, tx DBTX, tenantID, programID uuid.UUID) (*programAggregate, error) {
	program, err := s.store.GetProgram(ctx, tx, tenantID, programID)
	if err != nil {
		return nil, err
	}
	agg := &programAggregate{program: *program}
	if agg.summary, err = s.store.PortfolioSummary(ctx, tx, tenantID, programID); err != nil {
		return nil, err
	}
	if agg.waves, _, err = s.store.ListWaves(ctx, tx, tenantID, programID, 50, 0); err != nil {
		return nil, err
	}
	// Batch-hydrate every wave's move groups + workloads in a bounded number of
	// queries instead of a per-wave GetWave round-trip (the fixed N+1).
	if err := s.store.HydrateWaves(ctx, tx, tenantID, agg.waves); err != nil {
		return nil, err
	}
	// One query for the live run status per wave.
	runStatuses, err := s.store.WaveRunStatuses(ctx, tx, tenantID, programID)
	if err != nil {
		return nil, err
	}
	// One query for the open readiness blockers across all of the program's windows.
	if agg.blockers, err = s.store.ListReadinessBlockersForProgram(ctx, tx, tenantID, programID); err != nil {
		return nil, err
	}
	agg.waveStatuses = make([]WaveStatusView, 0, len(agg.waves))
	for _, wave := range agg.waves {
		view := WaveStatusView{
			WaveID:                 wave.ID,
			Reference:              wave.Reference,
			Name:                   wave.Name,
			Sequence:               wave.Sequence,
			Status:                 wave.Status,
			CompletionPercent:      waveCompletionPercent(wave.Status),
			PlannedDurationSeconds: wave.PlannedDurationSeconds,
			ActualDurationSeconds:  wave.ActualDurationSeconds,
		}
		if wave.ActualDurationSeconds != nil {
			view.VarianceSeconds = *wave.ActualDurationSeconds - wave.PlannedDurationSeconds
			agg.varianceSeconds += view.VarianceSeconds
		}
		if snap, ok := runStatuses[wave.ID]; ok {
			view.RunStatus = snap.Status
			view.RunStartedAt = snap.StartedAt
		}
		agg.waveStatuses = append(agg.waveStatuses, view)
	}
	return agg, nil
}

// ProgramStatusSummary returns a concise, read-only executive/stakeholder status
// view of a migration program (waves + %complete, blockers, current run, variance).
// It projects the SAME batch-loaded aggregate the command center uses — no
// separate data path and no N+1 — and is gated on migrate:read.
func (s *Service) ProgramStatusSummary(ctx context.Context, tenantID, programID uuid.UUID, actor Actor) (*ProgramStatusSummary, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var out ProgramStatusSummary
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		agg, err := s.loadProgramAggregate(ctx, tx, tenantID, programID)
		if err != nil {
			return err
		}
		out.Program = agg.program
		out.TotalWorkloads = agg.summary.TotalWorkloads
		out.ReadinessAverage = agg.summary.ReadinessAverage
		out.WaveCount = len(agg.waves)
		out.VarianceSeconds = agg.varianceSeconds
		out.Waves = agg.waveStatuses
		out.Blockers = agg.blockers
		out.BlockerCount = len(agg.blockers)

		total := 0
		for i := range agg.waveStatuses {
			view := agg.waveStatuses[i]
			total += view.CompletionPercent
			if view.Status == WaveCompleted {
				out.CompletedWaves++
			}
			// The current run is the first wave whose live run is still running.
			if out.CurrentRun == nil && view.RunStatus == DRRunStatusRunning {
				running := view
				out.CurrentRun = &running
			}
		}
		if len(agg.waveStatuses) > 0 {
			out.OverallPercent = total / len(agg.waveStatuses)
		}
		return nil
	})
	return &out, err
}

func (s *Service) audit(ctx context.Context, tx DBTX, tenantID, programID uuid.UUID, actorID *uuid.UUID, action string, subjectID *uuid.UUID, subjectType, summary string, detail map[string]any, at time.Time) error {
	if detail == nil {
		detail = map[string]any{}
	}
	return s.store.AppendAudit(ctx, tx, &AuditEvent{
		TenantID:    tenantID,
		ProgramID:   programID,
		ActorID:     actorID,
		Action:      action,
		SubjectID:   subjectID,
		SubjectType: subjectType,
		Summary:     summary,
		Detail:      detail,
		OccurredAt:  at,
	})
}
