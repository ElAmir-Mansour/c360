package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	siemaudit "github.com/clario360/platform/internal/siem/audit"
	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/enroll"
	"github.com/clario360/platform/internal/siem/sources/pki"
	"github.com/clario360/platform/internal/siem/sources/repo"
)

func makeSvc(t *testing.T) (Service, pgxmock.PgxPoolIface, *captureEmitter) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	require.NoError(t, err)
	t.Cleanup(func() { mock.Close() })

	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer := enroll.NewEd25519Signer("k", priv)
	tokenMgr := enroll.NewTokenManager(signer, rdb)

	pkiMgr := pki.New(stubVault{}, pki.DefaultConfig(), zerolog.Nop())
	emitter := &captureEmitter{}
	svc := New(Deps{
		Sources:     repo.NewSourcesRepo(mock),
		EPS:         repo.NewEPSRepo(mock),
		Tokens:      repo.NewEnrollmentTokensRepo(mock),
		Revocations: repo.NewRevocationRepo(mock),
		TokenMgr:    tokenMgr,
		PKI:         pkiMgr,
		Emitter:     emitter,
		Audit:       siemaudit.NewInMemory(),
		Metrics:     sources.NewMetrics(prometheus.NewRegistry()),
		Logger:      zerolog.Nop(),
		Config:      DefaultConfig(),
	})
	return svc, mock, emitter
}

// stubVault is a no-op VaultPKI for service tests.
type stubVault struct{}

func (stubVault) EnsurePKIMount(context.Context, string, time.Duration, time.Duration) error {
	return nil
}
func (stubVault) GenerateRootCA(context.Context, string, string, time.Duration) (string, error) {
	return "r", nil
}
func (stubVault) EnsureIntermediate(context.Context, string, string, string, time.Duration) (string, error) {
	return "i", nil
}
func (stubVault) EnsurePKIRole(context.Context, string, string, pki.PKIRoleSettings) error {
	return nil
}
func (stubVault) IssueLeaf(context.Context, string, string, string, string, time.Duration) (pki.LeafCert, error) {
	return pki.LeafCert{}, nil
}
func (stubVault) RevokeLeaf(context.Context, string, string) error { return nil }

type captureEmitter struct {
	events []string
}

func (c *captureEmitter) EmitSourceEvent(_ context.Context, _, _ uuid.UUID, evtype string, _ any) error {
	c.events = append(c.events, evtype)
	return nil
}

func sourceCols() []string {
	return []string{
		"id", "tenant_id", "name", "type", "transport", "address", "expected_eps",
		"baseline_eps", "baseline_samples", "tz", "parser_id", "status",
		"last_seen_at", "last_health_at", "mtls_thumbprint", "cert_serial",
		"cert_issued_at", "cert_expires_at", "cert_revoked_at", "cert_revoked_reason",
		"tags", "version", "created_by", "created_at", "updated_at", "deleted_at",
	}
}

func sourceRow(tenantID, id uuid.UUID, name string, status sources.Status, version int64) []any {
	now := time.Now().UTC()
	return []any{
		id, tenantID, name, "firewall", string(sources.TransportSyslogUDP), "10.0.0.1:514", 100,
		0, 0, "Africa/Lagos", nil, string(status),
		nil, nil, nil, nil,
		nil, nil, nil, nil,
		[]byte(`{}`), version, uuid.New(), now, now, nil,
	}
}

func TestOnboard_Success(t *testing.T) {
	svc, mock, emitter := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	creator := uuid.New()

	mock.ExpectQuery("INSERT INTO siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw-01", sources.StatusProvisioning, 1)...))
	mock.ExpectExec("INSERT INTO siem.enrollment_tokens").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))

	src, tok, err := svc.Onboard(context.Background(), sources.OnboardInput{
		TenantID: tenant, Name: "fw-01", Type: "firewall",
		Transport: sources.TransportSyslogUDP, Address: "10.0.0.1:514",
		ExpectedEPS: 100, CreatedBy: creator,
	})
	require.NoError(t, err)
	require.Equal(t, sources.StatusProvisioning, src.Status)
	require.NotEmpty(t, tok.JWT)
	require.Contains(t, emitter.events, "siem.source.created")
}

func TestOnboard_ValidationFails(t *testing.T) {
	svc, _, _ := makeSvc(t)
	_, _, err := svc.Onboard(context.Background(), sources.OnboardInput{
		TenantID: uuid.New(), Name: "X", Type: "fw",
		Transport: sources.TransportSyslogUDP, Address: "h:514", CreatedBy: uuid.New(),
	})
	require.ErrorIs(t, err, sources.ErrValidation)
}

func TestUpdate_VersionMismatch(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	addr := "10.0.0.2:514"
	mock.ExpectQuery("SELECT").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusActive, 3)...))
	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()))
	mock.ExpectQuery("SELECT version FROM siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"version"}).AddRow(int64(4)))

	_, err := svc.Update(context.Background(), tenant, id, sources.UpdateInput{Address: &addr}, 2)
	require.ErrorIs(t, err, sources.ErrVersionMismatch)
}

func TestDisable_Idempotent(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	mock.ExpectQuery("SELECT").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusDisabled, 5)...))

	got, err := svc.Disable(context.Background(), tenant, id, "x", 5)
	require.NoError(t, err)
	require.Equal(t, sources.StatusDisabled, got.Status)
}

func TestRotateCert_OutsideWindow(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	// Cert expires in 365d — well outside the 30d rotation window.
	row := sourceRow(tenant, id, "fw", sources.StatusActive, 1)
	expires := time.Now().Add(365 * 24 * time.Hour)
	row[17] = &expires // cert_expires_at
	mock.ExpectQuery("SELECT").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	_, err := svc.RotateCert(context.Background(), tenant, id, false, 1)
	require.ErrorIs(t, err, sources.ErrInvalidState)
}

func TestRotateCert_Force(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	row := sourceRow(tenant, id, "fw", sources.StatusActive, 1)
	expires := time.Now().Add(365 * 24 * time.Hour)
	row[17] = &expires
	mock.ExpectQuery("SELECT").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusRotating, 2)...))
	mock.ExpectExec("INSERT INTO siem.enrollment_tokens").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))

	tok, err := svc.RotateCert(context.Background(), tenant, id, true, 1)
	require.NoError(t, err)
	require.Equal(t, sources.PurposeRotate, tok.Purpose)
}

func TestSoftDelete(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	row := sourceRow(tenant, id, "fw", sources.StatusActive, 1)
	thumb := "ab"
	serial := "sn"
	row[14] = &thumb
	row[15] = &serial
	mock.ExpectQuery("SELECT").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	mock.ExpectExec("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	// AttachCert-like UPDATE for revoke marker
	mock.ExpectExec("INSERT INTO siem.source_cert_revocations").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))
	mock.ExpectExec("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))

	err := svc.SoftDelete(context.Background(), tenant, id, 1)
	require.NoError(t, err)
}

func TestHealth(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	row := sourceRow(tenant, id, "fw", sources.StatusActive, 1)
	mock.ExpectQuery("SELECT").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	mock.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"source_id", "ts", "eps_1min", "eps_5min", "parser_errors_1min", "dropped_1min", "queue_depth", "collector_version"}).
			AddRow(id, time.Now(), 100, 95, 0, 0, 0, ""))
	mock.ExpectQuery("SELECT COALESCE\\(SUM").
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"sum_pe", "sum_d"}).AddRow(0, 0))

	h, err := svc.Health(context.Background(), tenant, id)
	require.NoError(t, err)
	require.Equal(t, sources.StatusActive, h.Status)
}

func TestRecordHeartbeat(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	id := uuid.New()
	mock.ExpectExec("INSERT INTO siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))
	mock.ExpectExec("UPDATE siem.sources SET last_seen_at").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	require.NoError(t, svc.RecordHeartbeat(context.Background(), id, sources.EPSSample{EPS1Min: 100}))
}

func TestEnableDisable_DiffStored(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	row := sourceRow(tenant, id, "fw", sources.StatusActive, 1)
	mock.ExpectQuery("SELECT").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusDisabled, 2)...))

	got, err := svc.Disable(context.Background(), tenant, id, "ops-window", 1)
	require.NoError(t, err)
	require.Equal(t, sources.StatusDisabled, got.Status)
}

func TestWithActor(t *testing.T) {
	actor := uuid.New()
	ctx := WithActor(context.Background(), actor)
	require.Equal(t, actor, ActorFromContext(ctx))
}

func TestEmitAudit_Smoke(t *testing.T) {
	mem := siemaudit.NewInMemory()
	svc := &service{audit: mem, logger: zerolog.Nop()}
	src := &sources.Source{ID: uuid.New(), TenantID: uuid.New()}
	svc.emitAudit(context.Background(), uuid.New(), src, src, map[string]string{"a": "b"}, "siem.source.created")
	require.Equal(t, 1, mem.Len())
	require.True(t, json.Valid(mem.Entries()[0].OldValue))
}
