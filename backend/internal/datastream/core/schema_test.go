package core

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestCompareTableShape_NoDrift(t *testing.T) {
	t.Parallel()

	expected := TableShape{
		Schema: "public",
		Table:  "account",
		Columns: []ColumnShape{
			{Name: "id", Type: "uuid", Nullability: NullabilityNotNull},
			{Name: "email", Type: "text", Nullability: NullabilityNotNull},
			{Name: "updated_at", Type: "timestamp with time zone", Nullability: NullabilityNotNull},
		},
		PrimaryKey: []string{"id"},
	}
	actual := TableShape{
		Schema: "public",
		Table:  "account",
		Columns: []ColumnShape{
			{Name: "id", Type: " UUID ", Nullability: NullabilityNotNull},
			{Name: "email", Type: "TEXT", Nullability: NullabilityNotNull},
			{Name: "updated_at", Type: "timestamp   with   time   zone", Nullability: NullabilityNotNull},
		},
		PrimaryKey: []string{"id"},
	}

	report, err := CompareTableShape(expected, actual)
	if err != nil {
		t.Fatalf("CompareTableShape: %v", err)
	}
	if report.HasDrift() {
		t.Fatalf("HasDrift = true, drifts = %#v", report.Drifts)
	}
	if err := ValidateTableShape(expected, actual); err != nil {
		t.Fatalf("ValidateTableShape: %v", err)
	}
}

func TestCompareTableShape_DetectsSchemaDriftDeterministically(t *testing.T) {
	t.Parallel()

	expected := TableShape{
		Schema: "public",
		Table:  "account",
		Columns: []ColumnShape{
			{Name: "id", Type: "uuid", Nullability: NullabilityNotNull},
			{Name: "email", Type: "text", Nullability: NullabilityNotNull},
			{Name: "balance", Type: "numeric", Nullability: NullabilityNullable},
			{Name: "updated_at", Type: "timestamptz", Nullability: NullabilityNotNull},
		},
		PrimaryKey: []string{"id"},
	}
	actual := TableShape{
		Schema: "public",
		Table:  "account",
		Columns: []ColumnShape{
			{Name: "id", Type: "uuid", Nullability: NullabilityNotNull},
			{Name: "balance", Type: "numeric(20,2)", Nullability: NullabilityNullable},
			{Name: "updated_at", Type: "timestamptz", Nullability: NullabilityNullable},
			{Name: "display_name", Type: "text", Nullability: NullabilityNullable},
		},
		PrimaryKey: []string{"id", "updated_at"},
	}

	report, err := CompareTableShape(expected, actual)
	if err != nil {
		t.Fatalf("CompareTableShape: %v", err)
	}
	want := []SchemaDrift{
		{Kind: SchemaDriftMissingColumn, Table: "public.account", Column: "email"},
		{Kind: SchemaDriftColumnType, Table: "public.account", Column: "balance", Expected: "numeric", Actual: "numeric(20,2)"},
		{Kind: SchemaDriftColumnNullability, Table: "public.account", Column: "updated_at", Expected: "NOT NULL", Actual: "NULL"},
		{Kind: SchemaDriftExtraColumn, Table: "public.account", Column: "display_name"},
		{Kind: SchemaDriftPrimaryKey, Table: "public.account", Expected: "id", Actual: "id,updated_at"},
	}
	if !reflect.DeepEqual(report.Drifts, want) {
		t.Fatalf("drifts = %#v, want %#v", report.Drifts, want)
	}

	err = ValidateTableShape(expected, actual)
	if !errors.Is(err, ErrSchemaDrift) {
		t.Fatalf("ValidateTableShape err = %v, want ErrSchemaDrift", err)
	}
	var reportErr SchemaDriftReport
	if !errors.As(err, &reportErr) {
		t.Fatalf("ValidateTableShape err = %T, want SchemaDriftReport", err)
	}
	if !strings.Contains(err.Error(), `public.account missing column "email"`) {
		t.Fatalf("error %q does not include missing-column detail", err.Error())
	}
}

func TestCompareTableShape_DetectsOrderOnlyWhenColumnSetMatches(t *testing.T) {
	t.Parallel()

	expected := TableShape{
		Schema: "public",
		Table:  "account",
		Columns: []ColumnShape{
			{Name: "id"},
			{Name: "email"},
			{Name: "updated_at"},
		},
		PrimaryKey: []string{"id"},
	}
	actual := TableShape{
		Schema: "public",
		Table:  "account",
		Columns: []ColumnShape{
			{Name: "email"},
			{Name: "id"},
			{Name: "updated_at"},
		},
		PrimaryKey: []string{"id"},
	}

	report, err := CompareTableShape(expected, actual)
	if err != nil {
		t.Fatalf("CompareTableShape: %v", err)
	}
	want := []SchemaDrift{{
		Kind:     SchemaDriftColumnOrder,
		Table:    "public.account",
		Expected: "id,email,updated_at",
		Actual:   "email,id,updated_at",
	}}
	if !reflect.DeepEqual(report.Drifts, want) {
		t.Fatalf("drifts = %#v, want %#v", report.Drifts, want)
	}
}

func TestCompareTableShape_TableIdentityDrift(t *testing.T) {
	t.Parallel()

	expected := TableShape{
		Schema:     "public",
		Table:      "account",
		Columns:    []ColumnShape{{Name: "id"}},
		PrimaryKey: []string{"id"},
	}
	actual := TableShape{
		Schema:     "archive",
		Table:      "account_v2",
		Columns:    []ColumnShape{{Name: "id"}},
		PrimaryKey: []string{"id"},
	}

	report, err := CompareTableShape(expected, actual)
	if err != nil {
		t.Fatalf("CompareTableShape: %v", err)
	}
	if len(report.Drifts) != 1 {
		t.Fatalf("drifts = %#v, want one table drift", report.Drifts)
	}
	got := report.Drifts[0]
	if got.Kind != SchemaDriftTable || got.Expected != "public.account" || got.Actual != "archive.account_v2" {
		t.Fatalf("table drift = %#v", got)
	}
}

func TestCompareTableShape_RejectsInvalidModels(t *testing.T) {
	t.Parallel()

	valid := TableShape{
		Table:      "account",
		Columns:    []ColumnShape{{Name: "id"}},
		PrimaryKey: []string{"id"},
	}
	cases := []struct {
		name     string
		expected TableShape
		actual   TableShape
		want     string
	}{
		{
			name:     "expected missing table",
			expected: TableShape{Columns: []ColumnShape{{Name: "id"}}},
			actual:   valid,
			want:     "expected table shape requires a table",
		},
		{
			name:     "actual duplicate column",
			expected: valid,
			actual: TableShape{
				Table:   "account",
				Columns: []ColumnShape{{Name: "id"}, {Name: "id"}},
			},
			want: "actual table shape has duplicate column",
		},
		{
			name:     "invalid primary key",
			expected: valid,
			actual:   TableShape{Table: "account", Columns: []ColumnShape{{Name: "id"}}, PrimaryKey: []string{"missing"}},
			want:     `actual table shape primary-key column "missing" is not in Columns`,
		},
		{
			name:     "invalid nullability",
			expected: valid,
			actual:   TableShape{Table: "account", Columns: []ColumnShape{{Name: "id", Nullability: Nullability(99)}}},
			want:     `actual table shape column "id" has invalid nullability 99`,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := CompareTableShape(tc.expected, tc.actual)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("CompareTableShape err = %v, want containing %q", err, tc.want)
			}
			if errors.Is(err, ErrSchemaDrift) {
				t.Fatalf("invalid model error wraps ErrSchemaDrift: %v", err)
			}
		})
	}
}

func TestPGTableConfig_TableShape(t *testing.T) {
	t.Parallel()

	cfg := PGTableConfig{
		Table:      "account",
		Columns:    []string{"id", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	}
	shape := cfg.TableShape()
	if shape.QualifiedName() != "public.account" {
		t.Fatalf("QualifiedName = %q, want public.account", shape.QualifiedName())
	}
	wantCols := []ColumnShape{{Name: "id"}, {Name: "updated_at"}}
	if !reflect.DeepEqual(shape.Columns, wantCols) {
		t.Fatalf("Columns = %#v, want %#v", shape.Columns, wantCols)
	}
	if !reflect.DeepEqual(shape.PrimaryKey, []string{"id"}) {
		t.Fatalf("PrimaryKey = %#v, want [id]", shape.PrimaryKey)
	}

	cfg.Columns[0] = "mutated"
	cfg.PrimaryKey[0] = "mutated"
	if shape.Columns[0].Name != "id" || shape.PrimaryKey[0] != "id" {
		t.Fatalf("TableShape aliased PGTableConfig slices: %#v / %#v", shape.Columns, shape.PrimaryKey)
	}
}
