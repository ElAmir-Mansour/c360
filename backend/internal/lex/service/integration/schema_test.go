package integration

import (
	"fmt"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// REDACTION REGRESSION GUARD (security-critical).
//
// These plain unit tests (no DB, no network) pin the schema-aware redaction
// contract that keeps integration secrets from leaking through the API:
//
//   - MaskConfig MUST replace every SECRET field value with the __redacted__
//     sentinel and MUST NEVER echo the real secret. Non-secret fields echo their
//     stored value so the console can prefill the dynamic form.
//   - MergeSecrets MUST keep the stored ciphertext (existing plaintext) when the
//     incoming value is the sentinel/blank, and MUST replace it when a genuinely
//     new value is supplied.
//   - Validate MUST reject missing-required and bad-enum configs and accept a
//     valid one.
//
// If anyone changes MaskConfig such that a secret field's real value leaks into
// the masked view, TestSchemaMaskConfigRedactsSecrets (and the per-kind sweep)
// MUST fail. Do not weaken these assertions to make a refactor "pass".
// =============================================================================

// secretSentinelKinds is the set of kinds whose schemas are exercised by the
// redaction sweep. They span every secret-bearing transport family the console
// can render: sso (OIDC/SAML client secrets + SCIM token), hr (bearer/SFTP/LDAP
// passwords), internal (bearer/HMAC/basic), and najiz (gov client secret + key).
var secretSentinelKinds = []model.IntegrationKind{
	model.IntegrationKindSSO,
	model.IntegrationKindHR,
	model.IntegrationKindInternal,
	model.IntegrationKindNajiz,
}

// distinctiveSecret builds a per-field secret string that is trivially
// grep-able. If MaskConfig ever leaks it, a substring search over the masked map
// turns it up immediately.
func distinctiveSecret(kind model.IntegrationKind, key string) string {
	return fmt.Sprintf("LEAKED-SECRET--%s--%s--do-not-emit", kind, key)
}

// TestSchemaMaskConfigRedactsSecrets is the core redaction guard. For every
// secret-bearing kind it stuffs a distinctive secret into each SECRET field and a
// recognisable value into each NON-secret field, masks the config, then asserts:
//
//  1. Every secret field collapses to exactly the __redacted__ sentinel.
//  2. No secret field carries its real value (belt-and-braces vs. assertion 1).
//  3. Every non-secret field echoes its stored value verbatim (console prefill).
//  4. The raw secret string appears NOWHERE in the masked map (stringified).
func TestSchemaMaskConfigRedactsSecrets(t *testing.T) {
	for _, kind := range secretSentinelKinds {
		kind := kind
		t.Run(string(kind), func(t *testing.T) {
			schema, ok := SchemaFor(kind)
			if !ok {
				t.Fatalf("no schema registered for kind %q", kind)
			}

			// Build a fully-populated plaintext config: a distinctive secret for
			// every secret field, a tagged value for every non-secret field.
			plaintext := map[string]any{}
			secretKeys := map[string]string{}    // key -> the real secret value
			nonSecretKeys := map[string]string{} // key -> the echoed value
			for _, f := range schema {
				if f.IsSecret() {
					sv := distinctiveSecret(kind, f.Key)
					plaintext[f.Key] = sv
					secretKeys[f.Key] = sv
					continue
				}
				// Use the field default when it has one (so enum fields stay valid),
				// otherwise a recognisable echo value.
				v := f.Default
				if v == "" {
					v = "echo-" + f.Key
				}
				plaintext[f.Key] = v
				nonSecretKeys[f.Key] = v
			}
			if len(secretKeys) == 0 {
				t.Fatalf("kind %q has no secret fields; redaction guard would be vacuous", kind)
			}

			masked := schema.MaskConfig(plaintext)

			// 1 + 2: every secret field is exactly the sentinel, never the real value.
			for key, real := range secretKeys {
				got, present := masked[key]
				if !present {
					t.Fatalf("secret field %q dropped from masked config (expected sentinel)", key)
				}
				if got != RedactedSentinel {
					t.Fatalf("secret field %q masked to %v, want sentinel %q (LEAK if real value)", key, got, RedactedSentinel)
				}
				if fmt.Sprint(got) == real {
					t.Fatalf("SECRET LEAK: field %q masked to its real value", key)
				}
			}

			// 3: every non-secret field echoes its stored value for console prefill.
			for key, want := range nonSecretKeys {
				got, present := masked[key]
				if !present {
					t.Fatalf("non-secret field %q dropped from masked config (expected echo of %q)", key, want)
				}
				if fmt.Sprint(got) != want {
					t.Fatalf("non-secret field %q masked to %v, want echoed value %q", key, got, want)
				}
			}

			// 4: belt-and-braces — the raw secret string must not appear ANYWHERE in
			// the stringified masked map (catches a leak into an adjacent/extra key).
			blob := fmt.Sprintf("%v", masked)
			for key, real := range secretKeys {
				if strings.Contains(blob, real) {
					t.Fatalf("SECRET LEAK: masked config for kind %q contains the raw secret for field %q: %s", kind, key, blob)
				}
			}
		})
	}
}

// TestSchemaMaskConfigEmptySecretOmitted documents the "unset" affordance: an
// EMPTY secret is omitted (not sentinel'd), so the console shows the field as
// unset rather than "set". A non-secret empty/blank value still does not surface
// as a leak.
func TestSchemaMaskConfigEmptySecretOmitted(t *testing.T) {
	schema, ok := SchemaFor(model.IntegrationKindInternal)
	if !ok {
		t.Fatal("no schema for internal kind")
	}
	cfg := map[string]any{
		"base_url":     "https://internal.example.test",
		"auth_scheme":  "bearer",
		"bearer_token": "", // empty secret -> omitted, never sentinel
	}
	masked := schema.MaskConfig(cfg)
	if _, present := masked["bearer_token"]; present {
		t.Fatalf("empty secret bearer_token should be omitted from masked config, got %v", masked["bearer_token"])
	}
	if masked["base_url"] != "https://internal.example.test" {
		t.Fatalf("non-secret base_url not echoed: %v", masked["base_url"])
	}
}

// TestSchemaMaskConfigExtraKeysEchoed pins the documented behaviour that
// non-schema keys are echoed verbatim (operator annotations). This is safe
// because the SCHEMA is the source of truth for what counts as secret — but the
// test exists so a future change that starts treating extra keys as secret (or
// dropping them) is a deliberate, reviewed decision.
func TestSchemaMaskConfigExtraKeysEchoed(t *testing.T) {
	schema, ok := SchemaFor(model.IntegrationKindInternal)
	if !ok {
		t.Fatal("no schema for internal kind")
	}
	cfg := map[string]any{
		"base_url":         "https://internal.example.test",
		"operator_note":    "primary region",
		"some_extra_count": 7,
	}
	masked := schema.MaskConfig(cfg)
	if masked["operator_note"] != "primary region" {
		t.Fatalf("extra key operator_note not echoed: %v", masked["operator_note"])
	}
	if fmt.Sprint(masked["some_extra_count"]) != "7" {
		t.Fatalf("extra key some_extra_count not echoed: %v", masked["some_extra_count"])
	}
}

// TestSchemaMergeSecretsKeepsCiphertextOnSentinel is the merge-on-update half of
// the contract: a returning sentinel (or blank/missing) for a secret field keeps
// the STORED plaintext (what lets the repo re-encrypt the same ciphertext), while
// a genuinely new value replaces it. Non-secret fields take the incoming value.
func TestSchemaMergeSecretsKeepsCiphertextOnSentinel(t *testing.T) {
	for _, kind := range secretSentinelKinds {
		kind := kind
		t.Run(string(kind), func(t *testing.T) {
			schema, ok := SchemaFor(kind)
			if !ok {
				t.Fatalf("no schema for kind %q", kind)
			}

			// Stored plaintext: a distinctive secret per secret field; a stored value
			// per non-secret field.
			existing := map[string]any{}
			secretKeys := []string{}
			var firstNonSecret string
			for _, f := range schema {
				if f.IsSecret() {
					existing[f.Key] = distinctiveSecret(kind, f.Key)
					secretKeys = append(secretKeys, f.Key)
					continue
				}
				existing[f.Key] = "stored-" + f.Key
				if firstNonSecret == "" {
					firstNonSecret = f.Key
				}
			}
			if len(secretKeys) == 0 {
				t.Fatalf("kind %q has no secret fields", kind)
			}

			// Incoming (Update request shape): the console echoes the masked view back
			// — sentinel for every secret. Change exactly one non-secret field and
			// supply a genuinely NEW value for exactly ONE secret field.
			rotatedKey := secretKeys[0]
			const rotatedValue = "ROTATED-NEW-SECRET-value"
			incoming := map[string]any{}
			for _, f := range schema {
				if f.IsSecret() {
					incoming[f.Key] = RedactedSentinel
				}
			}
			incoming[rotatedKey] = rotatedValue
			if firstNonSecret != "" {
				incoming[firstNonSecret] = "updated-" + firstNonSecret
			}

			merged := schema.MergeSecrets(existing, incoming)

			// Every NON-rotated secret keeps its stored plaintext (sentinel -> keep).
			for _, key := range secretKeys {
				if key == rotatedKey {
					continue
				}
				want := distinctiveSecret(kind, key)
				if fmt.Sprint(merged[key]) != want {
					t.Fatalf("secret %q: sentinel incoming should keep stored plaintext %q, got %v", key, want, merged[key])
				}
			}
			// The rotated secret takes the new value (will be re-encrypted on write).
			if fmt.Sprint(merged[rotatedKey]) != rotatedValue {
				t.Fatalf("rotated secret %q: new value should win, got %v", rotatedKey, merged[rotatedKey])
			}
			// The changed non-secret field takes the incoming value.
			if firstNonSecret != "" {
				if fmt.Sprint(merged[firstNonSecret]) != "updated-"+firstNonSecret {
					t.Fatalf("non-secret %q: incoming should win, got %v", firstNonSecret, merged[firstNonSecret])
				}
			}
		})
	}
}

// TestSchemaMergeSecretsKeepsOnMissingSecret pins the "console omits unchanged
// secrets" path: a secret field ABSENT from the incoming config keeps the stored
// plaintext rather than being blanked.
func TestSchemaMergeSecretsKeepsOnMissingSecret(t *testing.T) {
	schema, ok := SchemaFor(model.IntegrationKindInternal)
	if !ok {
		t.Fatal("no schema for internal kind")
	}
	existing := map[string]any{
		"base_url":     "https://internal.example.test",
		"auth_scheme":  "bearer",
		"bearer_token": "stored-bearer-token-keep-me",
	}
	// Incoming carries no bearer_token at all (console omitted the unchanged secret).
	incoming := map[string]any{
		"base_url":    "https://internal.example.test/v2",
		"auth_scheme": "bearer",
	}
	merged := schema.MergeSecrets(existing, incoming)
	if fmt.Sprint(merged["bearer_token"]) != "stored-bearer-token-keep-me" {
		t.Fatalf("missing incoming secret should keep stored value, got %v", merged["bearer_token"])
	}
	if merged["base_url"] != "https://internal.example.test/v2" {
		t.Fatalf("non-secret base_url should take incoming value, got %v", merged["base_url"])
	}
}

// TestSchemaValidate exercises Validate across kinds: a valid active config is
// accepted; a missing required field and a bad enum are each rejected with the
// expected field->reason.
func TestSchemaValidate(t *testing.T) {
	t.Run("internal valid active", func(t *testing.T) {
		schema, _ := SchemaFor(model.IntegrationKindInternal)
		cfg := map[string]any{
			"base_url":    "https://internal.example.test",
			"auth_scheme": "bearer",
		}
		if errs := schema.Validate(cfg, true); errs != nil {
			t.Fatalf("valid internal config rejected: %v", errs)
		}
	})

	t.Run("internal missing required base_url when active", func(t *testing.T) {
		schema, _ := SchemaFor(model.IntegrationKindInternal)
		cfg := map[string]any{"auth_scheme": "bearer"}
		errs := schema.Validate(cfg, true)
		if errs == nil || errs["base_url"] != "required" {
			t.Fatalf("expected base_url=required, got %v", errs)
		}
	})

	t.Run("internal missing required base_url allowed when planned", func(t *testing.T) {
		schema, _ := SchemaFor(model.IntegrationKindInternal)
		cfg := map[string]any{"auth_scheme": "bearer"}
		if errs := schema.Validate(cfg, false); errs != nil {
			t.Fatalf("planned (inactive) endpoint should allow incomplete config, got %v", errs)
		}
	})

	t.Run("internal bad enum auth_scheme", func(t *testing.T) {
		schema, _ := SchemaFor(model.IntegrationKindInternal)
		cfg := map[string]any{
			"base_url":    "https://internal.example.test",
			"auth_scheme": "totally-bogus",
		}
		errs := schema.Validate(cfg, true)
		if errs == nil || errs["auth_scheme"] != "invalid_enum" {
			t.Fatalf("expected auth_scheme=invalid_enum, got %v", errs)
		}
	})

	t.Run("sso missing required protocol when active", func(t *testing.T) {
		schema, _ := SchemaFor(model.IntegrationKindSSO)
		// protocol is required; omit it.
		cfg := map[string]any{"issuer": "https://idp.example.test"}
		errs := schema.Validate(cfg, true)
		if errs == nil || errs["protocol"] != "required" {
			t.Fatalf("expected protocol=required, got %v", errs)
		}
	})

	t.Run("hr bad enum transport", func(t *testing.T) {
		schema, _ := SchemaFor(model.IntegrationKindHR)
		cfg := map[string]any{"transport": "carrier-pigeon"}
		errs := schema.Validate(cfg, true)
		if errs == nil || errs["transport"] != "invalid_enum" {
			t.Fatalf("expected transport=invalid_enum, got %v", errs)
		}
	})

	t.Run("najiz required secret satisfied by sentinel", func(t *testing.T) {
		// najiz has no required secret, but assert the sentinel-as-present rule on a
		// kind that DOES: nafath_verify requires client_secret. An active endpoint
		// whose secret returns the sentinel (ciphertext on file) is acceptable.
		schema, _ := SchemaFor(model.IntegrationKindNafathVerify)
		cfg := map[string]any{
			"base_url":      "https://nafath.example.test",
			"client_id":     "svc-client",
			"client_secret": RedactedSentinel,
		}
		if errs := schema.Validate(cfg, true); errs != nil {
			t.Fatalf("sentinel secret on an active endpoint should validate, got %v", errs)
		}
		// ...but a BLANK required secret is rejected.
		cfg["client_secret"] = ""
		errs := schema.Validate(cfg, true)
		if errs == nil || errs["client_secret"] != "required" {
			t.Fatalf("expected client_secret=required for blank required secret, got %v", errs)
		}
	})
}
