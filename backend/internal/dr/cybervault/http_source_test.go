package cybervault_test

import (
	"context"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/cybervault"
)

// canned posture JSON per provider. These bodies are the NORMALISED REST surface
// the deployment's cloud-backup gateway exposes (it speaks AWS Backup / Azure
// Backup / GCP Backup-DR upstream and maps into our VaultProvider/VaultPosture
// model); the source under test only decodes this normalised shape.

const awsBackupPostureJSON = `{
  "data": {
    "id": "11111111-1111-1111-1111-111111111111",
    "name": "aws-prod-vault",
    "provider": "aws_backup",
    "primary_region": "us-east-1",
    "replica_regions": ["us-west-2"],
    "immutability_enabled": true,
    "vault_lock_enabled": true,
    "encryption_enabled": true,
    "customer_managed_key": true,
    "approval": {
      "require_restore_approval": true,
      "restore_approvers": 2,
      "require_destructive_approval": true,
      "destructive_approvers": 2,
      "separation_of_duties": true
    },
    "retention": {"minimum_days": 35, "required_minimum_days": 30},
    "isolation": {"cross_account": true, "disjoint_admins": true, "source_admin_denied": true},
    "last_restore_test_at": "2026-06-01T10:00:00Z",
    "last_restore_test_passed": true,
    "break_glass_enabled": true,
    "break_glass_mfa": true
  }
}`

const azureBackupPostureJSON = `{
  "data": {
    "id": "22222222-2222-2222-2222-222222222222",
    "name": "azure-prod-vault",
    "provider": "azure_backup",
    "primary_region": "westeurope",
    "immutability_enabled": true,
    "vault_lock_enabled": false,
    "encryption_enabled": true,
    "customer_managed_key": false,
    "retention": {"minimum_days": 14},
    "isolation": {"cross_account": true, "disjoint_admins": false, "source_admin_denied": false},
    "last_restore_test_passed": false
  }
}`

// gcp body intentionally uses the "posture" envelope key and omits id/name so the
// normalisation path (inherit from vault id) is exercised.
const gcpBackupPostureJSON = `{
  "posture": {
    "provider": "gcp_backup_dr",
    "primary_region": "europe-west1",
    "immutability_enabled": false,
    "vault_lock_enabled": false,
    "encryption_enabled": true,
    "customer_managed_key": true,
    "retention": {"minimum_days": 7}
  }
}`

const vaultListJSON = `{
  "data": [
    {"id":"11111111-1111-1111-1111-111111111111","tenant_id":"%[1]s","group_id":"%[2]s","provider":"aws_backup","name":"aws-prod-vault","external_id":"arn:aws:backup:vault/aws-prod"},
    {"id":"22222222-2222-2222-2222-222222222222","tenant_id":"%[1]s","group_id":"%[2]s","provider":"azure_backup","name":"azure-prod-vault"}
  ]
}`

// newGatewayServer spins up an httptest gateway capturing the inbound request so
// auth headers and query filters can be asserted. The handler implements the
// narrow contract: /vaults (list), /vaults/{id}/posture (get), /healthz.
func newGatewayServer(t *testing.T, tenant, group string) (*httptest.Server, *capturedRequest) {
	t.Helper()
	cap := &capturedRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.path = r.URL.Path
		cap.rawQuery = r.URL.RawQuery
		cap.authorization = r.Header.Get("Authorization")
		cap.accept = r.Header.Get("Accept")
		cap.tenantParam = r.URL.Query().Get("tenant")
		cap.groupParam = r.URL.Query().Get("group")
		w.Header().Set("Content-Type", "application/json")

		switch {
		case r.URL.Path == "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case r.URL.Path == "/vaults":
			_, _ = w.Write([]byte(formatList(tenant, group)))
		case r.URL.Path == "/vaults/11111111-1111-1111-1111-111111111111/posture":
			_, _ = w.Write([]byte(awsBackupPostureJSON))
		case r.URL.Path == "/vaults/22222222-2222-2222-2222-222222222222/posture":
			_, _ = w.Write([]byte(azureBackupPostureJSON))
		case r.URL.Path == "/vaults/33333333-3333-3333-3333-333333333333/posture":
			_, _ = w.Write([]byte(gcpBackupPostureJSON))
		case strings.HasSuffix(r.URL.Path, "/posture"):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"vault not found"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, cap
}

type capturedRequest struct {
	path          string
	rawQuery      string
	authorization string
	accept        string
	tenantParam   string
	groupParam    string
}

func formatList(tenant, group string) string {
	return strings.NewReplacer("%[1]s", tenant, "%[2]s", group).Replace(vaultListJSON)
}

// TestHTTPPostureSource_ListsAndFiltersOverHTTP exercises the REAL source against
// a httptest gateway: a genuine GET, JSON list decode, the tenant/group filters
// forwarded as query params, and the bearer token sent on the wire.
func TestHTTPPostureSource_ListsAndFiltersOverHTTP(t *testing.T) {
	t.Parallel()

	tenant := "aaaaaaaa-0000-0000-0000-000000000001"
	group := "bbbbbbbb-0000-0000-0000-000000000002"
	srv, cap := newGatewayServer(t, tenant, group)

	src, err := cybervault.NewHTTPPostureSource(srv.URL, "tok-abc", "", srv.Client())
	if err != nil {
		t.Fatalf("NewHTTPPostureSource: %v", err)
	}

	vaults, err := src.ListRegisteredVaults(context.Background(), tenant, group)
	if err != nil {
		t.Fatalf("ListRegisteredVaults: %v", err)
	}
	if len(vaults) != 2 {
		t.Fatalf("vaults = %d, want 2", len(vaults))
	}

	// Filters forwarded as query params.
	if cap.tenantParam != tenant {
		t.Fatalf("tenant query = %q, want %q", cap.tenantParam, tenant)
	}
	if cap.groupParam != group {
		t.Fatalf("group query = %q, want %q", cap.groupParam, group)
	}
	if cap.path != "/vaults" {
		t.Fatalf("path = %q, want /vaults", cap.path)
	}
	// Auth + accept headers set.
	if cap.authorization != "Bearer tok-abc" {
		t.Fatalf("authorization = %q, want Bearer tok-abc", cap.authorization)
	}
	if cap.accept != "application/json" {
		t.Fatalf("accept = %q, want application/json", cap.accept)
	}

	// normaliseVaultRecord semantics: the second row omits external_id, so its
	// posture id falls back to the inventory id, and posture name/provider inherit
	// from the row.
	azure := findVault(t, vaults, "azure-prod-vault")
	if azure.Provider != cybervault.VaultProviderAzureBackup {
		t.Fatalf("azure provider = %q", azure.Provider)
	}
	if azure.Posture.Provider != cybervault.VaultProviderAzureBackup {
		t.Fatalf("azure posture provider = %q, want inherited", azure.Posture.Provider)
	}
	if azure.Posture.ID != "22222222-2222-2222-2222-222222222222" {
		t.Fatalf("azure posture id = %q, want inherited from row id", azure.Posture.ID)
	}
	if azure.Posture.Name != "azure-prod-vault" {
		t.Fatalf("azure posture name = %q, want inherited", azure.Posture.Name)
	}

	aws := findVault(t, vaults, "aws-prod-vault")
	if aws.ExternalID != "arn:aws:backup:vault/aws-prod" {
		t.Fatalf("aws external id = %q", aws.ExternalID)
	}
}

// TestHTTPPostureSource_FilterOmittedWhenEmpty proves empty tenant/group act as
// wildcards: no query params are sent so the gateway returns the full inventory.
func TestHTTPPostureSource_FilterOmittedWhenEmpty(t *testing.T) {
	t.Parallel()
	srv, cap := newGatewayServer(t, "", "")

	src, err := cybervault.NewHTTPPostureSource(srv.URL, "", "", srv.Client())
	if err != nil {
		t.Fatalf("NewHTTPPostureSource: %v", err)
	}
	if _, err := src.ListRegisteredVaults(context.Background(), "", ""); err != nil {
		t.Fatalf("ListRegisteredVaults: %v", err)
	}
	if cap.rawQuery != "" {
		t.Fatalf("rawQuery = %q, want empty (wildcards omit filters)", cap.rawQuery)
	}
	// No token -> no Authorization header.
	if cap.authorization != "" {
		t.Fatalf("authorization = %q, want empty when token unset", cap.authorization)
	}
}

// TestHTTPPostureSource_GetPostureMapsFields verifies posture fields decode
// correctly per provider: immutability/lock, retention, restore-test recency,
// isolation, approval and break-glass.
func TestHTTPPostureSource_GetPostureMapsFields(t *testing.T) {
	t.Parallel()

	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	srv, cap := newGatewayServer(t, tenant.String(), "")

	src, err := cybervault.NewHTTPPostureSource(srv.URL, "tok-xyz", "", srv.Client())
	if err != nil {
		t.Fatalf("NewHTTPPostureSource: %v", err)
	}

	// --- AWS Backup: fully hardened posture ---
	awsID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	aws, err := src.GetVaultPosture(context.Background(), tenant, awsID)
	if err != nil {
		t.Fatalf("GetVaultPosture(aws): %v", err)
	}
	if cap.path != "/vaults/"+awsID.String()+"/posture" {
		t.Fatalf("get path = %q", cap.path)
	}
	if cap.tenantParam != tenant.String() {
		t.Fatalf("get tenant query = %q, want %q", cap.tenantParam, tenant)
	}
	if cap.authorization != "Bearer tok-xyz" {
		t.Fatalf("get authorization = %q", cap.authorization)
	}
	if aws.Provider != cybervault.VaultProviderAWSBackup {
		t.Fatalf("aws provider = %q", aws.Provider)
	}
	if !aws.ImmutabilityEnabled || !aws.VaultLockEnabled {
		t.Fatalf("aws immutability/lock = %v/%v, want true/true", aws.ImmutabilityEnabled, aws.VaultLockEnabled)
	}
	if !aws.EncryptionEnabled || !aws.CustomerManagedKey {
		t.Fatalf("aws encryption/cmk = %v/%v", aws.EncryptionEnabled, aws.CustomerManagedKey)
	}
	if aws.Retention.MinimumDays != 35 || aws.Retention.RequiredMinimumDays != 30 {
		t.Fatalf("aws retention = %+v", aws.Retention)
	}
	if !aws.Isolation.CrossAccount || !aws.Isolation.DisjointAdmins || !aws.Isolation.SourceAdminDenied {
		t.Fatalf("aws isolation = %+v", aws.Isolation)
	}
	if !aws.Approval.RequireRestoreApproval || aws.Approval.RestoreApprovers != 2 ||
		!aws.Approval.RequireDestructiveApproval || aws.Approval.DestructiveApprovers != 2 ||
		!aws.Approval.SeparationOfDuties {
		t.Fatalf("aws approval = %+v", aws.Approval)
	}
	wantRestore := time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
	if !aws.LastRestoreTestAt.Equal(wantRestore) {
		t.Fatalf("aws last restore test = %v, want %v", aws.LastRestoreTestAt, wantRestore)
	}
	if !aws.LastRestoreTestPassed {
		t.Fatalf("aws last restore test passed = false, want true")
	}
	if !aws.BreakGlassEnabled || !aws.BreakGlassMFA {
		t.Fatalf("aws break-glass = %v/%v", aws.BreakGlassEnabled, aws.BreakGlassMFA)
	}
	if len(aws.ReplicaRegions) != 1 || aws.ReplicaRegions[0] != "us-west-2" {
		t.Fatalf("aws replica regions = %v", aws.ReplicaRegions)
	}

	// --- Azure Backup: weaker posture (lock off, no CMK, restore test failed) ---
	azureID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	azure, err := src.GetVaultPosture(context.Background(), tenant, azureID)
	if err != nil {
		t.Fatalf("GetVaultPosture(azure): %v", err)
	}
	if azure.Provider != cybervault.VaultProviderAzureBackup {
		t.Fatalf("azure provider = %q", azure.Provider)
	}
	if azure.VaultLockEnabled {
		t.Fatalf("azure vault lock = true, want false")
	}
	if azure.CustomerManagedKey {
		t.Fatalf("azure cmk = true, want false")
	}
	if azure.LastRestoreTestPassed {
		t.Fatalf("azure restore test passed = true, want false")
	}
	if !azure.LastRestoreTestAt.IsZero() {
		t.Fatalf("azure last restore test = %v, want zero (omitted)", azure.LastRestoreTestAt)
	}
	if azure.Retention.MinimumDays != 14 {
		t.Fatalf("azure retention min days = %d, want 14", azure.Retention.MinimumDays)
	}

	// --- GCP Backup-DR: posture body omits id, uses "posture" envelope key ---
	gcpID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	gcp, err := src.GetVaultPosture(context.Background(), tenant, gcpID)
	if err != nil {
		t.Fatalf("GetVaultPosture(gcp): %v", err)
	}
	if gcp.Provider != cybervault.VaultProviderGCPBackupDR {
		t.Fatalf("gcp provider = %q", gcp.Provider)
	}
	// id omitted in the body -> normalisation fills it from the requested vault id.
	if gcp.ID != gcpID.String() {
		t.Fatalf("gcp posture id = %q, want fallback to vault id %q", gcp.ID, gcpID)
	}
	if gcp.ImmutabilityEnabled {
		t.Fatalf("gcp immutability = true, want false")
	}
	if !gcp.CustomerManagedKey {
		t.Fatalf("gcp cmk = false, want true")
	}
}

// TestHTTPPostureSource_GetPostureNotFound maps a gateway 404 to ErrVaultNotFound.
func TestHTTPPostureSource_GetPostureNotFound(t *testing.T) {
	t.Parallel()
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	srv, _ := newGatewayServer(t, tenant.String(), "")

	src, err := cybervault.NewHTTPPostureSource(srv.URL, "tok", "", srv.Client())
	if err != nil {
		t.Fatalf("NewHTTPPostureSource: %v", err)
	}
	missing := uuid.MustParse("99999999-9999-9999-9999-999999999999")
	_, err = src.GetVaultPosture(context.Background(), tenant, missing)
	if !errors.Is(err, cybervault.ErrVaultNotFound) {
		t.Fatalf("err = %v, want ErrVaultNotFound", err)
	}
}

// TestHTTPPostureSource_ServerErrorIsSourceUnavailable maps a non-404 error
// status to ErrSourceUnavailable rather than ErrVaultNotFound.
func TestHTTPPostureSource_ServerErrorIsSourceUnavailable(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"upstream aws backup unreachable"}`))
	}))
	defer srv.Close()

	src, err := cybervault.NewHTTPPostureSource(srv.URL, "tok", "", srv.Client())
	if err != nil {
		t.Fatalf("NewHTTPPostureSource: %v", err)
	}

	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	vaultID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	_, err = src.GetVaultPosture(context.Background(), tenant, vaultID)
	if !errors.Is(err, cybervault.ErrSourceUnavailable) {
		t.Fatalf("err = %v, want ErrSourceUnavailable", err)
	}
	if errors.Is(err, cybervault.ErrVaultNotFound) {
		t.Fatalf("502 misclassified as ErrVaultNotFound: %v", err)
	}
	// List shares the same transport error path.
	if _, lerr := src.ListRegisteredVaults(context.Background(), "", ""); !errors.Is(lerr, cybervault.ErrSourceUnavailable) {
		t.Fatalf("list err = %v, want ErrSourceUnavailable", lerr)
	}
}

// TestHTTPPostureSource_TransportFailure proves an unreachable gateway surfaces
// ErrSourceUnavailable (not a panic / not found).
func TestHTTPPostureSource_TransportFailure(t *testing.T) {
	t.Parallel()
	// Point at a closed server to force a dial failure.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	client := srv.Client()
	url := srv.URL
	srv.Close()

	src, err := cybervault.NewHTTPPostureSource(url, "tok", "", client)
	if err != nil {
		t.Fatalf("NewHTTPPostureSource: %v", err)
	}
	if _, err := src.ListRegisteredVaults(context.Background(), "", ""); !errors.Is(err, cybervault.ErrSourceUnavailable) {
		t.Fatalf("err = %v, want ErrSourceUnavailable", err)
	}
}

// TestNewHTTPPostureSource_Validation covers constructor validation: missing base
// URL, malformed base URL, and an invalid CA bundle.
func TestNewHTTPPostureSource_Validation(t *testing.T) {
	t.Parallel()
	if _, err := cybervault.NewHTTPPostureSource("", "tok", "", nil); !errors.Is(err, cybervault.ErrInvalidRequest) {
		t.Fatalf("empty base url err = %v, want ErrInvalidRequest", err)
	}
	if _, err := cybervault.NewHTTPPostureSource("not-a-url", "tok", "", nil); !errors.Is(err, cybervault.ErrInvalidRequest) {
		t.Fatalf("bad base url err = %v, want ErrInvalidRequest", err)
	}
	if _, err := cybervault.NewHTTPPostureSource("https://gw.example", "tok", "-----BEGIN CERTIFICATE-----\nnotpem\n-----END CERTIFICATE-----", nil); !errors.Is(err, cybervault.ErrInvalidRequest) {
		t.Fatalf("bad CA err = %v, want ErrInvalidRequest", err)
	}
}

// TestNewHTTPPostureSourceFromConfig_PinsCA proves the config constructor pins a
// real CA: it builds a client from the httptest TLS server's own CA PEM and
// successfully talks to the TLS gateway over a verified connection (real TLS
// handshake, no HTTPClient override).
func TestNewHTTPPostureSourceFromConfig_PinsCA(t *testing.T) {
	t.Parallel()
	tenant := "aaaaaaaa-0000-0000-0000-000000000001"
	group := "bbbbbbbb-0000-0000-0000-000000000002"

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/vaults" {
			_, _ = w.Write([]byte(formatList(tenant, group)))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	caPEM := encodeCertPEM(t, srv)

	src, err := cybervault.NewHTTPPostureSourceFromConfig(cybervault.CloudGatewayConfig{
		BaseURL:   srv.URL,
		Token:     "tok",
		CACertPEM: caPEM,
		Timeout:   5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewHTTPPostureSourceFromConfig: %v", err)
	}
	vaults, err := src.ListRegisteredVaults(context.Background(), tenant, group)
	if err != nil {
		t.Fatalf("ListRegisteredVaults over pinned TLS: %v", err)
	}
	if len(vaults) != 2 {
		t.Fatalf("vaults = %d, want 2", len(vaults))
	}
}

// TestCloudVaultTestConnection covers the connector probe: a healthy /healthz,
// the /vaults fallback when /healthz is absent, and failure on an unauthorized
// gateway.
func TestCloudVaultTestConnection(t *testing.T) {
	t.Parallel()

	t.Run("healthz ok", func(t *testing.T) {
		t.Parallel()
		srv, cap := newGatewayServer(t, "", "")
		// Server client is not injectable into CloudVaultTestConnection, so point
		// at the plain-HTTP test server URL (no CA needed).
		if err := cybervault.CloudVaultTestConnection(context.Background(), srv.URL, "tok", ""); err != nil {
			t.Fatalf("CloudVaultTestConnection: %v", err)
		}
		if cap.path != "/healthz" {
			t.Fatalf("probe hit %q, want /healthz", cap.path)
		}
		if cap.authorization != "Bearer tok" {
			t.Fatalf("probe authorization = %q", cap.authorization)
		}
	})

	t.Run("falls back to vaults when healthz absent", func(t *testing.T) {
		t.Parallel()
		var hitVaults bool
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/healthz":
				w.WriteHeader(http.StatusNotFound)
			case "/vaults":
				hitVaults = true
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"data":[]}`))
			default:
				w.WriteHeader(http.StatusNotFound)
			}
		}))
		defer srv.Close()
		if err := cybervault.CloudVaultTestConnection(context.Background(), srv.URL, "", ""); err != nil {
			t.Fatalf("CloudVaultTestConnection fallback: %v", err)
		}
		if !hitVaults {
			t.Fatal("probe did not fall back to /vaults after 404 on /healthz")
		}
	})

	t.Run("unauthorized fails", func(t *testing.T) {
		t.Parallel()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()
		err := cybervault.CloudVaultTestConnection(context.Background(), srv.URL, "bad-token", "")
		if err == nil {
			t.Fatal("expected error on 401")
		}
		if !errors.Is(err, cybervault.ErrSourceUnavailable) {
			t.Fatalf("err = %v, want ErrSourceUnavailable", err)
		}
	})

	t.Run("bad base url fails", func(t *testing.T) {
		t.Parallel()
		if err := cybervault.CloudVaultTestConnection(context.Background(), "", "tok", ""); !errors.Is(err, cybervault.ErrInvalidRequest) {
			t.Fatalf("err = %v, want ErrInvalidRequest", err)
		}
	})
}

func findVault(t *testing.T, vaults []cybervault.RegisteredVault, name string) cybervault.RegisteredVault {
	t.Helper()
	for _, v := range vaults {
		if v.Name == name {
			return v
		}
	}
	t.Fatalf("vault %q not found in %d results", name, len(vaults))
	return cybervault.RegisteredVault{}
}

// encodeCertPEM returns the PEM of the httptest TLS server's leaf certificate,
// which doubles as its CA for verification in tests.
func encodeCertPEM(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	cert := srv.Certificate()
	if cert == nil {
		t.Fatal("httptest TLS server has no certificate")
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw}))
}
