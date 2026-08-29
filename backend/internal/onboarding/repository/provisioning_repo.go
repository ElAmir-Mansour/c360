package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	onboardingmodel "github.com/clario360/platform/internal/onboarding/model"
)

type ProvisioningRepository struct {
	pool *pgxpool.Pool
}

func NewProvisioningRepository(pool *pgxpool.Pool) *ProvisioningRepository {
	return &ProvisioningRepository{pool: pool}
}

func (r *ProvisioningRepository) Initialize(ctx context.Context, tenantID, onboardingID uuid.UUID, stepNames []string) error {
	for idx, name := range stepNames {
		if _, err := r.pool.Exec(ctx, `
			INSERT INTO provisioning_steps (
				tenant_id, onboarding_id, step_number, step_name, status, idempotency_key
			) VALUES ($1, $2, $3, $4, 'pending', $5)
			ON CONFLICT (onboarding_id, step_number) DO NOTHING`,
			tenantID,
			onboardingID,
			idx+1,
			name,
			fmt.Sprintf("%s:%d", tenantID.String(), idx+1),
		); err != nil {
			return err
		}
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE tenant_onboarding
		SET provisioning_status = 'provisioning',
		    provisioning_started_at = COALESCE(provisioning_started_at, now()),
		    provisioning_error = NULL,
		    updated_at = now()
		WHERE tenant_id = $1`,
		tenantID,
	)
	return err
}

func (r *ProvisioningRepository) ListSteps(ctx context.Context, tenantID uuid.UUID) ([]onboardingmodel.ProvisioningStep, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, tenant_id, onboarding_id, step_number, step_name, status, started_at, completed_at,
		       duration_ms, error_message, retry_count, idempotency_key, metadata, created_at
		FROM provisioning_steps
		WHERE tenant_id = $1
		ORDER BY step_number`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]onboardingmodel.ProvisioningStep, 0)
	for rows.Next() {
		item, scanErr := scanProvisioningStep(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, *item)
	}
	return out, rows.Err()
}

func (r *ProvisioningRepository) StartStep(ctx context.Context, tenantID uuid.UUID, stepNumber int) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE provisioning_steps
		SET status = 'running',
		    started_at = now(),
		    completed_at = NULL,
		    duration_ms = NULL,
		    error_message = NULL,
		    retry_count = CASE WHEN status = 'failed' THEN retry_count + 1 ELSE retry_count END
		WHERE tenant_id = $1 AND step_number = $2`,
		tenantID,
		stepNumber,
	)
	return err
}

func (r *ProvisioningRepository) CompleteStep(ctx context.Context, tenantID uuid.UUID, stepNumber int, metadata map[string]any) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE provisioning_steps
		SET status = 'completed',
		    completed_at = now(),
		    duration_ms = GREATEST(EXTRACT(EPOCH FROM (now() - COALESCE(started_at, now()))) * 1000, 0)::bigint,
		    error_message = NULL,
		    metadata = COALESCE($3::jsonb, '{}'::jsonb)
		WHERE tenant_id = $1 AND step_number = $2`,
		tenantID,
		stepNumber,
		marshalJSON(metadata),
	)
	return err
}

func (r *ProvisioningRepository) FailStep(ctx context.Context, tenantID uuid.UUID, stepNumber int, errMessage string, metadata map[string]any) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE provisioning_steps
		SET status = 'failed',
		    completed_at = now(),
		    duration_ms = GREATEST(EXTRACT(EPOCH FROM (now() - COALESCE(started_at, now()))) * 1000, 0)::bigint,
		    error_message = $3,
		    metadata = COALESCE($4::jsonb, '{}'::jsonb)
		WHERE tenant_id = $1 AND step_number = $2`,
		tenantID,
		stepNumber,
		errMessage,
		marshalJSON(metadata),
	)
	return err
}

func (r *ProvisioningRepository) MarkFailed(ctx context.Context, tenantID uuid.UUID, errMessage string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE tenant_onboarding
		SET provisioning_status = 'failed',
		    provisioning_error = $2,
		    updated_at = now()
		WHERE tenant_id = $1`,
		tenantID,
		errMessage,
	)
	return err
}

func (r *ProvisioningRepository) MarkCompleted(ctx context.Context, tenantID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE tenant_onboarding
		SET provisioning_status = 'completed',
		    provisioning_completed_at = now(),
		    provisioning_error = NULL,
		    updated_at = now()
		WHERE tenant_id = $1`,
		tenantID,
	)
	return err
}

func (r *ProvisioningRepository) GetStatus(ctx context.Context, tenantID uuid.UUID) (*onboardingmodel.ProvisioningStatus, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT tenant_id, provisioning_status, provisioning_started_at, provisioning_completed_at, provisioning_error
		FROM tenant_onboarding
		WHERE tenant_id = $1`,
		tenantID,
	)
	status := &onboardingmodel.ProvisioningStatus{}
	if err := row.Scan(&status.TenantID, &status.Status, &status.StartedAt, &status.CompletedAt, &status.Error); err != nil {
		return nil, err
	}
	steps, err := r.ListSteps(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	status.Steps = steps
	status.TotalSteps = len(steps)
	for idx := range steps {
		if steps[idx].Status == onboardingmodel.ProvisioningStepCompleted {
			status.CompletedStep++
		}
		if status.CurrentStep == nil && steps[idx].Status == onboardingmodel.ProvisioningStepRunning {
			current := steps[idx]
			status.CurrentStep = &current
		}
		if status.CurrentStep == nil && (steps[idx].Status == onboardingmodel.ProvisioningStepPending || steps[idx].Status == onboardingmodel.ProvisioningStepFailed) {
			current := steps[idx]
			status.CurrentStep = &current
		}
	}
	if status.TotalSteps > 0 {
		status.ProgressPct = int(float64(status.CompletedStep) / float64(status.TotalSteps) * 100)
	}
	return status, nil
}

// InFlightItem is a flattened view of a tenant whose provisioning is not yet
// complete (status pending|provisioning|failed), enriched with the tenant's
// display name/slug and aggregate step progress. It powers the platform admin
// console's provisioning-oversight list (GAP G24) so the console can render the
// in-flight ticker without polling GetStatus per tenant.
type InFlightItem struct {
	TenantID       uuid.UUID
	TenantName     string
	TenantSlug     string
	Status         onboardingmodel.OnboardingProvisioningStatus
	StartedAt      *time.Time
	Error          *string
	TotalSteps     int
	CompletedSteps int
	ProgressPct    int
	CurrentStep    *string
}

// ListInFlight returns every tenant whose onboarding provisioning_status is one
// of the supplied statuses (defaulting to pending|provisioning|failed), newest
// first. Step aggregates are computed in a single LEFT JOIN against
// provisioning_steps so the caller never has to fan out per tenant. The
// "current step" is the lowest-numbered running step, else the lowest-numbered
// pending/failed step — matching GetStatus's selection order.
func (r *ProvisioningRepository) ListInFlight(ctx context.Context, statuses []onboardingmodel.OnboardingProvisioningStatus) ([]InFlightItem, error) {
	if len(statuses) == 0 {
		statuses = []onboardingmodel.OnboardingProvisioningStatus{
			onboardingmodel.OnboardingProvisioningPending,
			onboardingmodel.OnboardingProvisioningProvisioning,
			onboardingmodel.OnboardingProvisioningFailed,
		}
	}
	statusStrings := make([]string, 0, len(statuses))
	for _, s := range statuses {
		statusStrings = append(statusStrings, string(s))
	}

	rows, err := r.pool.Query(ctx, `
		SELECT
			o.tenant_id,
			t.name,
			t.slug,
			o.provisioning_status,
			o.provisioning_started_at,
			o.provisioning_error,
			COALESCE(s.total_steps, 0)     AS total_steps,
			COALESCE(s.completed_steps, 0) AS completed_steps,
			(
				SELECT ps.step_name
				FROM provisioning_steps ps
				WHERE ps.tenant_id = o.tenant_id
				ORDER BY (ps.status = 'running') DESC,
				         (ps.status IN ('pending', 'failed')) DESC,
				         ps.step_number ASC
				LIMIT 1
			) AS current_step
		FROM tenant_onboarding o
		JOIN tenants t ON t.id = o.tenant_id
		LEFT JOIN (
			SELECT tenant_id,
			       COUNT(*)                                          AS total_steps,
			       COUNT(*) FILTER (WHERE status = 'completed')      AS completed_steps
			FROM provisioning_steps
			GROUP BY tenant_id
		) s ON s.tenant_id = o.tenant_id
		WHERE o.provisioning_status = ANY($1)
		ORDER BY o.provisioning_started_at DESC NULLS LAST, o.created_at DESC`,
		statusStrings,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]InFlightItem, 0)
	for rows.Next() {
		var item InFlightItem
		if scanErr := rows.Scan(
			&item.TenantID,
			&item.TenantName,
			&item.TenantSlug,
			&item.Status,
			&item.StartedAt,
			&item.Error,
			&item.TotalSteps,
			&item.CompletedSteps,
			&item.CurrentStep,
		); scanErr != nil {
			return nil, scanErr
		}
		if item.TotalSteps > 0 {
			item.ProgressPct = int(float64(item.CompletedSteps) / float64(item.TotalSteps) * 100)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *ProvisioningRepository) GetOnboardingID(ctx context.Context, tenantID uuid.UUID) (uuid.UUID, error) {
	var onboardingID uuid.UUID
	err := r.pool.QueryRow(ctx, `
		SELECT id
		FROM tenant_onboarding
		WHERE tenant_id = $1`,
		tenantID,
	).Scan(&onboardingID)
	return onboardingID, err
}

func (r *ProvisioningRepository) SetTenantStatus(ctx context.Context, tenantID uuid.UUID, status string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE tenants
		SET status = $2, updated_at = now()
		WHERE id = $1`,
		tenantID,
		status,
	)
	return err
}
