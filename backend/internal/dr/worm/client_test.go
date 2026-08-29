package worm

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	miniogo "github.com/minio/minio-go/v7"
	"github.com/rs/zerolog"
)

type fakeDEKProvider struct {
	key []byte
}

func (f fakeDEKProvider) Get(context.Context, uuid.UUID, string) ([]byte, int, error) {
	return append([]byte(nil), f.key...), 7, nil
}

type releasingDEKProvider struct {
	key      []byte
	released bool
}

func (f *releasingDEKProvider) Get(context.Context, uuid.UUID, string) ([]byte, int, error) {
	return f.key, 11, nil
}

func (f *releasingDEKProvider) ReleaseDEK(dek []byte) {
	f.released = true
	for i := range dek {
		dek[i] = 0
	}
}

func TestCopyDEK_ReleasesProviderBytesAfterCopy(t *testing.T) {
	t.Parallel()

	original := bytes.Repeat([]byte{0x42}, 32)
	provider := &releasingDEKProvider{key: append([]byte(nil), original...)}
	client := &Client{dek: provider}

	got, version, err := client.copyDEK(context.Background(), uuid.New(), "stream-a")
	if err != nil {
		t.Fatalf("copyDEK: %v", err)
	}
	if version != 11 {
		t.Fatalf("version = %d, want 11", version)
	}
	if !provider.released {
		t.Fatal("ReleaseDEK was not called")
	}
	if !bytes.Equal(got, original) {
		t.Fatalf("copied key = %x, want %x", got, original)
	}
	if !bytes.Equal(provider.key, make([]byte, len(provider.key))) {
		t.Fatalf("provider key was not released/zeroed: %x", provider.key)
	}
}

func TestNew_ValidatesRequiredConfig(t *testing.T) {
	t.Parallel()

	key := bytes.Repeat([]byte{1}, 32)
	tests := []struct {
		name string
		cfg  Config
		dek  DEKProvider
	}{
		{name: "endpoint", cfg: Config{Bucket: "dr-recovery-points"}, dek: fakeDEKProvider{key: key}},
		{name: "bucket", cfg: Config{Endpoint: "127.0.0.1:9000"}, dek: fakeDEKProvider{key: key}},
		{name: "dek", cfg: Config{Endpoint: "127.0.0.1:9000", Bucket: "dr-recovery-points"}},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if _, err := New(tt.cfg, tt.dek, zerolog.Nop()); err == nil {
				t.Fatal("New succeeded, want error")
			}
		})
	}
}

func TestAESGCMSealOpen_RoundTripAndTamperDetection(t *testing.T) {
	t.Parallel()

	key := bytes.Repeat([]byte{9}, 32)
	plaintext := []byte("consistent recovery chunk")
	ciphertext, err := aesGCMSeal(key, plaintext)
	if err != nil {
		t.Fatalf("aesGCMSeal: %v", err)
	}
	if bytes.Contains(ciphertext, plaintext) {
		t.Fatal("ciphertext contains plaintext")
	}
	got, err := aesGCMOpen(key, ciphertext)
	if err != nil {
		t.Fatalf("aesGCMOpen: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("plaintext = %q, want %q", got, plaintext)
	}

	ciphertext[len(ciphertext)-1] ^= 0xff
	if _, err := aesGCMOpen(key, ciphertext); err == nil {
		t.Fatal("tampered ciphertext decrypted successfully")
	}
}

func TestObjectKey_SanitizesMarkerAndIncludesScope(t *testing.T) {
	t.Parallel()

	tenantID := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	key := objectKey(tenantID, "stream-1", "0/16 B6248", time.Date(2026, 6, 13, 1, 2, 3, 0, time.UTC))
	prefix := "aaaaaaaa-0000-0000-0000-000000000001/2026/06/stream-1/0_16_B6248/"
	if !strings.HasPrefix(key, prefix) || !strings.HasSuffix(key, ".chunk") {
		t.Fatalf("key = %q, want prefix %q and .chunk suffix", key, prefix)
	}
}

func TestNormalizeRetentionMode_DefaultsToGovernance(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in   string
		want string
	}{
		{"", RetentionModeGovernance},
		{"governance", RetentionModeGovernance},
		{"GOVERNANCE", RetentionModeGovernance},
		{"  compliance  ", RetentionModeCompliance},
		{"Compliance", RetentionModeCompliance},
		{"COMPLIANCE", RetentionModeCompliance},
		{"nonsense", RetentionModeGovernance},
	}
	for _, tc := range cases {
		if got := normalizeRetentionMode(tc.in); got != tc.want {
			t.Errorf("normalizeRetentionMode(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestRetentionMode_MapsToMinioMode(t *testing.T) {
	t.Parallel()

	gov := &Client{cfg: DEKConfig{Config: Config{RetentionMode: RetentionModeGovernance}}}
	if gov.retentionMode() != miniogo.Governance {
		t.Fatalf("governance client mode = %v, want %v", gov.retentionMode(), miniogo.Governance)
	}
	comp := &Client{cfg: DEKConfig{Config: Config{RetentionMode: RetentionModeCompliance}}}
	if comp.retentionMode() != miniogo.Compliance {
		t.Fatalf("compliance client mode = %v, want %v", comp.retentionMode(), miniogo.Compliance)
	}
	// Empty normalizes to governance to preserve behavior.
	empty := &Client{cfg: DEKConfig{Config: Config{}}}
	if empty.retentionMode() != miniogo.Governance {
		t.Fatalf("empty client mode = %v, want %v", empty.retentionMode(), miniogo.Governance)
	}
}

func TestNew_NormalizesRetentionMode(t *testing.T) {
	t.Parallel()

	key := bytes.Repeat([]byte{1}, 32)
	c, err := New(Config{
		Endpoint:      "127.0.0.1:9000",
		Bucket:        "dr-recovery-points",
		Region:        "me-central-1",
		RetentionMode: "COMPLIANCE",
	}, fakeDEKProvider{key: key}, zerolog.Nop())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.retentionMode() != miniogo.Compliance {
		t.Fatalf("mode = %v, want Compliance", c.retentionMode())
	}
}

func TestBypassDelete_RefusedUnderCompliance(t *testing.T) {
	t.Parallel()

	// api is nil: if BypassDelete did not short-circuit it would panic; the
	// refusal must happen before any store call.
	c := &Client{cfg: DEKConfig{Config: Config{RetentionMode: RetentionModeCompliance, Bucket: "b"}}}
	err := c.BypassDelete(context.Background(), "some/key.chunk")
	if !errors.Is(err, ErrComplianceBypass) {
		t.Fatalf("BypassDelete under compliance = %v, want ErrComplianceBypass", err)
	}
}

func TestNew_RequireExplicitRegion(t *testing.T) {
	t.Parallel()

	key := bytes.Repeat([]byte{1}, 32)

	// Empty region + RequireExplicitRegion => hard error.
	if _, err := New(Config{
		Endpoint:              "127.0.0.1:9000",
		Bucket:                "dr-recovery-points",
		RequireExplicitRegion: true,
	}, fakeDEKProvider{key: key}, zerolog.Nop()); !errors.Is(err, ErrRegionRequired) {
		t.Fatalf("New with empty region + require = %v, want ErrRegionRequired", err)
	}

	// Explicit region + RequireExplicitRegion => ok.
	if _, err := New(Config{
		Endpoint:              "127.0.0.1:9000",
		Bucket:                "dr-recovery-points",
		Region:                "me-central-1",
		RequireExplicitRegion: true,
	}, fakeDEKProvider{key: key}, zerolog.Nop()); err != nil {
		t.Fatalf("New with explicit region + require: %v", err)
	}

	// Empty region + default (require off) => falls back to DefaultRegion, no error.
	c, err := New(Config{
		Endpoint: "127.0.0.1:9000",
		Bucket:   "dr-recovery-points",
	}, fakeDEKProvider{key: key}, zerolog.Nop())
	if err != nil {
		t.Fatalf("New with empty region + default: %v", err)
	}
	if c.cfg.Region != DefaultRegion {
		t.Fatalf("fallback region = %q, want %q", c.cfg.Region, DefaultRegion)
	}
}

func TestEvaluateObjectLock_AssertsEnabledAndModeMatch(t *testing.T) {
	t.Parallel()

	gov := miniogo.Governance
	comp := miniogo.Compliance

	govClient := &Client{cfg: DEKConfig{Config: Config{Bucket: "b", RetentionMode: RetentionModeGovernance}}, log: zerolog.Nop()}
	compClient := &Client{cfg: DEKConfig{Config: Config{Bucket: "b", RetentionMode: RetentionModeCompliance}}, log: zerolog.Nop()}

	cases := []struct {
		name       string
		client     *Client
		objectLock string
		mode       *miniogo.RetentionMode
		wantErr    error // nil for success
	}{
		{name: "enabled+matching governance mode", client: govClient, objectLock: "Enabled", mode: &gov, wantErr: nil},
		{name: "enabled, no default rule (nil mode) is fine", client: govClient, objectLock: "Enabled", mode: nil, wantErr: nil},
		{name: "enabled case-insensitive", client: govClient, objectLock: "enabled", mode: &gov, wantErr: nil},
		{name: "compliance client + compliance bucket", client: compClient, objectLock: "Enabled", mode: &comp, wantErr: nil},
		// Fail-closed: a plain bucket reports an empty / non-Enabled marker.
		{name: "not enabled (empty)", client: govClient, objectLock: "", mode: nil, wantErr: ErrObjectLockNotEnabled},
		{name: "not enabled (disabled marker)", client: govClient, objectLock: "Disabled", mode: nil, wantErr: ErrObjectLockNotEnabled},
		// Fail-closed: enabled but the default mode disagrees with configuration.
		{name: "governance client, compliance bucket mode", client: govClient, objectLock: "Enabled", mode: &comp, wantErr: ErrObjectLockModeMismatch},
		{name: "compliance client, governance bucket mode", client: compClient, objectLock: "Enabled", mode: &gov, wantErr: ErrObjectLockModeMismatch},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := tc.client.evaluateObjectLock(tc.objectLock, tc.mode)
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("evaluateObjectLock(%q, %v) = %v, want nil", tc.objectLock, tc.mode, err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("evaluateObjectLock(%q, %v) = %v, want %v", tc.objectLock, tc.mode, err, tc.wantErr)
			}
		})
	}
}

func TestIsObjectLockNotConfigured_DetectsMissingConfig(t *testing.T) {
	t.Parallel()

	notConfigured := []error{
		miniogo.ErrorResponse{Code: "ObjectLockConfigurationNotFoundError"},
		miniogo.ErrorResponse{Code: "ObjectLockConfigurationNotFound"},
		miniogo.ErrorResponse{Message: "Object Lock configuration does not exist for this bucket"},
	}
	for _, e := range notConfigured {
		if !isObjectLockNotConfigured(e) {
			t.Fatalf("isObjectLockNotConfigured(%v) = false, want true", e)
		}
	}

	other := []error{
		miniogo.ErrorResponse{Code: "AccessDenied", StatusCode: http.StatusForbidden},
		miniogo.ErrorResponse{Code: "NoSuchBucket"},
		errors.New("dial tcp: connection refused"),
	}
	for _, e := range other {
		if isObjectLockNotConfigured(e) {
			t.Fatalf("isObjectLockNotConfigured(%v) = true, want false (not a missing-config signal)", e)
		}
	}
}

func TestClassify_MapsObjectLockAndNotFoundErrors(t *testing.T) {
	t.Parallel()

	notFound := classify(miniogo.ErrorResponse{Code: "NoSuchKey", StatusCode: http.StatusNotFound})
	if !errors.Is(notFound, ErrObjectNotFound) {
		t.Fatalf("notFound = %v, want ErrObjectNotFound", notFound)
	}

	locked := classify(miniogo.ErrorResponse{Code: "AccessDenied", StatusCode: http.StatusForbidden, Message: "object lock active"})
	if !errors.Is(locked, ErrObjectLocked) {
		t.Fatalf("locked = %v, want ErrObjectLocked", locked)
	}

	other := errors.New("plain error")
	if classify(other) != other {
		t.Fatal("unclassified error was not returned unchanged")
	}
}
