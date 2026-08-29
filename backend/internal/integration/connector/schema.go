package connector

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// UnknownFieldPolicy controls how ValidateAgainstSchema treats config keys that
// are not declared in the schema.
type UnknownFieldPolicy int

const (
	// RejectUnknownFields makes any undeclared key a validation error. This is
	// the strict default used by ValidateAgainstSchema.
	RejectUnknownFields UnknownFieldPolicy = iota
	// IgnoreUnknownFields silently allows undeclared keys (useful for forward
	// compatibility where newer configs carry fields an older binary doesn't
	// know about yet).
	IgnoreUnknownFields
)

// SchemaError aggregates every field-level violation found in a single
// validation pass so callers see all problems at once rather than the first.
// It implements error and unwraps to its constituent errors.
type SchemaError struct {
	Violations []error
}

// Error renders all violations, sorted for deterministic output, as a single
// semicolon-separated string prefixed with the violation count.
func (e *SchemaError) Error() string {
	if e == nil || len(e.Violations) == 0 {
		return "config validation failed: no violations"
	}
	msgs := make([]string, 0, len(e.Violations))
	for _, v := range e.Violations {
		msgs = append(msgs, v.Error())
	}
	sort.Strings(msgs)
	noun := "violation"
	if len(msgs) != 1 {
		noun = "violations"
	}
	return fmt.Sprintf("config validation failed (%d %s): %s", len(msgs), noun, strings.Join(msgs, "; "))
}

// Unwrap exposes the individual violations to errors.Is / errors.As.
func (e *SchemaError) Unwrap() []error {
	if e == nil {
		return nil
	}
	return e.Violations
}

// newSchemaError returns a *SchemaError if any violations were collected, or
// nil if the slice is empty (so callers can `return newSchemaError(v)` cleanly).
func newSchemaError(violations []error) error {
	if len(violations) == 0 {
		return nil
	}
	return &SchemaError{Violations: violations}
}

// ValidateAgainstSchema validates cfg against schema with the strict default
// policy (unknown fields rejected). It is the convenience entry point used by
// connectors' ValidateConfig.
func ValidateAgainstSchema(schema []FieldSpec, cfg map[string]any) error {
	return ValidateAgainstSchemaPolicy(schema, cfg, RejectUnknownFields)
}

// ValidateAgainstSchemaPolicy validates cfg against schema, controlling unknown
// field handling via policy. It returns a *SchemaError listing every violation
// (missing required field, type mismatch, bad enum value, unknown field), or
// nil if cfg is valid. Int fields decoded from JSON as float64 are accepted and
// validated as integers (no fractional part).
func ValidateAgainstSchemaPolicy(schema []FieldSpec, cfg map[string]any, policy UnknownFieldPolicy) error {
	if cfg == nil {
		cfg = map[string]any{}
	}

	var violations []error

	known := make(map[string]FieldSpec, len(schema))
	for _, f := range schema {
		known[f.Name] = f
	}

	// Check each declared field.
	for _, f := range schema {
		value, present := cfg[f.Name]

		if !present || isEmptyValue(value) {
			if f.Required {
				violations = append(violations, fmt.Errorf("field %q is required", f.Name))
			}
			// Absent-and-optional, or empty-and-optional: nothing else to check.
			continue
		}

		if err := validateFieldValue(f, value); err != nil {
			violations = append(violations, err)
		}
	}

	// Detect unknown fields if the policy rejects them.
	if policy == RejectUnknownFields {
		for key := range cfg {
			if _, ok := known[key]; !ok {
				violations = append(violations, fmt.Errorf("field %q is not allowed (unknown field)", key))
			}
		}
	}

	return newSchemaError(violations)
}

// validateFieldValue checks a single present, non-empty value against its spec.
func validateFieldValue(f FieldSpec, value any) error {
	switch f.Type {
	case FieldTypeString, FieldTypeSecret:
		if _, ok := value.(string); !ok {
			return fmt.Errorf("field %q must be a string, got %s", f.Name, typeName(value))
		}
	case FieldTypeBool:
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("field %q must be a bool, got %s", f.Name, typeName(value))
		}
	case FieldTypeInt:
		if _, ok := coerceInt(value); !ok {
			return fmt.Errorf("field %q must be an integer, got %s", f.Name, typeName(value))
		}
	case FieldTypeEnum:
		s, ok := value.(string)
		if !ok {
			return fmt.Errorf("field %q must be a string (enum), got %s", f.Name, typeName(value))
		}
		if !enumContains(f.Enum, s) {
			return fmt.Errorf("field %q must be one of [%s], got %q", f.Name, strings.Join(f.Enum, ", "), s)
		}
	case FieldTypeObject:
		if !isObjectLike(value) {
			return fmt.Errorf("field %q must be an object, got %s", f.Name, typeName(value))
		}
	default:
		return fmt.Errorf("field %q has unsupported schema type %q", f.Name, f.Type)
	}
	return nil
}

// SanitizeBySchema returns a copy of cfg in which every Secret field (per the
// schema) is masked using maskSecretValue, mirroring the existing
// service.SanitizeConfig mask style (keep first/last 4, stars in between).
// Non-secret values are copied through unchanged. Unknown keys are preserved
// (sanitization never drops data) but, defensively, any unknown key whose name
// looks secret-like is also masked. Object values are deep-copied so the
// returned map is safe to mutate independently of cfg.
func SanitizeBySchema(schema []FieldSpec, cfg map[string]any) map[string]any {
	if cfg == nil {
		return map[string]any{}
	}

	secretByName := make(map[string]bool, len(schema))
	for _, f := range schema {
		if f.IsSecret() {
			secretByName[f.Name] = true
		}
	}

	result := make(map[string]any, len(cfg))
	for key, value := range cfg {
		switch {
		case secretByName[key]:
			result[key] = maskAnySecret(value)
		case looksSecretLike(key):
			// Defensive: an undeclared but secret-looking key is masked too,
			// matching the heuristic in service.SanitizeConfig.
			result[key] = maskAnySecret(value)
		default:
			result[key] = deepCopyValue(value)
		}
	}
	return result
}

// ApplyDefaults returns a copy of cfg with each schema field that is absent (or
// present-but-empty) populated from its FieldSpec.Default, when a default is
// declared. Existing non-empty values are preserved. Int defaults supplied as
// float64 (the JSON shape) are normalized to int. The input map is never
// mutated.
func ApplyDefaults(schema []FieldSpec, cfg map[string]any) map[string]any {
	result := make(map[string]any, len(cfg)+len(schema))
	for k, v := range cfg {
		result[k] = v
	}

	for _, f := range schema {
		if f.Default == nil {
			continue
		}
		existing, present := result[f.Name]
		if present && !isEmptyValue(existing) {
			continue
		}
		result[f.Name] = normalizeDefault(f, f.Default)
	}
	return result
}

// normalizeDefault coerces a declared default into the shape that matches the
// field's type, so that e.g. an int field defaulted from a JSON-decoded
// float64 ends up as an int.
func normalizeDefault(f FieldSpec, def any) any {
	if f.Type == FieldTypeInt {
		if n, ok := coerceInt(def); ok {
			return n
		}
	}
	return def
}

// --- helpers ---------------------------------------------------------------

// coerceInt accepts Go integer kinds and JSON float64 (with no fractional
// part) and returns the integer value. It rejects fractional floats and
// non-numeric values. This is the int-from-float coercion required because
// config arrives decoded from JSON.
func coerceInt(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int32:
		return int(v), true
	case int64:
		return int(v), true
	case float64:
		if v != math.Trunc(v) || math.IsInf(v, 0) || math.IsNaN(v) {
			return 0, false
		}
		return int(v), true
	case float32:
		f := float64(v)
		if f != math.Trunc(f) {
			return 0, false
		}
		return int(f), true
	default:
		return 0, false
	}
}

// isEmptyValue reports whether a value should be treated as "not provided" for
// the purposes of required-checks and default-application. Empty strings,
// empty objects and nil are empty; zero ints and false bools are NOT empty
// (they are legitimate provided values).
func isEmptyValue(value any) bool {
	switch v := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(v) == ""
	case map[string]any:
		return len(v) == 0
	case map[string]string:
		return len(v) == 0
	case []any:
		return len(v) == 0
	default:
		return false
	}
}

// isObjectLike reports whether value is a JSON object or one of the convenience
// map shapes the existing configs use (map[string]string for headers/mappings).
func isObjectLike(value any) bool {
	switch value.(type) {
	case map[string]any, map[string]string:
		return true
	default:
		return false
	}
}

// enumContains reports whether s is a member of enum (case-sensitive).
func enumContains(enum []string, s string) bool {
	for _, e := range enum {
		if e == s {
			return true
		}
	}
	return false
}

// looksSecretLike mirrors service.isSecretLikeKey so sanitization of undeclared
// keys is consistent with the legacy heuristic.
func looksSecretLike(key string) bool {
	lower := strings.ToLower(key)
	for _, fragment := range []string{"token", "secret", "password", "key", "authorization"} {
		if strings.Contains(lower, fragment) {
			return true
		}
	}
	return false
}

// maskAnySecret masks a secret value. Strings are masked with maskSecretValue;
// non-strings (e.g. a secret nested object) are replaced with a constant
// redaction marker so no secret material leaks.
func maskAnySecret(value any) any {
	if s, ok := value.(string); ok {
		return maskSecretValue(s)
	}
	if value == nil {
		return ""
	}
	return "[REDACTED]"
}

// maskSecretValue masks a secret string exactly as service.maskSecret does:
// strings of length <= 8 become all stars; longer strings keep their first and
// last 4 characters with stars in between.
func maskSecretValue(secret string) string {
	if secret == "" {
		return ""
	}
	if len(secret) <= 8 {
		return strings.Repeat("*", len(secret))
	}
	return secret[:4] + strings.Repeat("*", len(secret)-8) + secret[len(secret)-4:]
}

// deepCopyValue returns a structurally-independent copy of value for the maps
// and slices the config may hold, so the sanitized output cannot alias the
// caller's config. Scalars are returned as-is (immutable).
func deepCopyValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, item := range v {
			out[k] = deepCopyValue(item)
		}
		return out
	case map[string]string:
		out := make(map[string]string, len(v))
		for k, item := range v {
			out[k] = item
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = deepCopyValue(item)
		}
		return out
	default:
		return v
	}
}

// typeName returns a short human-readable name for a value's dynamic type,
// used in validation messages.
func typeName(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "bool"
	case float64, float32:
		return "number"
	case int, int32, int64:
		return "int"
	case map[string]any, map[string]string:
		return "object"
	case []any:
		return "array"
	default:
		return fmt.Sprintf("%T", value)
	}
}

// validateManifest enforces internal consistency of a Manifest. It is exported
// indirectly through Manifest.Validate and used by Registry.Register.
func validateManifest(m Manifest) error {
	var violations []error

	if strings.TrimSpace(m.Type) == "" {
		violations = append(violations, errors.New("manifest type must not be empty"))
	}
	if strings.TrimSpace(m.DisplayName) == "" {
		violations = append(violations, fmt.Errorf("manifest %q: display_name must not be empty", m.Type))
	}
	if !m.Capabilities.Valid() {
		violations = append(violations, fmt.Errorf("manifest %q: invalid capabilities %q", m.Type, m.Capabilities))
	}

	seen := make(map[string]bool, len(m.ConfigSchema))
	for _, f := range m.ConfigSchema {
		if strings.TrimSpace(f.Name) == "" {
			violations = append(violations, fmt.Errorf("manifest %q: field has empty name", m.Type))
			continue
		}
		if seen[f.Name] {
			violations = append(violations, fmt.Errorf("manifest %q: duplicate field %q", m.Type, f.Name))
		}
		seen[f.Name] = true

		switch f.Type {
		case FieldTypeString, FieldTypeInt, FieldTypeBool, FieldTypeEnum, FieldTypeObject, FieldTypeSecret:
		default:
			violations = append(violations, fmt.Errorf("manifest %q: field %q has invalid type %q", m.Type, f.Name, f.Type))
		}

		if f.Type == FieldTypeEnum {
			if len(f.Enum) == 0 {
				violations = append(violations, fmt.Errorf("manifest %q: enum field %q must declare allowed values", m.Type, f.Name))
			}
			if f.Default != nil {
				ds, ok := f.Default.(string)
				if !ok || !enumContains(f.Enum, ds) {
					violations = append(violations, fmt.Errorf("manifest %q: enum field %q default %v is not a member of its enum", m.Type, f.Name, f.Default))
				}
			}
		}
	}

	return newSchemaError(violations)
}
