package integrations

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
)

const uniqueErr = "23505"

func newMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	m, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(m.Close)
	return m
}

func anyArgs(n int) []any {
	args := make([]any, n)
	for i := range args {
		args[i] = pgxmock.AnyArg()
	}
	return args
}

func integrationRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "name", "kind", "vendor", "endpoint", "status", "enabled",
		"encrypted_credentials", "last_tested_at", "last_test_error", "created_at", "updated_at",
	})
}

func TestStore_Create(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	now := time.Now()
	tenantID := uuid.New()
	newID := uuid.New()

	tests := []struct {
		name    string
		setup   func(m pgxmock.PgxPoolIface)
		wantErr error
	}{
		{
			name: "inserts and populates generated fields",
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery("INSERT INTO dr_integration").
					WithArgs(anyArgs(8)...).
					WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
						AddRow(newID, now, now))
			},
		},
		{
			name:    "duplicate name maps to ErrAlreadyExists",
			wantErr: ErrAlreadyExists,
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery("INSERT INTO dr_integration").
					WithArgs(anyArgs(8)...).
					WillReturnError(&pgconn.PgError{Code: uniqueErr})
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			m := newMock(t)
			tc.setup(m)
			rec := &record{
				Integration: Integration{
					TenantID: tenantID, Name: "primary", Kind: KindStorageArray,
					Vendor: "netapp_ontap", Endpoint: "https://array", Enabled: true,
				},
				EncryptedCredentials: []byte("sealed"),
			}
			err := NewStore().Create(ctx, m, rec)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if rec.ID != newID {
				t.Fatalf("id = %q, want %q", rec.ID, newID)
			}
			if rec.Status != StatusConfigured {
				t.Fatalf("status = %q, want configured", rec.Status)
			}
			if e := m.ExpectationsWereMet(); e != nil {
				t.Fatalf("unmet expectations: %v", e)
			}
		})
	}
}

func TestStore_Get_NotFound(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_integration").
		WithArgs(tenantID, id).
		WillReturnError(pgx.ErrNoRows)
	_, err := NewStore().Get(context.Background(), m, tenantID, id)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestStore_Get_DecodesRow(t *testing.T) {
	t.Parallel()
	now := time.Now()
	tenantID := uuid.New()
	id := uuid.New()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_integration").
		WithArgs(tenantID, id).
		WillReturnRows(integrationRows().AddRow(
			id, tenantID, "primary", "storage_array", "netapp_ontap", "https://array",
			"active", true, []byte("sealed"), now, "", now, now))
	rec, err := NewStore().Get(context.Background(), m, tenantID, id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if rec.Kind != KindStorageArray || rec.Status != StatusActive || rec.LastTestedAt == nil {
		t.Fatalf("decoded record wrong: %+v", rec)
	}
	if string(rec.EncryptedCredentials) != "sealed" {
		t.Fatalf("encrypted bundle not returned verbatim")
	}
}

func TestStore_List(t *testing.T) {
	t.Parallel()
	now := time.Now()
	tenantID := uuid.New()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_integration WHERE tenant_id = ").
		WithArgs(tenantID).
		WillReturnRows(integrationRows().AddRow(
			uuid.New(), tenantID, "a", "hypervisor", "vmware_vsphere", "https://vc",
			"configured", true, []byte("x"), nil, "", now, now))
	out, err := NewStore().List(context.Background(), m, tenantID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(out) != 1 || out[0].Vendor != "vmware_vsphere" {
		t.Fatalf("unexpected list: %+v", out)
	}
	if e := m.ExpectationsWereMet(); e != nil {
		t.Fatalf("unmet expectations: %v", e)
	}
}

func TestStore_ResolveActive(t *testing.T) {
	t.Parallel()
	now := time.Now()
	tenantID := uuid.New()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_integration").
		WithArgs(tenantID, "aws_backup").
		WillReturnRows(integrationRows().AddRow(
			uuid.New(), tenantID, "vault", "cloud_vault", "aws_backup", "",
			"active", true, []byte("sealed"), now, "", now, now))
	rec, err := NewStore().ResolveActive(context.Background(), m, tenantID, "aws_backup")
	if err != nil {
		t.Fatalf("ResolveActive: %v", err)
	}
	if rec.Vendor != "aws_backup" || rec.Status != StatusActive {
		t.Fatalf("unexpected active record: %+v", rec)
	}
}

func TestStore_Update_NotFound(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()
	m := newMock(t)
	m.ExpectQuery("UPDATE dr_integration").
		WithArgs(anyArgs(9)...).
		WillReturnError(pgx.ErrNoRows)
	rec := &record{Integration: Integration{TenantID: tenantID, ID: id, Name: "x", Kind: KindKubernetes, Vendor: "k8s", Endpoint: "https://api"}}
	err := NewStore().Update(context.Background(), m, rec)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestStore_Update_DuplicateName(t *testing.T) {
	t.Parallel()
	m := newMock(t)
	m.ExpectQuery("UPDATE dr_integration").
		WithArgs(anyArgs(9)...).
		WillReturnError(&pgconn.PgError{Code: uniqueErr})
	rec := &record{Integration: Integration{TenantID: uuid.New(), ID: uuid.New(), Name: "dup", Kind: KindKubernetes, Vendor: "k8s", Endpoint: "https://api"}}
	err := NewStore().Update(context.Background(), m, rec)
	if !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("err = %v, want ErrAlreadyExists", err)
	}
}

func TestStore_Update_Success(t *testing.T) {
	t.Parallel()
	now := time.Now()
	tenantID := uuid.New()
	id := uuid.New()
	m := newMock(t)
	m.ExpectQuery("UPDATE dr_integration").
		WithArgs(anyArgs(9)...).
		WillReturnRows(integrationRows().AddRow(
			id, tenantID, "renamed", "kubernetes", "k8s", "https://api",
			"configured", false, []byte("new-sealed"), nil, "", now, now))
	rec := &record{Integration: Integration{TenantID: tenantID, ID: id, Name: "renamed", Kind: KindKubernetes, Vendor: "k8s", Endpoint: "https://api"}, EncryptedCredentials: []byte("new-sealed")}
	if err := NewStore().Update(context.Background(), m, rec); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Name != "renamed" || rec.Enabled {
		t.Fatalf("record not refreshed from RETURNING: %+v", rec)
	}
}

func TestStore_Delete(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()

	t.Run("affected", func(t *testing.T) {
		m := newMock(t)
		m.ExpectExec("DELETE FROM dr_integration").
			WithArgs(tenantID, id).
			WillReturnResult(pgxmock.NewResult("DELETE", 1))
		if err := NewStore().Delete(context.Background(), m, tenantID, id); err != nil {
			t.Fatalf("Delete: %v", err)
		}
	})
	t.Run("none affected -> ErrNotFound", func(t *testing.T) {
		m := newMock(t)
		m.ExpectExec("DELETE FROM dr_integration").
			WithArgs(tenantID, id).
			WillReturnResult(pgxmock.NewResult("DELETE", 0))
		if err := NewStore().Delete(context.Background(), m, tenantID, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
	})
}

func TestStore_UpdateTestResult(t *testing.T) {
	t.Parallel()
	now := time.Now()
	tenantID := uuid.New()
	id := uuid.New()
	m := newMock(t)
	m.ExpectQuery("UPDATE dr_integration").
		WithArgs(tenantID, id, "active", "", pgxmock.AnyArg()).
		WillReturnRows(integrationRows().AddRow(
			id, tenantID, "primary", "storage_array", "netapp_ontap", "https://array",
			"active", true, []byte("sealed"), now, "", now, now))
	rec, err := NewStore().UpdateTestResult(context.Background(), m, tenantID, id, "active", "", now)
	if err != nil {
		t.Fatalf("UpdateTestResult: %v", err)
	}
	if rec.Status != StatusActive {
		t.Fatalf("status = %q, want active", rec.Status)
	}
	if e := m.ExpectationsWereMet(); e != nil {
		t.Fatalf("unmet expectations: %v", e)
	}
}
