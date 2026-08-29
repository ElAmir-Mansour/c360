package repo

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func mustMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	m, err := pgxmock.NewPool()
	require.NoError(t, err)
	t.Cleanup(func() { m.Close() })
	return m
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

func TestSourcesRepo_Insert_Success(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)

	tenantID := uuid.New()
	id := uuid.New()
	createdBy := uuid.New()

	mock.ExpectQuery("INSERT INTO siem.sources").
		WithArgs(tenantID, "fw-01", "firewall", "syslog_udp", "10.0.0.1:514", 100,
			"Africa/Lagos", []byte(`{}`), createdBy).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenantID, id, "fw-01", sources.StatusProvisioning, 1)...))

	s, err := r.Insert(context.Background(), sources.OnboardInput{
		TenantID:    tenantID,
		Name:        "fw-01",
		Type:        "firewall",
		Transport:   sources.TransportSyslogUDP,
		Address:     "10.0.0.1:514",
		ExpectedEPS: 100,
		CreatedBy:   createdBy,
	})
	require.NoError(t, err)
	require.Equal(t, sources.StatusProvisioning, s.Status)
	require.Equal(t, "fw-01", s.Name)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSourcesRepo_Insert_DuplicateName(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)

	pgErr := &pgconn.PgError{Code: "23505", ConstraintName: "sources_tenant_name_unique"}
	mock.ExpectQuery("INSERT INTO siem.sources").
		WithArgs(pgxmock.AnyArg(), "dup", "x", "syslog_udp", "h:1", 0, "Africa/Lagos", []byte(`{}`), pgxmock.AnyArg()).
		WillReturnError(pgErr)

	_, err := r.Insert(context.Background(), sources.OnboardInput{
		TenantID:  uuid.New(),
		Name:      "dup",
		Type:      "x",
		Transport: sources.TransportSyslogUDP,
		Address:   "h:1",
		CreatedBy: uuid.New(),
	})
	require.ErrorIs(t, err, sources.ErrConflict)
}

func TestSourcesRepo_GetByID_NotFound(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	tenantID := uuid.New()
	id := uuid.New()

	mock.ExpectQuery("SELECT.*FROM siem.sources").
		WithArgs(id, tenantID).
		WillReturnRows(pgxmock.NewRows(sourceCols()))

	_, err := r.GetByID(context.Background(), tenantID, id)
	require.ErrorIs(t, err, sources.ErrNotFound)
}

func TestSourcesRepo_Update_VersionMismatch(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	tenantID := uuid.New()
	id := uuid.New()
	newType := "switch"

	// First the UPDATE: returns no rows.
	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(id, tenantID, int64(4), "switch").
		WillReturnRows(pgxmock.NewRows(sourceCols()))
	// Then the version-check SELECT.
	mock.ExpectQuery("SELECT version FROM siem.sources").
		WithArgs(id, tenantID).
		WillReturnRows(pgxmock.NewRows([]string{"version"}).AddRow(int64(5)))

	_, err := r.Update(context.Background(), tenantID, id, sources.UpdateInput{
		Type: &newType,
	}, 4)
	require.ErrorIs(t, err, sources.ErrVersionMismatch)
}

func TestSourcesRepo_SetStatus(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	tenantID := uuid.New()
	id := uuid.New()

	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(id, tenantID, int64(3), "active").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenantID, id, "x", sources.StatusActive, 4)...))

	s, err := r.SetStatus(context.Background(), tenantID, id, sources.StatusActive, 3)
	require.NoError(t, err)
	require.Equal(t, sources.StatusActive, s.Status)
}

func TestSourcesRepo_SoftDelete(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	tenantID := uuid.New()
	id := uuid.New()

	mock.ExpectExec("UPDATE siem.sources").
		WithArgs(id, tenantID, int64(1)).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))

	err := r.SoftDelete(context.Background(), tenantID, id, 1)
	require.NoError(t, err)
}

func TestSourcesRepo_List_PaginatesCursor(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	tenantID := uuid.New()

	rows := pgxmock.NewRows(sourceCols())
	for i := 0; i < 3; i++ {
		rows.AddRow(sourceRow(tenantID, uuid.New(), "n", sources.StatusActive, 1)...)
	}
	mock.ExpectQuery("SELECT .*FROM siem.sources").
		WithArgs(tenantID).
		WillReturnRows(rows)

	res, err := r.List(context.Background(), tenantID, sources.ListQuery{Limit: 2})
	require.NoError(t, err)
	require.Len(t, res.Items, 2)
	require.NotEmpty(t, res.NextCursor)
}

func TestSourcesRepo_GetByThumbprint(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	thumb := "deadbeef"

	mock.ExpectQuery("SELECT .*FROM siem.sources").
		WithArgs(thumb).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(uuid.New(), uuid.New(), "x", sources.StatusActive, 1)...))

	s, err := r.GetByThumbprint(context.Background(), thumb)
	require.NoError(t, err)
	require.Equal(t, sources.StatusActive, s.Status)
}

func TestSourcesRepo_InsertCredentials(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	id := uuid.New()
	mock.ExpectExec("INSERT INTO siem.source_credentials").
		WithArgs(id, "pki-x", "ref", "p", "c").
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))
	err := r.InsertCredentials(context.Background(), sources.SourceCredentials{
		SourceID: id, VaultPKIMount: "pki-x", VaultKeyRef: "ref", CertPEM: "p", CAChainPEM: "c",
	})
	require.NoError(t, err)
}

func TestSourcesRepo_AttachCert(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	tenantID := uuid.New()
	id := uuid.New()
	now := time.Now().UTC()

	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(id, tenantID, "thumb", "sn", now, now.Add(time.Hour), "active").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenantID, id, "x", sources.StatusActive, 2)...))

	s, err := r.AttachCert(context.Background(), tenantID, id, "thumb", "sn", now, now.Add(time.Hour), sources.StatusActive)
	require.NoError(t, err)
	require.Equal(t, sources.StatusActive, s.Status)
}

func TestSourcesRepo_NilDB(t *testing.T) {
	r := NewSourcesRepo(nil)
	_, err := r.GetByID(context.Background(), uuid.New(), uuid.New())
	require.Error(t, err)
	require.True(t, errors.Is(err, errors.Unwrap(err)) || err != nil)
}

func TestSourcesRepo_UpdateBaseline(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	id := uuid.New()
	mock.ExpectExec("UPDATE siem.sources").
		WithArgs(id, 100, 60).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	require.NoError(t, r.UpdateBaseline(context.Background(), id, 100, 60))
}

func TestSourcesRepo_CountByTenantStatus(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)

	tenant1 := uuid.New().String()
	mock.ExpectQuery("SELECT tenant_id::text").
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id", "status", "count"}).
			AddRow(tenant1, "active", 3).
			AddRow(tenant1, "silent", 1))

	got, err := r.CountByTenantStatus(context.Background())
	require.NoError(t, err)
	require.Equal(t, 3, got[tenant1][sources.StatusActive])
	require.Equal(t, 1, got[tenant1][sources.StatusSilent])
}

func TestEncodeDecodeCursor(t *testing.T) {
	id := uuid.New()
	now := time.Now().UTC()
	cursor := encodeCursor(now, id)
	ts, gotID, err := decodeCursor(cursor)
	require.NoError(t, err)
	require.Equal(t, id, gotID)
	require.WithinDuration(t, now, ts, time.Microsecond)
}

func TestDecodeCursor_Garbage(t *testing.T) {
	_, _, err := decodeCursor("###not-base64")
	require.Error(t, err)
}

func TestTouchLastSeen(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	id := uuid.New()
	now := time.Now()
	mock.ExpectExec("UPDATE siem.sources").WithArgs(id, now).WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	require.NoError(t, r.TouchLastSeen(context.Background(), id, now))
}

func TestGetByName_Found(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	tenantID := uuid.New()
	id := uuid.New()
	mock.ExpectQuery("SELECT .*FROM siem.sources").
		WithArgs(tenantID, "n1").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenantID, id, "n1", sources.StatusActive, 1)...))
	s, err := r.GetByName(context.Background(), tenantID, "n1")
	require.NoError(t, err)
	require.Equal(t, "n1", s.Name)
}

func TestRoundTripTags(t *testing.T) {
	mock := mustMock(t)
	r := NewSourcesRepo(mock)
	tenantID := uuid.New()
	id := uuid.New()
	tags := json.RawMessage(`{"env":"prod"}`)

	mock.ExpectQuery("INSERT INTO siem.sources").
		WithArgs(tenantID, "n", "t", "syslog_udp", "x:1", 0, "Africa/Lagos", []byte(tags), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenantID, id, "n", sources.StatusProvisioning, 1)...))

	_, err := r.Insert(context.Background(), sources.OnboardInput{
		TenantID: tenantID, Name: "n", Type: "t", Transport: sources.TransportSyslogUDP,
		Address: "x:1", Tags: tags, CreatedBy: uuid.New(),
	})
	require.NoError(t, err)
}
