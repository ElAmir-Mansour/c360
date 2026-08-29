package integration

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Feature 6 — endpoint health-check history + degrade alerts + expiry warnings.
//
// The registry's Health/HealthAll paths call a HealthRecorder after each probe.
// The recorder:
//   1. persists one integration.HealthCheckRecord per probe into
//      lex_integration_health_checks (the migration unit adds the table) so the
//      console can render an uptime sparkline (HealthRecorder.History);
//   2. detects a GRADE DEGRADE transition (previously healthy -> now
//      unreachable/unauthenticated) and emits ONE notification through the
//      existing lex notification/outbox seam (in-app + email). It is idempotent:
//      the alert fires only on the healthy->unhealthy edge, derived by comparing
//      the freshly-computed grade against the last persisted grade — NOT on every
//      tick, and never again until the endpoint recovers and degrades anew;
//   3. computes []ExpiryWarning from connector-reported cert/secret expiry. A
//      connector opts in by implementing ExpiryReporter; the default is none.
//
// Secrets are NEVER persisted, logged, or surfaced here — Detail is the
// operator-safe message the adapter already sanitized.
// =============================================================================

// Health grades. The recorder maps a model.IntegrationHealth (Reachable + the
// adapter's sanitized Detail) to one of these stable grades, which drive the
// console's colour timeline and the degrade-transition detector. They are the
// HealthCheckRecord.Grade domain.
const (
	// HealthGradeHealthy — the connector reached and authenticated successfully.
	HealthGradeHealthy = "healthy"
	// HealthGradeUnauthenticated — reachable but credentials were rejected (a
	// rotate-secret signal). Derived from the sanitized Detail (401/403/auth).
	HealthGradeUnauthenticated = "unauthenticated"
	// HealthGradeUnreachable — the upstream could not be reached/probed.
	HealthGradeUnreachable = "unreachable"
	// HealthGradeDisabled — the endpoint is planned/disabled (not an outage).
	HealthGradeDisabled = "disabled"
)

// HealthCheckRecord is one persisted health-probe outcome (the storage twin of
// repository.IntegrationHealthCheckRow). It is what HealthRecorder.History
// returns to the console for the uptime sparkline. It carries only non-sensitive
// diagnostics: Detail is the adapter's sanitized, operator-facing message.
type HealthCheckRecord struct {
	ID         uuid.UUID `json:"id"`
	TenantID   uuid.UUID `json:"tenant_id"`
	EndpointID uuid.UUID `json:"endpoint_id"`
	Grade      string    `json:"grade"`
	Reachable  bool      `json:"reachable"`
	Detail     string    `json:"detail,omitempty"`
	CheckedAt  time.Time `json:"checked_at"`
}

// ExpiryWarning is a forward-looking warning that a connector-held credential or
// certificate is approaching expiry. Field names the expiring artefact (e.g.
// "client_secret", "saml_signing_cert"); ExpiresAt/DaysLeft drive the console
// badge. It never carries the secret value itself.
type ExpiryWarning struct {
	Field     string    `json:"field"`
	ExpiresAt time.Time `json:"expires_at"`
	DaysLeft  int       `json:"days_left"`
}

// ExpiryReporter is the OPTIONAL connector capability for surfacing cert/secret
// expiry. A connector that knows when its credentials lapse (e.g. an SSO/SAML
// signing cert, an OAuth client_secret with a stored rotation deadline)
// implements it; the registry type-asserts it. The default — an adapter that does
// not implement it — reports no warnings. Implementations must derive expiry from
// non-sensitive config/metadata only and must NOT echo secret material.
type ExpiryReporter interface {
	Expiries(endpoint model.IntegrationEndpoint) []ExpiryWarning
}

// DegradeNotifier is the thin seam the recorder uses to emit a degrade alert
// through the existing lex notification/outbox path (in-app + email). It is
// satisfied by a small adapter over service.LexNotificationService wired at
// construction time (see the manifest: the integrator passes an adapter whose
// Notify fans the alert to the tenant's integration administrators). A nil
// notifier disables alerting (history still records); the recorder treats
// notification failures as best-effort (logs, never fails the probe).
type DegradeNotifier interface {
	NotifyDegrade(ctx context.Context, tenantID uuid.UUID, alert DegradeAlert) error
}

// DegradeAlert is the payload handed to the DegradeNotifier on a healthy->unhealthy
// transition. Title/Body are bilingual, pre-localized by the recorder; the
// notifier adapter maps these onto the lex inbox NotifyInput (category general,
// entity_type "integration_endpoint", a deep link the adapter builds, and the
// DedupKey below). All fields are secret-free.
type DegradeAlert struct {
	EndpointID uuid.UUID
	Kind       model.IntegrationKind
	Code       string
	FromGrade  string
	ToGrade    string
	Detail     string
	Title      forms.LocalizedText
	Body       forms.LocalizedText
	// DedupKey is a stable idempotency key for the inbox dedup index. It includes
	// the checked-at second so a recover→re-degrade cycle produces a fresh alert
	// while a single transition (probed repeatedly within the same instant) does
	// not duplicate. Format: "integration.degrade:<endpoint>:<unix>".
	DedupKey  string
	CheckedAt time.Time
}

// HealthRecorder persists health-check history, detects degrade transitions, and
// computes expiry warnings. The registry holds one (wired via WithHealthRecorder)
// and calls Record after each probe. It is secret-safe and side-effect-light: a
// missing repo/notifier degrades gracefully (history skipped / alert skipped)
// rather than failing the probe.
type HealthRecorder struct {
	repo     *repository.IntegrationHealthRepository
	notifier DegradeNotifier
	logger   zerolog.Logger
	now      func() time.Time
}

// NewHealthRecorder builds a recorder. A nil repo disables history persistence and
// degrade detection (both depend on the ledger); a nil notifier disables alerting
// only. now defaults to time.Now.
func NewHealthRecorder(repo *repository.IntegrationHealthRepository, notifier DegradeNotifier, logger zerolog.Logger) *HealthRecorder {
	return &HealthRecorder{
		repo:     repo,
		notifier: notifier,
		logger:   logger.With().Str("component", "lex-integration-health-recorder").Logger(),
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// GradeFor maps a probe outcome to a stable health grade. Unreachable +
// planned/disabled status is "disabled" (not an outage); unreachable + a detail
// that reads as an auth rejection is "unauthenticated"; otherwise unreachable is
// "unreachable"; reachable is "healthy".
func GradeFor(health model.IntegrationHealth) string {
	if health.Reachable {
		return HealthGradeHealthy
	}
	switch health.Status {
	case model.IntegrationStatusPlanned, model.IntegrationStatusDisabled:
		return HealthGradeDisabled
	}
	if looksUnauthenticated(health.Detail) {
		return HealthGradeUnauthenticated
	}
	return HealthGradeUnreachable
}

// looksUnauthenticated classifies a sanitized, operator-safe detail string as an
// auth rejection (a rotate-secret signal). It matches on the adapter's own
// vocabulary; it never inspects secret material.
func looksUnauthenticated(detail string) bool {
	d := strings.ToLower(detail)
	for _, needle := range []string{"401", "403", "unauthorized", "unauthenticated", "forbidden", "invalid credential", "auth"} {
		if strings.Contains(d, needle) {
			return true
		}
	}
	return false
}

// gradeIsOutage reports whether a grade represents an actionable outage worth
// alerting on. "disabled" is operator intent, not an outage, so it is excluded.
func gradeIsOutage(grade string) bool {
	return grade == HealthGradeUnreachable || grade == HealthGradeUnauthenticated
}

// Record persists one health-check row for the probe and, when the grade has just
// transitioned from healthy to an outage grade, emits a single degrade alert
// through the notifier. It returns the persisted HealthCheckRecord (zero value
// when no repo is wired). Errors are logged and swallowed for the alert path
// (best-effort) but returned for the persistence path so the caller can log; the
// caller (registry) MUST NOT fail the probe on a recorder error.
func (h *HealthRecorder) Record(ctx context.Context, tenantID uuid.UUID, health model.IntegrationHealth) (HealthCheckRecord, error) {
	if h == nil || h.repo == nil {
		return HealthCheckRecord{}, nil
	}
	grade := GradeFor(health)
	checkedAt := h.now()
	if health.CheckedUnix > 0 {
		checkedAt = time.Unix(health.CheckedUnix, 0).UTC()
	}

	// Read the previous grade BEFORE inserting the new row so the transition test
	// compares old vs new. A first-ever probe has no prior (prevGrade == "").
	prevGrade := ""
	if prev, err := h.repo.Latest(ctx, tenantID, health.EndpointID); err != nil {
		h.logger.Error().Err(err).Str("endpoint_id", health.EndpointID.String()).Msg("read latest health record")
	} else if prev != nil {
		prevGrade = prev.Grade
	}

	row := &repository.IntegrationHealthCheckRow{
		TenantID:   tenantID,
		EndpointID: health.EndpointID,
		Grade:      grade,
		Reachable:  health.Reachable,
		Detail:     health.Detail,
		CheckedAt:  checkedAt,
	}
	if err := h.repo.Record(ctx, row); err != nil {
		return HealthCheckRecord{}, fmt.Errorf("lex/integration: record health check: %w", err)
	}
	record := HealthCheckRecord{
		ID:         row.ID,
		TenantID:   row.TenantID,
		EndpointID: row.EndpointID,
		Grade:      row.Grade,
		Reachable:  row.Reachable,
		Detail:     row.Detail,
		CheckedAt:  row.CheckedAt,
	}

	// Degrade transition: previously healthy (or never-probed-but-now-degraded is
	// NOT alerted — only a real healthy->outage edge), now an outage grade.
	if prevGrade == HealthGradeHealthy && gradeIsOutage(grade) {
		h.fireDegrade(ctx, tenantID, health, prevGrade, grade, checkedAt)
	}
	return record, nil
}

// fireDegrade builds and dispatches a single degrade alert (best-effort).
func (h *HealthRecorder) fireDegrade(ctx context.Context, tenantID uuid.UUID, health model.IntegrationHealth, fromGrade, toGrade string, checkedAt time.Time) {
	if h.notifier == nil {
		return
	}
	alert := DegradeAlert{
		EndpointID: health.EndpointID,
		Kind:       health.Kind,
		Code:       health.Code,
		FromGrade:  fromGrade,
		ToGrade:    toGrade,
		Detail:     health.Detail,
		Title:      degradeTitle(health.Code, toGrade),
		Body:       degradeBody(health.Code, health.Detail, toGrade),
		DedupKey:   fmt.Sprintf("integration.degrade:%s:%d", health.EndpointID.String(), checkedAt.Unix()),
		CheckedAt:  checkedAt,
	}
	if err := h.notifier.NotifyDegrade(ctx, tenantID, alert); err != nil {
		h.logger.Error().Err(err).Str("endpoint_id", health.EndpointID.String()).Msg("emit integration degrade alert")
	}
}

// History returns the most recent health-check records for an endpoint (newest
// first) for the uptime sparkline. Returns an empty slice when no repo is wired.
func (h *HealthRecorder) History(ctx context.Context, tenantID, endpointID uuid.UUID, limit int) ([]HealthCheckRecord, error) {
	if h == nil || h.repo == nil {
		return []HealthCheckRecord{}, nil
	}
	rows, err := h.repo.List(ctx, tenantID, endpointID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]HealthCheckRecord, 0, len(rows))
	for i := range rows {
		out = append(out, HealthCheckRecord{
			ID:         rows[i].ID,
			TenantID:   rows[i].TenantID,
			EndpointID: rows[i].EndpointID,
			Grade:      rows[i].Grade,
			Reachable:  rows[i].Reachable,
			Detail:     rows[i].Detail,
			CheckedAt:  rows[i].CheckedAt,
		})
	}
	return out, nil
}

// Expiries computes credential/certificate expiry warnings for an endpoint by
// type-asserting the adapter's optional ExpiryReporter capability. The adapter is
// taken as `any` so this helper does not couple to the service-layer
// IntegrationAdapter port (which lives in package service and would create an
// import cycle). Adapters that do not implement ExpiryReporter — and a nil
// adapter — yield no warnings (the default). The adapter derives expiry from
// non-sensitive config/metadata only; secrets are never read here.
func Expiries(adapter any, endpoint model.IntegrationEndpoint) []ExpiryWarning {
	reporter, ok := adapter.(ExpiryReporter)
	if !ok {
		return nil
	}
	return reporter.Expiries(endpoint)
}

// --- bilingual alert copy ----------------------------------------------------

func degradeTitle(code, toGrade string) forms.LocalizedText {
	switch toGrade {
	case HealthGradeUnauthenticated:
		return forms.LocalizedText{
			AR: fmt.Sprintf("فشل مصادقة التكامل: %s", code),
			EN: fmt.Sprintf("Integration authentication failed: %s", code),
		}
	default:
		return forms.LocalizedText{
			AR: fmt.Sprintf("تعذّر الوصول إلى التكامل: %s", code),
			EN: fmt.Sprintf("Integration unreachable: %s", code),
		}
	}
}

func degradeBody(code, detail, toGrade string) forms.LocalizedText {
	hintAR := "يرجى التحقق من حالة الاتصال."
	hintEN := "Please review the connection status."
	if toGrade == HealthGradeUnauthenticated {
		hintAR = "قد تحتاج إلى تدوير بيانات الاعتماد."
		hintEN = "Credentials may need rotating."
	}
	d := strings.TrimSpace(detail)
	if d == "" {
		d = "no detail"
	}
	return forms.LocalizedText{
		AR: fmt.Sprintf("انتقل التكامل %s إلى حالة غير سليمة (%s). %s التفاصيل: %s", code, toGrade, hintAR, d),
		EN: fmt.Sprintf("Integration %s degraded to %s. %s Detail: %s", code, toGrade, hintEN, d),
	}
}
