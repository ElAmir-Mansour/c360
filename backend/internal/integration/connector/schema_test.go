package connector

import (
	"errors"
	"strings"
	"testing"
)

// sampleSchema is a representative schema exercising every field type. It is
// modeled on the real *Config structs (slack/webhook/servicenow) so the tests
// validate against schemas the production connectors will actually declare.
func sampleSchema() []FieldSpec {
	return []FieldSpec{
		{Name: "url", Type: FieldTypeString, Required: true, Description: "Endpoint URL"},
		{Name: "method", Type: FieldTypeEnum, Required: false, Enum: []string{"POST", "PUT", "PATCH"}, Default: "POST"},
		{Name: "max_retries", Type: FieldTypeInt, Required: false, Default: float64(3)},
		{Name: "verify_tls", Type: FieldTypeBool, Required: false, Default: true},
		{Name: "headers", Type: FieldTypeObject, Required: false},
		{Name: "secret", Type: FieldTypeSecret, Required: false},
		{Name: "api_token", Type: FieldTypeString, Required: false, Secret: true},
	}
}

func TestValidateAgainstSchema(t *testing.T) {
	tests := []struct {
		name       string
		schema     []FieldSpec
		cfg        map[string]any
		policy     UnknownFieldPolicy
		wantErr    bool
		wantSubstr []string // substrings expected in the aggregated error
	}{
		{
			name:   "happy path all valid",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":         "https://hooks.example.com/abc",
				"method":      "PUT",
				"max_retries": float64(5), // JSON shape
				"verify_tls":  false,
				"headers":     map[string]any{"X-Env": "prod"},
				"secret":      "shhh-very-secret",
				"api_token":   "tok_abcdef",
			},
			policy:  RejectUnknownFields,
			wantErr: false,
		},
		{
			name:    "missing required field",
			schema:  sampleSchema(),
			cfg:     map[string]any{"method": "POST"},
			policy:  RejectUnknownFields,
			wantErr: true,
			// url required is the violation; method/POST is valid.
			wantSubstr: []string{`field "url" is required`},
		},
		{
			name:   "required present but empty string is treated as missing",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url": "   ",
			},
			policy:     RejectUnknownFields,
			wantErr:    true,
			wantSubstr: []string{`field "url" is required`},
		},
		{
			name:   "wrong type for string field",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url": 123,
			},
			policy:     RejectUnknownFields,
			wantErr:    true,
			wantSubstr: []string{`field "url" must be a string`},
		},
		{
			name:   "wrong type for bool field",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":        "https://x",
				"verify_tls": "yes",
			},
			policy:     RejectUnknownFields,
			wantErr:    true,
			wantSubstr: []string{`field "verify_tls" must be a bool`},
		},
		{
			name:   "bad enum value",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":    "https://x",
				"method": "DELETE",
			},
			policy:     RejectUnknownFields,
			wantErr:    true,
			wantSubstr: []string{`field "method" must be one of [POST, PUT, PATCH]`},
		},
		{
			name:   "int from float64 with no fraction is accepted",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":         "https://x",
				"max_retries": float64(7),
			},
			policy:  RejectUnknownFields,
			wantErr: false,
		},
		{
			name:   "int from fractional float64 is rejected",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":         "https://x",
				"max_retries": float64(2.5),
			},
			policy:     RejectUnknownFields,
			wantErr:    true,
			wantSubstr: []string{`field "max_retries" must be an integer`},
		},
		{
			name:   "native int is accepted for int field",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":         "https://x",
				"max_retries": 4,
			},
			policy:  RejectUnknownFields,
			wantErr: false,
		},
		{
			name:   "object field rejects scalar",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":     "https://x",
				"headers": "not-an-object",
			},
			policy:     RejectUnknownFields,
			wantErr:    true,
			wantSubstr: []string{`field "headers" must be an object`},
		},
		{
			name:   "object field accepts map[string]string",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":     "https://x",
				"headers": map[string]string{"A": "b"},
			},
			policy:  RejectUnknownFields,
			wantErr: false,
		},
		{
			name:   "unknown field rejected under strict policy",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":     "https://x",
				"bogus":   "value",
				"another": 1,
			},
			policy:  RejectUnknownFields,
			wantErr: true,
			wantSubstr: []string{
				`field "bogus" is not allowed`,
				`field "another" is not allowed`,
			},
		},
		{
			name:   "unknown field ignored under lenient policy",
			schema: sampleSchema(),
			cfg: map[string]any{
				"url":   "https://x",
				"bogus": "value",
			},
			policy:  IgnoreUnknownFields,
			wantErr: false,
		},
		{
			name:   "multiple violations all reported",
			schema: sampleSchema(),
			cfg: map[string]any{
				// url missing (required)
				"method":      "DELETE",     // bad enum
				"verify_tls":  "nope",       // wrong type
				"max_retries": float64(1.1), // fractional
				"unexpected":  true,         // unknown
			},
			policy:  RejectUnknownFields,
			wantErr: true,
			wantSubstr: []string{
				`field "url" is required`,
				`field "method" must be one of`,
				`field "verify_tls" must be a bool`,
				`field "max_retries" must be an integer`,
				`field "unexpected" is not allowed`,
			},
		},
		{
			name:    "nil config with no required fields is valid",
			schema:  []FieldSpec{{Name: "opt", Type: FieldTypeString}},
			cfg:     nil,
			policy:  RejectUnknownFields,
			wantErr: false,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateAgainstSchemaPolicy(tc.schema, tc.cfg, tc.policy)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected no error, got: %v", err)
			}
			if err != nil {
				for _, sub := range tc.wantSubstr {
					if !strings.Contains(err.Error(), sub) {
						t.Errorf("error %q missing expected substring %q", err.Error(), sub)
					}
				}
				// Confirm it's a *SchemaError and unwraps to individual errors.
				var se *SchemaError
				if !errors.As(err, &se) {
					t.Errorf("expected *SchemaError, got %T", err)
				} else if len(se.Violations) == 0 {
					t.Errorf("SchemaError has no violations")
				}
			}
		})
	}
}

func TestValidateAgainstSchema_ViolationCount(t *testing.T) {
	schema := sampleSchema()
	cfg := map[string]any{
		"method":     "DELETE", // bad enum
		"verify_tls": "nope",   // wrong type
		// url missing -> required
	}
	err := ValidateAgainstSchema(schema, cfg)
	if err == nil {
		t.Fatal("expected error")
	}
	var se *SchemaError
	if !errors.As(err, &se) {
		t.Fatalf("expected *SchemaError, got %T", err)
	}
	if len(se.Violations) != 3 {
		t.Fatalf("expected exactly 3 violations, got %d: %v", len(se.Violations), se.Violations)
	}
	if !strings.HasPrefix(err.Error(), "config validation failed (3 violations)") {
		t.Errorf("unexpected error prefix: %q", err.Error())
	}
}

func TestSanitizeBySchema(t *testing.T) {
	schema := sampleSchema()
	cfg := map[string]any{
		"url":         "https://hooks.example.com/abcdef",
		"method":      "POST",
		"verify_tls":  true,
		"secret":      "shhh-very-secret-value", // FieldTypeSecret -> masked
		"api_token":   "tok_1234567890abcd",     // Secret:true -> masked
		"headers":     map[string]any{"X-Env": "prod"},
		"short_token": "abc", // unknown but secret-looking -> masked (<=8 -> stars)
		"plain_short": "hi",  // unknown, not secret-looking -> untouched
	}

	out := SanitizeBySchema(schema, cfg)

	// Non-secret fields pass through unchanged.
	if out["url"] != "https://hooks.example.com/abcdef" {
		t.Errorf("url should be unchanged, got %v", out["url"])
	}
	if out["method"] != "POST" {
		t.Errorf("method should be unchanged, got %v", out["method"])
	}
	if out["verify_tls"] != true {
		t.Errorf("verify_tls should be unchanged, got %v", out["verify_tls"])
	}
	if out["plain_short"] != "hi" {
		t.Errorf("plain_short should be unchanged, got %v", out["plain_short"])
	}

	// Secret schema fields are masked (keep first/last 4).
	wantSecret := "shhh" + strings.Repeat("*", len("shhh-very-secret-value")-8) + "alue"
	if out["secret"] != wantSecret {
		t.Errorf("secret mask mismatch:\n got %q\nwant %q", out["secret"], wantSecret)
	}
	wantToken := "tok_" + strings.Repeat("*", len("tok_1234567890abcd")-8) + "abcd"
	if out["api_token"] != wantToken {
		t.Errorf("api_token mask mismatch:\n got %q\nwant %q", out["api_token"], wantToken)
	}

	// Unknown secret-looking short value masked to all stars.
	if out["short_token"] != "***" {
		t.Errorf("short_token should be all stars, got %q", out["short_token"])
	}

	// Object value deep-copied (mutating output must not affect input).
	outHeaders := out["headers"].(map[string]any)
	outHeaders["X-Env"] = "MUTATED"
	if cfg["headers"].(map[string]any)["X-Env"] != "prod" {
		t.Error("sanitize did not deep-copy object field; input was mutated")
	}

	// The plaintext secret must not appear anywhere in the sanitized output.
	for k, v := range out {
		if s, ok := v.(string); ok {
			if strings.Contains(s, "shhh-very-secret-value") || strings.Contains(s, "tok_1234567890abcd") {
				t.Errorf("plaintext secret leaked in field %q: %q", k, s)
			}
		}
	}
}

func TestSanitizeBySchema_NonStringSecretRedacted(t *testing.T) {
	schema := []FieldSpec{
		{Name: "creds", Type: FieldTypeObject, Secret: true},
		{Name: "empty_secret", Type: FieldTypeSecret},
	}
	cfg := map[string]any{
		"creds":        map[string]any{"user": "admin", "pass": "p@ss"},
		"empty_secret": "",
	}
	out := SanitizeBySchema(schema, cfg)
	if out["creds"] != "[REDACTED]" {
		t.Errorf("non-string secret should be redacted, got %v", out["creds"])
	}
	if out["empty_secret"] != "" {
		t.Errorf("empty secret should remain empty, got %v", out["empty_secret"])
	}
}

func TestApplyDefaults(t *testing.T) {
	schema := sampleSchema()

	t.Run("fills absent fields with defaults", func(t *testing.T) {
		cfg := map[string]any{"url": "https://x"}
		out := ApplyDefaults(schema, cfg)

		if out["method"] != "POST" {
			t.Errorf("method default not applied, got %v", out["method"])
		}
		// int default supplied as float64 must normalize to int.
		if mr, ok := out["max_retries"].(int); !ok || mr != 3 {
			t.Errorf("max_retries default should be int 3, got %v (%T)", out["max_retries"], out["max_retries"])
		}
		if out["verify_tls"] != true {
			t.Errorf("verify_tls default not applied, got %v", out["verify_tls"])
		}
		// no default declared for url/headers/secret/api_token -> not added
		if _, ok := out["headers"]; ok {
			t.Errorf("headers has no default and should not be added")
		}
	})

	t.Run("does not overwrite existing non-empty values", func(t *testing.T) {
		cfg := map[string]any{
			"url":         "https://x",
			"method":      "PUT",
			"max_retries": 10,
			"verify_tls":  false, // explicit false must survive
		}
		out := ApplyDefaults(schema, cfg)
		if out["method"] != "PUT" {
			t.Errorf("method should not be overwritten, got %v", out["method"])
		}
		if out["max_retries"] != 10 {
			t.Errorf("max_retries should not be overwritten, got %v", out["max_retries"])
		}
		if out["verify_tls"] != false {
			t.Errorf("explicit false verify_tls must survive default application, got %v", out["verify_tls"])
		}
	})

	t.Run("empty string is replaced by default", func(t *testing.T) {
		cfg := map[string]any{"url": "https://x", "method": "  "}
		out := ApplyDefaults(schema, cfg)
		if out["method"] != "POST" {
			t.Errorf("empty method should be replaced by default, got %v", out["method"])
		}
	})

	t.Run("does not mutate input map", func(t *testing.T) {
		cfg := map[string]any{"url": "https://x"}
		_ = ApplyDefaults(schema, cfg)
		if _, ok := cfg["method"]; ok {
			t.Error("ApplyDefaults mutated the input map")
		}
	})
}

func TestManifestValidate(t *testing.T) {
	tests := []struct {
		name    string
		m       Manifest
		wantErr bool
	}{
		{
			name: "valid manifest",
			m: Manifest{
				Type: "demo", DisplayName: "Demo", Capabilities: CapabilityNotify, AuthKind: AuthBearerToken,
				ConfigSchema: []FieldSpec{{Name: "token", Type: FieldTypeSecret, Required: true}},
			},
			wantErr: false,
		},
		{
			name:    "empty type",
			m:       Manifest{Type: "", DisplayName: "X", Capabilities: CapabilityNotify},
			wantErr: true,
		},
		{
			name:    "empty display name",
			m:       Manifest{Type: "x", DisplayName: "", Capabilities: CapabilityNotify},
			wantErr: true,
		},
		{
			name:    "invalid capability",
			m:       Manifest{Type: "x", DisplayName: "X", Capabilities: Capability("bogus")},
			wantErr: true,
		},
		{
			name: "duplicate field name",
			m: Manifest{
				Type: "x", DisplayName: "X", Capabilities: CapabilityNotify,
				ConfigSchema: []FieldSpec{
					{Name: "a", Type: FieldTypeString},
					{Name: "a", Type: FieldTypeString},
				},
			},
			wantErr: true,
		},
		{
			name: "enum field without enum values",
			m: Manifest{
				Type: "x", DisplayName: "X", Capabilities: CapabilityNotify,
				ConfigSchema: []FieldSpec{{Name: "mode", Type: FieldTypeEnum}},
			},
			wantErr: true,
		},
		{
			name: "enum default not a member",
			m: Manifest{
				Type: "x", DisplayName: "X", Capabilities: CapabilityNotify,
				ConfigSchema: []FieldSpec{{Name: "mode", Type: FieldTypeEnum, Enum: []string{"a", "b"}, Default: "c"}},
			},
			wantErr: true,
		},
		{
			name: "field with invalid type",
			m: Manifest{
				Type: "x", DisplayName: "X", Capabilities: CapabilityNotify,
				ConfigSchema: []FieldSpec{{Name: "f", Type: FieldType("weird")}},
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := tc.m.Validate()
			if tc.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected no error, got: %v", err)
			}
		})
	}
}

func TestCapabilityHelpers(t *testing.T) {
	if !CapabilityNotify.CanNotify() || CapabilityNotify.CanTicket() {
		t.Error("notify capability wrong")
	}
	if CapabilityTicket.CanNotify() || !CapabilityTicket.CanTicket() {
		t.Error("ticket capability wrong")
	}
	if !CapabilityBoth.CanNotify() || !CapabilityBoth.CanTicket() {
		t.Error("both capability wrong")
	}
	if Capability("nope").Valid() {
		t.Error("invalid capability reported valid")
	}
}

func TestFieldSpecIsSecret(t *testing.T) {
	if !(FieldSpec{Type: FieldTypeSecret}).IsSecret() {
		t.Error("FieldTypeSecret should be secret")
	}
	if !(FieldSpec{Type: FieldTypeString, Secret: true}).IsSecret() {
		t.Error("Secret:true should be secret")
	}
	if (FieldSpec{Type: FieldTypeString}).IsSecret() {
		t.Error("plain string should not be secret")
	}
}
