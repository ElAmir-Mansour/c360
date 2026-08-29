package forms

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	tenantA = "aaaaaaaa-0000-0000-0000-000000000001"
	formID  = "11111111-0000-0000-0000-000000000001"
	tsZ     = "2026-06-13T10:00:00.000000Z"
)

func newMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func errNoRows() error { return pgx.ErrNoRows }

func uniqueViolation() error {
	return &pgconn.PgError{Code: "23505", Message: "duplicate key value violates unique constraint"}
}

// validDef returns a structurally valid definition ready for Create/Update.
func validDef() *FormDefinition {
	return &FormDefinition{
		TenantID: tenantA, Name: "intake", Version: 1,
		Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "title", Type: FieldText, Label: bi("العنوان", "Title")},
		},
	}
}

func TestStore_Create(t *testing.T) {
	t.Parallel()

	t.Run("inserts and returns generated columns", func(t *testing.T) {
		mock := newMock(t)
		mock.ExpectQuery(`INSERT INTO workflow_forms`).
			WithArgs(tenantA, "intake", 1, pgxmock.AnyArg()).
			WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
				AddRow(formID, tsZ, tsZ))

		got, err := NewStore().Create(context.Background(), mock, validDef())
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if got.ID != formID || got.CreatedAt != tsZ {
			t.Fatalf("got %+v", got)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("unique violation maps to ErrConflict", func(t *testing.T) {
		mock := newMock(t)
		mock.ExpectQuery(`INSERT INTO workflow_forms`).
			WithArgs(tenantA, "intake", 1, pgxmock.AnyArg()).
			WillReturnError(uniqueViolation())

		_, err := NewStore().Create(context.Background(), mock, validDef())
		if !errors.Is(err, ErrConflict) {
			t.Fatalf("err = %v, want ErrConflict", err)
		}
	})

	t.Run("structurally invalid definition is rejected before SQL", func(t *testing.T) {
		mock := newMock(t)
		bad := validDef()
		bad.Fields[0].Label = bi("", "Title") // missing AR
		// No ExpectQuery: Create must not touch the DB.
		_, err := NewStore().Create(context.Background(), mock, bad)
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("err = %v, want ErrInvalid", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("version defaults to 1 when unset", func(t *testing.T) {
		mock := newMock(t)
		def := validDef()
		def.Version = 0
		mock.ExpectQuery(`INSERT INTO workflow_forms`).
			WithArgs(tenantA, "intake", 1, pgxmock.AnyArg()).
			WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
				AddRow(formID, tsZ, tsZ))
		got, err := NewStore().Create(context.Background(), mock, def)
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if got.Version != 1 {
			t.Fatalf("version = %d, want 1", got.Version)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

// bodyJSON is a minimal valid JSONB body the SELECT mocks return.
const bodyJSON = `{"locales":["ar","en"],"default_locale":"en","fields":[{"name":"title","type":"text","label":{"ar":"العنوان","en":"Title"},"required":false}]}`

func selectRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{"id", "tenant_id", "name", "version", "fields", "created_at", "updated_at"}).
		AddRow(formID, tenantA, "intake", 1, []byte(bodyJSON), tsZ, tsZ)
}

func TestStore_GetByID(t *testing.T) {
	t.Parallel()

	t.Run("found decodes body", func(t *testing.T) {
		mock := newMock(t)
		mock.ExpectQuery(`SELECT .* FROM workflow_forms WHERE id = \$1`).
			WithArgs(formID).
			WillReturnRows(selectRows())

		fd, err := NewStore().GetByID(context.Background(), mock, formID)
		if err != nil {
			t.Fatalf("GetByID: %v", err)
		}
		if fd.Name != "intake" || len(fd.Fields) != 1 || fd.Fields[0].Name != "title" {
			t.Fatalf("decoded = %+v", fd)
		}
		if fd.Fields[0].Label.AR != "العنوان" {
			t.Fatalf("label = %+v", fd.Fields[0].Label)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("missing maps to ErrNotFound", func(t *testing.T) {
		mock := newMock(t)
		mock.ExpectQuery(`SELECT .* FROM workflow_forms WHERE id = \$1`).
			WithArgs(formID).
			WillReturnError(errNoRows())
		_, err := NewStore().GetByID(context.Background(), mock, formID)
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
	})
}

func TestStore_GetByNameVersion(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	mock.ExpectQuery(`SELECT .* FROM workflow_forms WHERE name = \$1 AND version = \$2`).
		WithArgs("intake", 1).
		WillReturnRows(selectRows())
	fd, err := NewStore().GetByNameVersion(context.Background(), mock, "intake", 1)
	if err != nil {
		t.Fatalf("GetByNameVersion: %v", err)
	}
	if fd.Version != 1 {
		t.Fatalf("version = %d", fd.Version)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_GetLatest(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	mock.ExpectQuery(`SELECT .* FROM workflow_forms WHERE name = \$1\s+ORDER BY version DESC LIMIT 1`).
		WithArgs("intake").
		WillReturnRows(selectRows())
	fd, err := NewStore().GetLatest(context.Background(), mock, "intake")
	if err != nil {
		t.Fatalf("GetLatest: %v", err)
	}
	if fd.Name != "intake" {
		t.Fatalf("name = %q", fd.Name)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_List(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	rows := pgxmock.NewRows([]string{"id", "tenant_id", "name", "version", "fields", "created_at", "updated_at"}).
		AddRow(formID, tenantA, "intake", 2, []byte(bodyJSON), tsZ, tsZ).
		AddRow("22222222-0000-0000-0000-000000000002", tenantA, "intake", 1, []byte(bodyJSON), tsZ, tsZ)
	mock.ExpectQuery(`SELECT .* FROM workflow_forms ORDER BY name ASC, version DESC`).
		WillReturnRows(rows)

	out, err := NewStore().List(context.Background(), mock)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(out) != 2 || out[0].Version != 2 || out[1].Version != 1 {
		t.Fatalf("list = %+v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_UpdateBody(t *testing.T) {
	t.Parallel()

	t.Run("updates and returns row", func(t *testing.T) {
		mock := newMock(t)
		def := validDef()
		def.ID = formID
		mock.ExpectQuery(`UPDATE workflow_forms\s+SET fields = \$2, updated_at = now\(\)\s+WHERE id = \$1`).
			WithArgs(formID, pgxmock.AnyArg()).
			WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "version", "created_at", "updated_at"}).
				AddRow(formID, tenantA, "intake", 1, tsZ, tsZ))

		got, err := NewStore().UpdateBody(context.Background(), mock, def)
		if err != nil {
			t.Fatalf("UpdateBody: %v", err)
		}
		if got.ID != formID || got.Name != "intake" {
			t.Fatalf("got %+v", got)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("missing row maps to ErrNotFound", func(t *testing.T) {
		mock := newMock(t)
		def := validDef()
		def.ID = formID
		mock.ExpectQuery(`UPDATE workflow_forms`).
			WithArgs(formID, pgxmock.AnyArg()).
			WillReturnError(errNoRows())
		_, err := NewStore().UpdateBody(context.Background(), mock, def)
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("invalid definition rejected before SQL", func(t *testing.T) {
		mock := newMock(t)
		def := validDef()
		def.ID = formID
		def.Fields[0].Label = bi("العنوان", "") // missing EN
		_, err := NewStore().UpdateBody(context.Background(), mock, def)
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("err = %v, want ErrInvalid", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestStore_Delete(t *testing.T) {
	t.Parallel()

	t.Run("deletes existing", func(t *testing.T) {
		mock := newMock(t)
		mock.ExpectExec(`DELETE FROM workflow_forms WHERE id = \$1`).
			WithArgs(formID).
			WillReturnResult(pgxmock.NewResult("DELETE", 1))
		if err := NewStore().Delete(context.Background(), mock, formID); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("no row maps to ErrNotFound", func(t *testing.T) {
		mock := newMock(t)
		mock.ExpectExec(`DELETE FROM workflow_forms WHERE id = \$1`).
			WithArgs(formID).
			WillReturnResult(pgxmock.NewResult("DELETE", 0))
		err := NewStore().Delete(context.Background(), mock, formID)
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
	})
}

// Guard against an accidental SQL regex typo in selectColumns by asserting it
// references the to_char timestamp projection the scanner expects.
func TestSelectColumns_TimestampProjection(t *testing.T) {
	t.Parallel()
	if !regexp.MustCompile(`to_char\(created_at`).MatchString(selectColumns) {
		t.Fatalf("selectColumns missing created_at projection: %q", selectColumns)
	}
}
