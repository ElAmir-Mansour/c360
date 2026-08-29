package integrations

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestKind_Valid(t *testing.T) {
	t.Parallel()
	valid := []Kind{KindHypervisor, KindStorageArray, KindCloudVault, KindKubernetes}
	for _, k := range valid {
		if !k.Valid() {
			t.Fatalf("kind %q should be valid", k)
		}
	}
	for _, k := range []Kind{"", "vm", "storage", "Hypervisor"} {
		if k.Valid() {
			t.Fatalf("kind %q should be invalid", k)
		}
	}
}

func TestCredentials_ToConfig(t *testing.T) {
	t.Parallel()
	creds := Credentials{
		Username:  "svc",
		Token:     "tok",
		CACertPEM: "-----BEGIN CERTIFICATE-----",
		Extra:     map[string]string{"svm": "svm1"},
	}
	cfg := creds.toConfig("https://array.local")
	if cfg.Endpoint != "https://array.local" {
		t.Fatalf("endpoint = %q", cfg.Endpoint)
	}
	if cfg.Username != "svc" || cfg.Token != "tok" || cfg.Extra["svm"] != "svm1" {
		t.Fatalf("config not folded correctly: %+v", cfg)
	}
}

// TestIntegration_JSON_OmitsSecrets guards the contract that no secret-bearing
// field is ever part of the Integration API serialization.
func TestIntegration_JSON_OmitsSecrets(t *testing.T) {
	t.Parallel()
	in := Integration{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Name:     "primary-array",
		Kind:     KindStorageArray,
		Vendor:   "netapp_ontap",
		Endpoint: "https://array.local",
		Status:   StatusActive,
		Enabled:  true,
	}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var asMap map[string]any
	if err := json.Unmarshal(raw, &asMap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, forbidden := range []string{"token", "username", "credentials", "ca_cert_pem", "encrypted_credentials", "password"} {
		if _, present := asMap[forbidden]; present {
			t.Fatalf("Integration JSON must not contain %q; got %s", forbidden, raw)
		}
	}
	if asMap["vendor"] != "netapp_ontap" {
		t.Fatalf("expected vendor in JSON: %s", raw)
	}
}
