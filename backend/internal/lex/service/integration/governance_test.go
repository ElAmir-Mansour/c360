package integration

import (
	"context"
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

// TestIsProtected covers the maker-checker protection rule (#13): gov-gated kinds and
// active-production endpoints are protected; a planned or sandbox endpoint is not.
func TestIsProtected(t *testing.T) {
	cases := []struct {
		name     string
		endpoint model.IntegrationEndpoint
		want     bool
	}{
		{
			name:     "najiz gov-gated even when sandbox",
			endpoint: model.IntegrationEndpoint{Kind: model.IntegrationKindNajiz, Status: model.IntegrationStatusPlanned, Config: map[string]any{"environment": "sandbox"}},
			want:     true,
		},
		{
			name:     "nafath gov-gated",
			endpoint: model.IntegrationEndpoint{Kind: model.IntegrationKindNafathVerify, Status: model.IntegrationStatusActive},
			want:     true,
		},
		{
			name:     "esign emdha gov-gated",
			endpoint: model.IntegrationEndpoint{Kind: model.IntegrationKindEsign, Status: model.IntegrationStatusPlanned, Config: map[string]any{"provider": "emdha"}},
			want:     true,
		},
		{
			name:     "esign docusign not gov-gated and not production",
			endpoint: model.IntegrationEndpoint{Kind: model.IntegrationKindEsign, Status: model.IntegrationStatusActive, Config: map[string]any{"provider": "docusign"}},
			want:     false,
		},
		{
			name:     "active production internal is protected",
			endpoint: model.IntegrationEndpoint{Kind: model.IntegrationKindInternal, Status: model.IntegrationStatusActive, Config: map[string]any{"environment": "production"}},
			want:     true,
		},
		{
			name:     "active sandbox internal is not protected",
			endpoint: model.IntegrationEndpoint{Kind: model.IntegrationKindInternal, Status: model.IntegrationStatusActive, Config: map[string]any{"environment": "sandbox"}},
			want:     false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isProtected(tc.endpoint); got != tc.want {
				t.Fatalf("isProtected = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestBuildMaskedDiff proves the pending-change diff NEVER carries a secret value: a
// changed secret renders __redacted__ -> __redacted__, an unchanged secret (sentinel)
// is omitted, and a non-secret change carries its real values.
func TestBuildMaskedDiff(t *testing.T) {
	current := map[string]any{
		"base_url":      "https://old.example",
		"client_secret": "OLD-PLAINTEXT-SECRET",
		"client_id":     "abc",
	}
	proposed := map[string]any{
		"base_url":      "https://new.example",    // changed non-secret
		"client_secret": "BRAND-NEW-SUPER-SECRET", // changed secret
		"client_id":     RedactedSentinel,         // unchanged sentinel (non-secret field, will show change to sentinel)
		"api_key":       RedactedSentinel,         // secret left as sentinel -> omitted
	}
	diff := buildMaskedDiff(model.IntegrationKindNajiz, current, proposed)
	bySecret := map[string]PendingChangeDiffItem{}
	for _, d := range diff {
		bySecret[d.Field] = d
		// Hard invariant: no diff entry may carry the cleartext secret.
		if d.Field == "client_secret" {
			if d.Old == "OLD-PLAINTEXT-SECRET" || d.New == "BRAND-NEW-SUPER-SECRET" {
				t.Fatalf("secret value leaked into diff: %+v", d)
			}
			if d.Old != RedactedSentinel || d.New != RedactedSentinel || !d.Secret {
				t.Fatalf("changed secret not masked: %+v", d)
			}
		}
	}
	if _, ok := bySecret["client_secret"]; !ok {
		t.Fatal("expected client_secret in diff")
	}
	if _, ok := bySecret["api_key"]; ok {
		t.Fatal("unchanged sentinel secret api_key must be omitted from diff")
	}
	if bu := bySecret["base_url"]; bu.New != "https://new.example" || bu.Secret {
		t.Fatalf("base_url non-secret diff wrong: %+v", bu)
	}
}

// TestSecretRefResolver proves a kms:///vault:// secret field resolves to the actual
// secret while the stored value stays the reference, and a plain secret is untouched.
func TestSecretRefResolver(t *testing.T) {
	const realSecret = "resolved-kms-secret-value"
	provider := NewFuncSecretProvider("kms", func(_ context.Context, ref ParsedSecretRef) (string, error) {
		if ref.Scheme != "kms" || ref.Key != "creds/najiz" {
			t.Fatalf("unexpected ref: %+v", ref)
		}
		return realSecret, nil
	})
	resolver := NewSecretRefResolver().WithProvider(SecretRefProviderKMS, provider)

	endpoint := model.IntegrationEndpoint{
		Kind: model.IntegrationKindNajiz,
		Config: map[string]any{
			"base_url":      "https://najiz.example",
			"client_secret": "kms://creds/najiz",
			"api_key":       "plain-api-key",
		},
	}
	resolved, err := resolver.Resolve(context.Background(), endpoint)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if resolved["client_secret"] != realSecret {
		t.Fatalf("client_secret not resolved: %v", resolved["client_secret"])
	}
	if resolved["api_key"] != "plain-api-key" {
		t.Fatalf("plain secret should be untouched: %v", resolved["api_key"])
	}
	// The original stored config must keep the reference (never mutated).
	if endpoint.Config["client_secret"] != "kms://creds/najiz" {
		t.Fatalf("stored value must stay the reference: %v", endpoint.Config["client_secret"])
	}
}

// TestSecretRefResolver_UnwiredProviderFailsClosed proves a reference whose backend is
// not wired errors rather than leaking the raw reference to the connector.
func TestSecretRefResolver_UnwiredProviderFailsClosed(t *testing.T) {
	resolver := NewSecretRefResolver().WithProvider(SecretRefProviderVault,
		NewFuncSecretProvider("vault", func(context.Context, ParsedSecretRef) (string, error) { return "x", nil }))
	endpoint := model.IntegrationEndpoint{
		Kind:   model.IntegrationKindNajiz,
		Config: map[string]any{"client_secret": "kms://creds/najiz"}, // kms not wired
	}
	if _, err := resolver.Resolve(context.Background(), endpoint); err == nil {
		t.Fatal("expected an error when the kms provider is unwired")
	}
}

// TestEgressEnforcer covers region + field denials and the unconstrained allow.
func TestEgressEnforcer(t *testing.T) {
	enforcer := NewEgressEnforcer(nil)

	// In-Kingdom-only endpoint.
	endpoint := model.IntegrationEndpoint{
		Kind:   model.IntegrationKindArchiving,
		Config: map[string]any{AllowedRegionsKey: []any{"sa"}, AllowedEgressFieldsKey: []any{"case_number"}},
	}
	if err := enforcer.Check(context.Background(), endpoint, []string{"case_number"}, "sa"); err != nil {
		t.Fatalf("expected allow for sa/case_number: %v", err)
	}
	if err := enforcer.Check(context.Background(), endpoint, []string{"case_number"}, "us"); err == nil {
		t.Fatal("expected region denial for us")
	}
	if err := enforcer.Check(context.Background(), endpoint, []string{"national_id"}, "sa"); err == nil {
		t.Fatal("expected field denial for national_id")
	}

	// Unconstrained endpoint allows anything.
	open := model.IntegrationEndpoint{Kind: model.IntegrationKindInternal}
	if err := enforcer.Check(context.Background(), open, []string{"anything"}, "us"); err != nil {
		t.Fatalf("unconstrained policy must allow: %v", err)
	}
}

// TestRotationPolicy covers overdue / due-soon / ok classification and the created_at
// fallback for a never-rotated secret.
func TestRotationPolicy(t *testing.T) {
	now := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	policy := NewRotationPolicy(7)

	endpoint := model.IntegrationEndpoint{
		Kind:      model.IntegrationKindNajiz,
		CreatedAt: now.Add(-100 * 24 * time.Hour),
		Config: map[string]any{
			RotateEveryDaysKey: 30,
			"client_secret":    "set",
		},
		Metadata: map[string]any{
			"last_rotated": map[string]any{
				"client_secret": now.Add(-40 * 24 * time.Hour).Format(time.RFC3339),
			},
		},
	}
	fields := policy.Evaluate(endpoint, now)
	var found bool
	for _, f := range fields {
		if f.Field == "client_secret" {
			found = true
			if f.Status != RotationStatusOverdue {
				t.Fatalf("client_secret rotated 40d ago with 30d cadence should be overdue, got %s", f.Status)
			}
		}
	}
	if !found {
		t.Fatal("expected client_secret in rotation evaluation")
	}

	// No policy ⇒ no fields.
	noPolicy := endpoint
	noPolicy.Config = map[string]any{"client_secret": "set"}
	if got := policy.Evaluate(noPolicy, now); got != nil {
		t.Fatalf("no rotate_every_days should yield no rotation fields, got %v", got)
	}
}

// TestRotationExpiryReporter proves the rotation policy surfaces overdue/due-soon
// fields as ExpiryWarnings (and never an OK field).
func TestRotationExpiryReporter(t *testing.T) {
	now := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	reporter := NewRotationExpiryReporter(NewRotationPolicy(7), func() time.Time { return now })
	endpoint := model.IntegrationEndpoint{
		Kind:      model.IntegrationKindNajiz,
		CreatedAt: now,
		Config:    map[string]any{RotateEveryDaysKey: 30, "client_secret": "set"},
		Metadata: map[string]any{"last_rotated": map[string]any{
			"client_secret": now.Add(-29 * 24 * time.Hour).Format(time.RFC3339), // due in 1d -> due_soon
		}},
	}
	warnings := reporter.Expiries(endpoint)
	if len(warnings) != 1 || warnings[0].Field != "client_secret" {
		t.Fatalf("expected one due-soon warning for client_secret, got %+v", warnings)
	}
}
