// Package service implements licensing decisions and lifecycle. Every state
// change runs in one transaction with its outbox event, so the license
// record and the platform's event history can never disagree (Solution
// Architecture E2E, slides 18 and 40).
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/license/model"
	"github.com/clario360/platform/internal/license/repository"
)

const eventSource = "license-service"

const (
	entitlementsChangedEventType = "license.entitlements_changed"

	entitlementsChangeLicenseAssigned         = "license_assigned"
	entitlementsChangeLicenseSuspended        = "license_suspended"
	entitlementsChangeLicenseResumed          = "license_resumed"
	entitlementsChangeOverrideSet             = "override_set"
	entitlementsChangeOverrideRemoved         = "override_removed"
	entitlementsChangePlanEntitlements        = "plan_entitlements_updated"
	entitlementsChangeOfflineLicenseActivated = "offline_license_activated"
)

// SeatsKey is the reserved entitlement key for seat licensing. It aliases the
// canonical key in the model package (the single source of truth) so existing
// service.SeatsKey references keep working.
const SeatsKey = model.SeatsKey

// repo abstracts the repository for tests.
type repo interface {
	CreatePlan(ctx context.Context, db repository.DBTX, plan *model.Plan) error
	GetPlanByKey(ctx context.Context, db repository.DBTX, key string) (*model.Plan, error)
	ListCatalogPlans(ctx context.Context, db repository.DBTX) ([]*model.Plan, error)
	ListTenantIDsByPlanKey(ctx context.Context, db repository.DBTX, key string) ([]string, error)
	UpdatePlan(ctx context.Context, db repository.DBTX, key, name, description string) (*model.Plan, error)
	SetPlanStatus(ctx context.Context, db repository.DBTX, key, status string) (*model.Plan, error)
	SetPlanEntitlements(ctx context.Context, db repository.DBTX, planID string, entitlements []model.Entitlement) error
	UpsertTenantLicense(ctx context.Context, db repository.DBTX, lic *model.TenantLicense) error
	GetTenantLicense(ctx context.Context, db repository.DBTX, tenantID string) (*model.TenantLicense, error)
	SetLicenseStatus(ctx context.Context, db repository.DBTX, tenantID, status string) error
	UpsertOverride(ctx context.Context, db repository.DBTX, o *model.Override) error
	DeleteOverride(ctx context.Context, db repository.DBTX, tenantID, key string) error
	ListOverrides(ctx context.Context, db repository.DBTX, tenantID string) ([]model.Override, error)
	AddUsage(ctx context.Context, db repository.DBTX, tenantID, key string, periodStart time.Time, delta int64) (int64, error)
	GetUsage(ctx context.Context, db repository.DBTX, tenantID, key string, periodStart time.Time) (int64, error)
	ListUsage(ctx context.Context, db repository.DBTX, tenantID string, periodStart time.Time) ([]model.Usage, error)
	ListTenantLicenses(ctx context.Context, db repository.DBTX, seatsKey string, periodStart time.Time, f model.TenantLicenseFilter, now time.Time) ([]model.TenantLicenseRow, int, error)
	ListExpiringLicenses(ctx context.Context, db repository.DBTX, withinDays int, now time.Time) ([]model.TenantLicenseRow, error)
	SeatRollup(ctx context.Context, db repository.DBTX, key string, periodStart time.Time) (int64, int64, []model.SeatRollupTenant, error)
}

// Service is the licensing engine: plan catalog, tenant license lifecycle,
// entitlement decisions, and metered usage.
type Service struct {
	pool   *pgxpool.Pool
	repo   repo
	logger zerolog.Logger
	now    func() time.Time // injectable for tests
}

// EntitlementsChangedEvent is emitted whenever a route-level entitlement
// decision cached outside the license service may have become stale. Consumers
// can delete one tenant/key entry when entitlement_key is present, or all
// cached decisions for the tenant when invalidate_all is true.
type EntitlementsChangedEvent struct {
	Reason         string `json:"reason"`
	PlanKey        string `json:"plan_key,omitempty"`
	EntitlementKey string `json:"entitlement_key,omitempty"`
	InvalidateAll  bool   `json:"invalidate_all"`
}

// New constructs the licensing service.
func New(pool *pgxpool.Pool, r repo, logger zerolog.Logger) *Service {
	return &Service{
		pool:   pool,
		repo:   r,
		logger: logger.With().Str("service", "license").Logger(),
		now:    func() time.Time { return time.Now().UTC() },
	}
}

// stage writes a license event into the outbox within the caller's transaction.
func (s *Service) stage(ctx context.Context, q outbox.Querier, eventType, tenantID string, data any) error {
	event, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, q, events.Topics.LicenseEvents, event)
}

func (s *Service) stageEntitlementsChanged(ctx context.Context, q outbox.Querier, tenantID string, data EntitlementsChangedEvent) error {
	if tenantID == "" {
		return fmt.Errorf("tenant_id is required for entitlement change event")
	}
	if data.Reason == "" {
		return fmt.Errorf("reason is required for entitlement change event")
	}
	if !data.InvalidateAll && data.EntitlementKey == "" {
		return fmt.Errorf("entitlement_key is required unless invalidate_all is true")
	}
	return s.stage(ctx, q, entitlementsChangedEventType, tenantID, data)
}

func (s *Service) stageEntitlementsChangedForTenants(ctx context.Context, q outbox.Querier, tenantIDs []string, data EntitlementsChangedEvent) error {
	for _, tenantID := range tenantIDs {
		if err := s.stageEntitlementsChanged(ctx, q, tenantID, data); err != nil {
			return err
		}
	}
	return nil
}

// --- Plan catalog ----------------------------------------------------------

// CreatePlan adds a catalog plan with its entitlement set.
func (s *Service) CreatePlan(ctx context.Context, plan *model.Plan) (*model.Plan, error) {
	if plan.Key == "" || plan.Name == "" {
		return nil, fmt.Errorf("plan key and name are required")
	}
	plan.Source = model.PlanSourceCatalog
	err := database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.repo.CreatePlan(ctx, tx, plan); err != nil {
			return err
		}
		return s.repo.SetPlanEntitlements(ctx, tx, plan.ID, plan.Entitlements)
	})
	if err != nil {
		return nil, err
	}
	return plan, nil
}

// UpdatePlanEntitlements replaces a plan's entitlement set.
func (s *Service) UpdatePlanEntitlements(ctx context.Context, planKey string, entitlements []model.Entitlement) (*model.Plan, error) {
	var plan *model.Plan
	err := database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		loaded, err := s.repo.GetPlanByKey(ctx, tx, planKey)
		if err != nil {
			return err
		}
		if err := s.repo.SetPlanEntitlements(ctx, tx, loaded.ID, entitlements); err != nil {
			return err
		}
		tenantIDs, err := s.repo.ListTenantIDsByPlanKey(ctx, tx, loaded.Key)
		if err != nil {
			return err
		}
		if err := s.stageEntitlementsChangedForTenants(ctx, tx, tenantIDs, EntitlementsChangedEvent{
			Reason:        entitlementsChangePlanEntitlements,
			PlanKey:       loaded.Key,
			InvalidateAll: true,
		}); err != nil {
			return err
		}
		loaded.Entitlements = entitlements
		plan = loaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	return plan, nil
}

// UpdatePlanInput captures catalog metadata changes.
type UpdatePlanInput struct {
	Key         string
	Name        string
	Description string
}

// UpdatePlan changes catalog plan metadata without changing its entitlement set.
func (s *Service) UpdatePlan(ctx context.Context, in UpdatePlanInput) (*model.Plan, error) {
	if in.Key == "" || in.Name == "" {
		return nil, fmt.Errorf("plan key and name are required")
	}
	return s.repo.UpdatePlan(ctx, s.pool, in.Key, in.Name, in.Description)
}

// RetirePlan removes a catalog plan from assignment and list results while
// preserving existing tenant licenses that already point at it.
func (s *Service) RetirePlan(ctx context.Context, key string) (*model.Plan, error) {
	return s.setPlanStatus(ctx, key, model.PlanStatusRetired)
}

// ReactivatePlan makes a retired catalog plan assignable again.
func (s *Service) ReactivatePlan(ctx context.Context, key string) (*model.Plan, error) {
	return s.setPlanStatus(ctx, key, model.PlanStatusActive)
}

func (s *Service) setPlanStatus(ctx context.Context, key, status string) (*model.Plan, error) {
	if key == "" {
		return nil, fmt.Errorf("plan key is required")
	}
	switch status {
	case model.PlanStatusActive, model.PlanStatusRetired:
	default:
		return nil, fmt.Errorf("unsupported plan status %q", status)
	}
	return s.repo.SetPlanStatus(ctx, s.pool, key, status)
}

// GetPlan loads one plan by key.
func (s *Service) GetPlan(ctx context.Context, key string) (*model.Plan, error) {
	return s.repo.GetPlanByKey(ctx, s.pool, key)
}

// ListPlans returns the assignable catalog.
func (s *Service) ListPlans(ctx context.Context) ([]*model.Plan, error) {
	return s.repo.ListCatalogPlans(ctx, s.pool)
}

// --- License lifecycle -------------------------------------------------------

// AssignLicenseInput captures a license assignment or plan change.
type AssignLicenseInput struct {
	TenantID  string
	PlanKey   string
	Seats     int64
	ExpiresAt time.Time
	GraceDays int
}

// AssignLicense binds the tenant to a plan, replacing any existing license,
// and records license.assigned in the same transaction.
func (s *Service) AssignLicense(ctx context.Context, in AssignLicenseInput) (*model.TenantLicense, error) {
	if in.TenantID == "" || in.PlanKey == "" {
		return nil, fmt.Errorf("tenant_id and plan_key are required")
	}
	if !in.ExpiresAt.After(s.now()) {
		return nil, fmt.Errorf("expires_at must be in the future")
	}
	if in.GraceDays < 0 {
		return nil, fmt.Errorf("grace_days must not be negative")
	}

	var lic *model.TenantLicense
	err := database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		plan, err := s.repo.GetPlanByKey(ctx, tx, in.PlanKey)
		if err != nil {
			return err
		}
		if plan.Source != model.PlanSourceCatalog || plan.Status != model.PlanStatusActive {
			return fmt.Errorf("plan %s is not assignable: %w", in.PlanKey, model.ErrNotFound)
		}

		lic = &model.TenantLicense{
			TenantID:  in.TenantID,
			PlanID:    plan.ID,
			PlanKey:   plan.Key,
			Status:    model.LicenseStatusActive,
			Seats:     in.Seats,
			StartsAt:  s.now(),
			ExpiresAt: in.ExpiresAt.UTC(),
			GraceDays: in.GraceDays,
		}
		if err := s.repo.UpsertTenantLicense(ctx, tx, lic); err != nil {
			return err
		}
		if err := s.stage(ctx, tx, "license.assigned", in.TenantID, map[string]any{
			"plan_key":   plan.Key,
			"seats":      in.Seats,
			"expires_at": lic.ExpiresAt,
			"grace_days": in.GraceDays,
		}); err != nil {
			return err
		}
		return s.stageEntitlementsChanged(ctx, tx, in.TenantID, EntitlementsChangedEvent{
			Reason:        entitlementsChangeLicenseAssigned,
			PlanKey:       plan.Key,
			InvalidateAll: true,
		})
	})
	if err != nil {
		return nil, err
	}
	return lic, nil
}

// SeedUsageCounter ensures a usage_counters row exists for (tenant, key) in the
// current metering period, initialised to zero, WITHOUT consuming any quota. It
// is used by the commercial loop to seed the AI-token counter when a tier plan
// is provisioned from an accepted quote, so the metering surface shows the
// tenant's monthly allowance (limit) against a live 0-used counter from day one
// rather than only after first consumption. It is idempotent: re-seeding an
// existing row is a no-op (delta 0 upsert). tenantID and key are required.
func (s *Service) SeedUsageCounter(ctx context.Context, tenantID, key string) error {
	if tenantID == "" || key == "" {
		return fmt.Errorf("tenant_id and key are required")
	}
	return database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := s.repo.AddUsage(ctx, tx, tenantID, key, model.PeriodStart(s.now()), 0)
		return err
	})
}

// SuspendLicense disables all entitlements for the tenant.
func (s *Service) SuspendLicense(ctx context.Context, tenantID string) error {
	return s.setStatus(ctx, tenantID, model.LicenseStatusSuspended, "license.suspended")
}

// ResumeLicense re-enables a suspended license.
func (s *Service) ResumeLicense(ctx context.Context, tenantID string) error {
	return s.setStatus(ctx, tenantID, model.LicenseStatusActive, "license.resumed")
}

func (s *Service) setStatus(ctx context.Context, tenantID, status, eventType string) error {
	return database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.repo.SetLicenseStatus(ctx, tx, tenantID, status); err != nil {
			return err
		}
		lic, err := s.repo.GetTenantLicense(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		if err := s.stage(ctx, tx, eventType, tenantID, map[string]any{"status": status}); err != nil {
			return err
		}
		reason := entitlementsChangeLicenseResumed
		if status == model.LicenseStatusSuspended {
			reason = entitlementsChangeLicenseSuspended
		}
		return s.stageEntitlementsChanged(ctx, tx, tenantID, EntitlementsChangedEvent{
			Reason:        reason,
			PlanKey:       lic.PlanKey,
			InvalidateAll: true,
		})
	})
}

// GetLicense returns the tenant's license with its computed state.
func (s *Service) GetLicense(ctx context.Context, tenantID string) (*model.TenantLicense, string, error) {
	lic, err := s.repo.GetTenantLicense(ctx, s.pool, tenantID)
	if err != nil {
		return nil, "", err
	}
	return lic, lic.State(s.now()), nil
}

// SetOverride creates or updates a per-tenant entitlement override.
func (s *Service) SetOverride(ctx context.Context, o *model.Override) error {
	if o.TenantID == "" || o.Key == "" {
		return fmt.Errorf("tenant_id and key are required")
	}
	return database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.repo.UpsertOverride(ctx, tx, o); err != nil {
			return err
		}
		if err := s.stage(ctx, tx, "license.override_set", o.TenantID, map[string]any{
			"key":    o.Key,
			"limit":  o.Limit,
			"reason": o.Reason,
		}); err != nil {
			return err
		}
		return s.stageEntitlementsChanged(ctx, tx, o.TenantID, EntitlementsChangedEvent{
			Reason:         entitlementsChangeOverrideSet,
			EntitlementKey: o.Key,
		})
	})
}

// RemoveOverride deletes an override, restoring the plan default.
func (s *Service) RemoveOverride(ctx context.Context, tenantID, key string) error {
	return database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.repo.DeleteOverride(ctx, tx, tenantID, key); err != nil {
			return err
		}
		if err := s.stage(ctx, tx, "license.override_removed", tenantID, map[string]any{"key": key}); err != nil {
			return err
		}
		return s.stageEntitlementsChanged(ctx, tx, tenantID, EntitlementsChangedEvent{
			Reason:         entitlementsChangeOverrideRemoved,
			EntitlementKey: key,
		})
	})
}

// --- Entitlement resolution and decisions -----------------------------------

// resolved is the tenant's effective entitlement map after applying seat
// precedence and overrides to the plan.
type resolved struct {
	license      *model.TenantLicense
	state        string
	entitlements map[string]model.Entitlement
}

// resolve computes the tenant's effective entitlements on db.
func (s *Service) resolve(ctx context.Context, db repository.DBTX, tenantID string) (*resolved, error) {
	lic, err := s.repo.GetTenantLicense(ctx, db, tenantID)
	if err != nil {
		return nil, err
	}
	plan, err := s.repo.GetPlanByKey(ctx, db, lic.PlanKey)
	if err != nil {
		return nil, err
	}
	overrides, err := s.repo.ListOverrides(ctx, db, tenantID)
	if err != nil {
		return nil, err
	}

	entitlements := make(map[string]model.Entitlement, len(plan.Entitlements))
	for _, e := range plan.Entitlements {
		entitlements[e.Key] = e
	}
	for _, o := range overrides {
		entitlements[o.Key] = model.Entitlement{Key: o.Key, Limit: o.Limit}
	}
	// Seat precedence: a positive seats value on the license defines the
	// seat quota regardless of plan or override rows.
	if lic.Seats > 0 {
		seats := lic.Seats
		entitlements[SeatsKey] = model.Entitlement{Key: SeatsKey, Limit: &seats}
	}

	return &resolved{license: lic, state: lic.State(s.now()), entitlements: entitlements}, nil
}

// deny builds a denied decision.
func deny(key, state, reason string) *model.Decision {
	return &model.Decision{Allowed: false, Key: key, Reason: reason, LicenseState: state}
}

// decideLicense returns a denial if the license state blocks all entitlements.
func decideLicense(res *resolved, key string) *model.Decision {
	switch res.state {
	case model.StateSuspended:
		return deny(key, res.state, "license suspended")
	case model.StateExpired:
		return deny(key, res.state, "license expired")
	}
	return nil
}

// Check answers "may tenant T use entitlement K?" without consuming quota.
// A missing license or missing key is a denial, not an error.
func (s *Service) Check(ctx context.Context, tenantID, key string) (*model.Decision, error) {
	if key == "" {
		return nil, fmt.Errorf("entitlement key is required")
	}
	res, err := s.resolve(ctx, s.pool, tenantID)
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return deny(key, model.StateExpired, "no license assigned"), nil
		}
		return nil, err
	}
	if d := decideLicense(res, key); d != nil {
		return d, nil
	}

	entitlement, ok := res.entitlements[key]
	if !ok {
		return s.decorate(deny(key, res.state, "not included in plan"), res), nil
	}
	if entitlement.Revoked() {
		return s.decorate(deny(key, res.state, "entitlement revoked"), res), nil
	}

	decision := &model.Decision{Allowed: true, Key: key, LicenseState: res.state}
	if entitlement.Limit != nil {
		used, err := s.repo.GetUsage(ctx, s.pool, tenantID, key, model.PeriodStart(s.now()))
		if err != nil {
			return nil, err
		}
		decision.Limit = entitlement.Limit
		decision.Used = used
		remaining := *entitlement.Limit - used
		if remaining < 0 {
			remaining = 0
		}
		decision.Remaining = &remaining
		if used >= *entitlement.Limit {
			decision.Allowed = false
			decision.Reason = "entitlement limit exceeded"
		}
	}
	return s.decorate(decision, res), nil
}

// decorate attaches license context to a decision.
func (s *Service) decorate(d *model.Decision, res *resolved) *model.Decision {
	d.PlanKey = res.license.PlanKey
	d.ExpiresAt = res.license.ExpiresAt
	return d
}

// Entitlements returns the tenant's full resolved entitlement set with usage.
func (s *Service) Entitlements(ctx context.Context, tenantID string) ([]model.Decision, string, error) {
	res, err := s.resolve(ctx, s.pool, tenantID)
	if err != nil {
		return nil, "", err
	}
	usage, err := s.repo.ListUsage(ctx, s.pool, tenantID, model.PeriodStart(s.now()))
	if err != nil {
		return nil, "", err
	}
	usedByKey := make(map[string]int64, len(usage))
	for _, u := range usage {
		usedByKey[u.Key] = u.Used
	}

	decisions := make([]model.Decision, 0, len(res.entitlements))
	for key := range res.entitlements {
		d, err := s.Check(ctx, tenantID, key)
		if err != nil {
			return nil, "", err
		}
		d.Used = usedByKey[key]
		decisions = append(decisions, *d)
	}
	return decisions, res.state, nil
}

// --- Admin cross-tenant reads ------------------------------------------------

// ListTenantLicenses returns a page of the fleet license view with each
// tenant's current-period seat usage (G7).
func (s *Service) ListTenantLicenses(ctx context.Context, f model.TenantLicenseFilter) ([]model.TenantLicenseRow, int, error) {
	now := s.now()
	rows, total, err := s.repo.ListTenantLicenses(ctx, s.pool, SeatsKey, model.PeriodStart(now), f, now)
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// ListExpiringLicenses returns active licenses expiring within withinDays,
// ordered by expires_at (G8).
func (s *Service) ListExpiringLicenses(ctx context.Context, withinDays int) ([]model.TenantLicenseRow, error) {
	if withinDays < 0 {
		return nil, fmt.Errorf("within_days must not be negative")
	}
	return s.repo.ListExpiringLicenses(ctx, s.pool, withinDays, s.now())
}

// ListOverrides returns a tenant's entitlement overrides (G9).
func (s *Service) ListOverrides(ctx context.Context, tenantID string) ([]model.Override, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	return s.repo.ListOverrides(ctx, s.pool, tenantID)
}

// ListUsage returns a tenant's metered usage for the given period (G10). A
// zero period falls back to the current calendar month.
func (s *Service) ListUsage(ctx context.Context, tenantID string, period time.Time) ([]model.Usage, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if period.IsZero() {
		period = s.now()
	}
	return s.repo.ListUsage(ctx, s.pool, tenantID, model.PeriodStart(period))
}

// SeatRollup aggregates a metered key across the fleet for one period (G11). A
// zero period falls back to the current calendar month.
func (s *Service) SeatRollup(ctx context.Context, key string, period time.Time) (*model.SeatRollup, error) {
	if key == "" {
		return nil, fmt.Errorf("key is required")
	}
	if period.IsZero() {
		period = s.now()
	}
	periodStart := model.PeriodStart(period)
	totalLimit, totalUsed, perTenant, err := s.repo.SeatRollup(ctx, s.pool, key, periodStart)
	if err != nil {
		return nil, err
	}
	if perTenant == nil {
		perTenant = []model.SeatRollupTenant{}
	}
	return &model.SeatRollup{
		Key:        key,
		Period:     periodStart.Format("2006-01"),
		TotalLimit: totalLimit,
		TotalUsed:  totalUsed,
		PerTenant:  perTenant,
	}, nil
}

// EntitlementKeys returns the canonical entitlement-key registry (G12).
func (s *Service) EntitlementKeys() []model.EntitlementKey {
	return model.EntitlementKeys
}

// Consume records usage of a metered entitlement. With enforce, consumption
// that would exceed the limit is rejected with model.ErrLimitExceeded and no
// counter change; without enforce (trusted metering, e.g. the bus consumer)
// the counter always moves and crossing the limit stages a
// license.entitlement.limit_reached event in the same transaction.
func (s *Service) Consume(ctx context.Context, tenantID, key string, delta int64, enforce bool) (*model.Decision, error) {
	if key == "" {
		return nil, fmt.Errorf("entitlement key is required")
	}
	if delta == 0 {
		return s.Check(ctx, tenantID, key)
	}

	var decision *model.Decision
	err := database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		res, err := s.resolve(ctx, tx, tenantID)
		if err != nil {
			if errors.Is(err, model.ErrNotFound) {
				decision = deny(key, model.StateExpired, "no license assigned")
				return nil
			}
			return err
		}
		if d := decideLicense(res, key); d != nil {
			decision = s.decorate(d, res)
			return nil
		}

		entitlement, ok := res.entitlements[key]
		if !ok {
			decision = s.decorate(deny(key, res.state, "not included in plan"), res)
			return nil
		}
		if entitlement.Revoked() {
			decision = s.decorate(deny(key, res.state, "entitlement revoked"), res)
			return nil
		}

		period := model.PeriodStart(s.now())

		if entitlement.Limit != nil && enforce && delta > 0 {
			used, err := s.repo.GetUsage(ctx, tx, tenantID, key, period)
			if err != nil {
				return err
			}
			if used+delta > *entitlement.Limit {
				remaining := *entitlement.Limit - used
				if remaining < 0 {
					remaining = 0
				}
				decision = s.decorate(deny(key, res.state, "entitlement limit exceeded"), res)
				decision.Limit = entitlement.Limit
				decision.Used = used
				decision.Remaining = &remaining
				return model.ErrLimitExceeded
			}
		}

		used, err := s.repo.AddUsage(ctx, tx, tenantID, key, period, delta)
		if err != nil {
			return err
		}

		decision = s.decorate(&model.Decision{Allowed: true, Key: key, LicenseState: res.state, Used: used}, res)
		if entitlement.Limit != nil {
			decision.Limit = entitlement.Limit
			remaining := *entitlement.Limit - used
			if remaining < 0 {
				remaining = 0
			}
			decision.Remaining = &remaining

			// Stage the threshold event exactly once: when this delta moved
			// the counter from below the limit to at-or-above it.
			if delta > 0 && used >= *entitlement.Limit && used-delta < *entitlement.Limit {
				if err := s.stage(ctx, tx, "license.entitlement.limit_reached", tenantID, map[string]any{
					"key":   key,
					"limit": *entitlement.Limit,
					"used":  used,
				}); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, model.ErrLimitExceeded) {
			return decision, model.ErrLimitExceeded
		}
		return nil, err
	}
	return decision, nil
}
