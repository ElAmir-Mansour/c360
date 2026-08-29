package core

import (
	"fmt"
	"strings"
)

// Nullability describes whether a column accepts NULL values. Unknown means the
// introspector did not provide the property; comparisons skip it unless both
// sides are known.
type Nullability uint8

const (
	NullabilityUnknown Nullability = iota
	NullabilityNullable
	NullabilityNotNull
)

func (n Nullability) valid() bool {
	switch n {
	case NullabilityUnknown, NullabilityNullable, NullabilityNotNull:
		return true
	default:
		return false
	}
}

func (n Nullability) String() string {
	switch n {
	case NullabilityNullable:
		return "NULL"
	case NullabilityNotNull:
		return "NOT NULL"
	default:
		return "UNKNOWN"
	}
}

// ColumnShape is the portable schema description used by DataStream consumers
// before a migration, sync or recovery stream starts moving data.
type ColumnShape struct {
	Name        string
	Type        string
	Nullability Nullability
}

// TableShape is a bounded, database-neutral table schema model. Type and
// nullability are optional so callers can compare name/order/key drift even when
// their source only exposes partial metadata.
type TableShape struct {
	Schema     string
	Table      string
	Columns    []ColumnShape
	PrimaryKey []string
}

// QualifiedName returns schema.table when Schema is present, otherwise table.
func (s TableShape) QualifiedName() string {
	if s.Schema == "" {
		return s.Table
	}
	return s.Schema + "." + s.Table
}

// TableShape converts a PostgreSQL stream config into the shared schema model.
// Column type/nullability are intentionally unknown because PGTableConfig stores
// only the projection DataStream replicates.
func (c PGTableConfig) TableShape() TableShape {
	cols := make([]ColumnShape, len(c.Columns))
	for i, col := range c.Columns {
		cols[i] = ColumnShape{Name: col}
	}
	pk := append([]string(nil), c.PrimaryKey...)
	return TableShape{
		Schema:     c.schema(),
		Table:      c.Table,
		Columns:    cols,
		PrimaryKey: pk,
	}
}

// SchemaDriftKind classifies one schema difference.
type SchemaDriftKind string

const (
	SchemaDriftTable             SchemaDriftKind = "table"
	SchemaDriftMissingColumn     SchemaDriftKind = "missing_column"
	SchemaDriftExtraColumn       SchemaDriftKind = "extra_column"
	SchemaDriftColumnOrder       SchemaDriftKind = "column_order"
	SchemaDriftColumnType        SchemaDriftKind = "column_type"
	SchemaDriftColumnNullability SchemaDriftKind = "column_nullability"
	SchemaDriftPrimaryKey        SchemaDriftKind = "primary_key"
)

// SchemaDrift is one deterministic difference between an expected and observed
// table shape.
type SchemaDrift struct {
	Kind     SchemaDriftKind
	Table    string
	Column   string
	Expected string
	Actual   string
}

func (d SchemaDrift) String() string {
	target := d.Table
	if d.Column != "" {
		target += "." + d.Column
	}
	switch d.Kind {
	case SchemaDriftMissingColumn:
		return fmt.Sprintf("%s missing column %q", d.Table, d.Column)
	case SchemaDriftExtraColumn:
		return fmt.Sprintf("%s extra column %q", d.Table, d.Column)
	case SchemaDriftColumnOrder:
		return fmt.Sprintf("%s column order expected [%s] actual [%s]", d.Table, d.Expected, d.Actual)
	case SchemaDriftPrimaryKey:
		return fmt.Sprintf("%s primary key expected [%s] actual [%s]", d.Table, d.Expected, d.Actual)
	default:
		return fmt.Sprintf("%s %s expected %q actual %q", target, d.Kind, d.Expected, d.Actual)
	}
}

// SchemaDriftReport is returned as an error by ValidateTableShape when drift is
// present. It wraps ErrSchemaDrift so callers can use errors.Is.
type SchemaDriftReport struct {
	Expected TableShape
	Actual   TableShape
	Drifts   []SchemaDrift
}

func (r SchemaDriftReport) HasDrift() bool {
	return len(r.Drifts) > 0
}

func (r SchemaDriftReport) Error() string {
	if !r.HasDrift() {
		return "core: no schema drift"
	}
	parts := make([]string, len(r.Drifts))
	for i, drift := range r.Drifts {
		parts[i] = drift.String()
	}
	return fmt.Sprintf("core: schema drift detected: %s", strings.Join(parts, "; "))
}

func (r SchemaDriftReport) Unwrap() error {
	if !r.HasDrift() {
		return nil
	}
	return ErrSchemaDrift
}

// CompareTableShape compares expected and actual table shape and returns a
// deterministic report. Invalid models are returned as configuration errors,
// not schema drift.
func CompareTableShape(expected, actual TableShape) (SchemaDriftReport, error) {
	report := SchemaDriftReport{Expected: cloneTableShape(expected), Actual: cloneTableShape(actual)}
	if err := validateTableShape(expected, "expected"); err != nil {
		return report, err
	}
	if err := validateTableShape(actual, "actual"); err != nil {
		return report, err
	}

	table := expected.QualifiedName()
	if table != actual.QualifiedName() {
		report.Drifts = append(report.Drifts, SchemaDrift{
			Kind:     SchemaDriftTable,
			Table:    table,
			Expected: expected.QualifiedName(),
			Actual:   actual.QualifiedName(),
		})
	}

	expectedIndex := columnIndex(expected.Columns)
	actualIndex := columnIndex(actual.Columns)
	for _, col := range expected.Columns {
		actualPos, ok := actualIndex[col.Name]
		if !ok {
			report.Drifts = append(report.Drifts, SchemaDrift{
				Kind:   SchemaDriftMissingColumn,
				Table:  table,
				Column: col.Name,
			})
			continue
		}
		actualCol := actual.Columns[actualPos]
		if columnTypesDiffer(col.Type, actualCol.Type) {
			report.Drifts = append(report.Drifts, SchemaDrift{
				Kind:     SchemaDriftColumnType,
				Table:    table,
				Column:   col.Name,
				Expected: strings.TrimSpace(col.Type),
				Actual:   strings.TrimSpace(actualCol.Type),
			})
		}
		if col.Nullability != NullabilityUnknown &&
			actualCol.Nullability != NullabilityUnknown &&
			col.Nullability != actualCol.Nullability {
			report.Drifts = append(report.Drifts, SchemaDrift{
				Kind:     SchemaDriftColumnNullability,
				Table:    table,
				Column:   col.Name,
				Expected: col.Nullability.String(),
				Actual:   actualCol.Nullability.String(),
			})
		}
	}

	for _, col := range actual.Columns {
		if _, ok := expectedIndex[col.Name]; !ok {
			report.Drifts = append(report.Drifts, SchemaDrift{
				Kind:   SchemaDriftExtraColumn,
				Table:  table,
				Column: col.Name,
			})
		}
	}

	if sameColumnSet(expectedIndex, actualIndex) && !equalStringSlice(columnNames(expected.Columns), columnNames(actual.Columns)) {
		report.Drifts = append(report.Drifts, SchemaDrift{
			Kind:     SchemaDriftColumnOrder,
			Table:    table,
			Expected: strings.Join(columnNames(expected.Columns), ","),
			Actual:   strings.Join(columnNames(actual.Columns), ","),
		})
	}

	if !equalStringSlice(expected.PrimaryKey, actual.PrimaryKey) {
		report.Drifts = append(report.Drifts, SchemaDrift{
			Kind:     SchemaDriftPrimaryKey,
			Table:    table,
			Expected: strings.Join(expected.PrimaryKey, ","),
			Actual:   strings.Join(actual.PrimaryKey, ","),
		})
	}

	return report, nil
}

// ValidateTableShape returns nil when shapes match, a SchemaDriftReport wrapping
// ErrSchemaDrift when they do not, or a model validation error for invalid input.
func ValidateTableShape(expected, actual TableShape) error {
	report, err := CompareTableShape(expected, actual)
	if err != nil {
		return err
	}
	if report.HasDrift() {
		return report
	}
	return nil
}

func validateTableShape(shape TableShape, label string) error {
	if strings.TrimSpace(shape.Table) == "" {
		return fmt.Errorf("core: %s table shape requires a table", label)
	}
	if len(shape.Columns) == 0 {
		return fmt.Errorf("core: %s table shape requires columns", label)
	}
	seen := make(map[string]struct{}, len(shape.Columns))
	for _, col := range shape.Columns {
		if strings.TrimSpace(col.Name) == "" {
			return fmt.Errorf("core: %s table shape has an empty column name", label)
		}
		if _, ok := seen[col.Name]; ok {
			return fmt.Errorf("core: %s table shape has duplicate column %q", label, col.Name)
		}
		if !col.Nullability.valid() {
			return fmt.Errorf("core: %s table shape column %q has invalid nullability %d", label, col.Name, col.Nullability)
		}
		seen[col.Name] = struct{}{}
	}
	seenPK := make(map[string]struct{}, len(shape.PrimaryKey))
	for _, pk := range shape.PrimaryKey {
		if strings.TrimSpace(pk) == "" {
			return fmt.Errorf("core: %s table shape has an empty primary-key column", label)
		}
		if _, ok := seenPK[pk]; ok {
			return fmt.Errorf("core: %s table shape has duplicate primary-key column %q", label, pk)
		}
		if _, ok := seen[pk]; !ok {
			return fmt.Errorf("core: %s table shape primary-key column %q is not in Columns", label, pk)
		}
		seenPK[pk] = struct{}{}
	}
	return nil
}

func cloneTableShape(shape TableShape) TableShape {
	clone := TableShape{
		Schema:     shape.Schema,
		Table:      shape.Table,
		Columns:    append([]ColumnShape(nil), shape.Columns...),
		PrimaryKey: append([]string(nil), shape.PrimaryKey...),
	}
	return clone
}

func columnIndex(cols []ColumnShape) map[string]int {
	out := make(map[string]int, len(cols))
	for i, col := range cols {
		out[col.Name] = i
	}
	return out
}

func columnNames(cols []ColumnShape) []string {
	out := make([]string, len(cols))
	for i, col := range cols {
		out[i] = col.Name
	}
	return out
}

func sameColumnSet(a, b map[string]int) bool {
	if len(a) != len(b) {
		return false
	}
	for name := range a {
		if _, ok := b[name]; !ok {
			return false
		}
	}
	return true
}

func columnTypesDiffer(expected, actual string) bool {
	expected = normalizeColumnType(expected)
	actual = normalizeColumnType(actual)
	return expected != "" && actual != "" && expected != actual
}

func normalizeColumnType(t string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(t))), " ")
}
