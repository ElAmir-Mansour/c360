package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
)

func TestCommandRecoveryTargetDriverEnsurePassesPrivateRestoreFile(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	plaintext := []byte("restored checkpoint bytes")
	wantSum := sha256.Sum256(plaintext)
	var seen commandRecoveryRequest

	driver, err := NewCommandRecoveryTargetDriver(CommandRecoveryTargetDriverConfig{
		EnsureCommand:   []string{"/bin/dr-provision", "ensure"},
		TeardownCommand: []string{"/bin/dr-provision", "teardown"},
		Timeout:         time.Minute,
	})
	if err != nil {
		t.Fatalf("NewCommandRecoveryTargetDriver: %v", err)
	}
	driver.runner = func(_ context.Context, argv []string, _ []string, stdin []byte) ([]byte, error) {
		if len(argv) != 2 || argv[1] != "ensure" {
			t.Fatalf("argv = %#v, want ensure command", argv)
		}
		if err := json.Unmarshal(stdin, &seen); err != nil {
			t.Fatalf("request json: %v", err)
		}
		if seen.Action != "ensure" {
			t.Fatalf("action = %q, want ensure", seen.Action)
		}
		if seen.PlaintextPath == "" {
			t.Fatal("plaintext path was empty")
		}
		info, err := os.Stat(seen.PlaintextPath)
		if err != nil {
			t.Fatalf("stat plaintext path: %v", err)
		}
		if gotMode := info.Mode().Perm(); gotMode != 0o600 {
			t.Fatalf("plaintext file mode = %v, want 0600", gotMode)
		}
		got, err := os.ReadFile(seen.PlaintextPath)
		if err != nil {
			t.Fatalf("read plaintext file: %v", err)
		}
		if string(got) != string(plaintext) {
			t.Fatalf("plaintext = %q, want %q", got, plaintext)
		}
		return []byte(`{"external_id":"vm-123"}`), nil
	}

	externalID, err := driver.Ensure(context.Background(), RestoreContext{
		IdempotencyKey:    "run|site|rp",
		TenantID:          tenantID,
		GroupID:           "group-1",
		SiteID:            "site-1",
		StreamID:          "stream-1",
		RecoveryEndpoint:  "k8s://cluster/ns",
		Plaintext:         plaintext,
		ObjectKey:         "rp/stream-1",
		Profile:           model.NetworkProfileProduction,
		PrimaryToRecovery: map[string]string{"10.0.0.0/24": "10.1.0.0/24"},
	})
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if externalID != "vm-123" {
		t.Fatalf("externalID = %q, want vm-123", externalID)
	}
	if seen.PlaintextBytes != len(plaintext) {
		t.Fatalf("plaintext bytes = %d, want %d", seen.PlaintextBytes, len(plaintext))
	}
	if seen.PlaintextSHA256 != hex.EncodeToString(wantSum[:]) {
		t.Fatalf("plaintext sha256 = %q, want %q", seen.PlaintextSHA256, hex.EncodeToString(wantSum[:]))
	}
	if _, err := os.Stat(seen.PlaintextPath); !os.IsNotExist(err) {
		t.Fatalf("plaintext temp file still exists after Ensure: %v", err)
	}
}

func TestCommandRecoveryTargetDriverEnsurePassesInstantDescriptor(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	var seen commandRecoveryRequest

	driver, err := NewCommandRecoveryTargetDriver(CommandRecoveryTargetDriverConfig{
		EnsureCommand:   []string{"/bin/dr-provision", "ensure"},
		TeardownCommand: []string{"/bin/dr-provision", "teardown"},
		Timeout:         time.Minute,
	})
	if err != nil {
		t.Fatalf("NewCommandRecoveryTargetDriver: %v", err)
	}
	driver.runner = func(_ context.Context, argv []string, _ []string, stdin []byte) ([]byte, error) {
		if len(argv) != 2 || argv[1] != "ensure" {
			t.Fatalf("argv = %#v, want ensure command", argv)
		}
		if err := json.Unmarshal(stdin, &seen); err != nil {
			t.Fatalf("request json: %v", err)
		}
		if seen.PlaintextPath != "" || seen.PlaintextBytes != 0 || seen.PlaintextSHA256 != "" {
			t.Fatalf("instant request unexpectedly carried plaintext fields: %+v", seen)
		}
		return []byte(`{"external_id":"vm-instant"}`), nil
	}

	externalID, err := driver.Ensure(context.Background(), RestoreContext{
		IdempotencyKey:         "run|site|rp",
		TenantID:               tenantID,
		GroupID:                "group-1",
		SiteID:                 "site-1",
		StreamID:               "stream-1",
		RecoveryEndpoint:       "k8s://cluster/ns",
		ObjectKey:              "instant:session-1",
		InstantSessionID:       "session-1",
		InstantOverlayLocation: "file:/var/lib/clario/instant",
		InstantChunkSize:       4096,
		InstantChunksTotal:     12,
		Profile:                model.NetworkProfileProduction,
	})
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if externalID != "vm-instant" {
		t.Fatalf("externalID = %q, want vm-instant", externalID)
	}
	if seen.InstantSessionID != "session-1" || seen.InstantOverlay != "file:/var/lib/clario/instant" {
		t.Fatalf("instant descriptor not passed: %+v", seen)
	}
	if seen.InstantChunkSize != 4096 || seen.InstantChunks != 12 {
		t.Fatalf("instant geometry not passed: %+v", seen)
	}
}

func TestCommandRecoveryTargetDriverEnsureRequiresExternalID(t *testing.T) {
	driver, err := NewCommandRecoveryTargetDriver(CommandRecoveryTargetDriverConfig{
		EnsureCommand:   []string{"/bin/dr-provision", "ensure"},
		TeardownCommand: []string{"/bin/dr-provision", "teardown"},
	})
	if err != nil {
		t.Fatalf("NewCommandRecoveryTargetDriver: %v", err)
	}
	driver.runner = func(context.Context, []string, []string, []byte) ([]byte, error) {
		return []byte(`{"external_id":""}`), nil
	}

	_, err = driver.Ensure(context.Background(), RestoreContext{
		TenantID:  uuid.New(),
		SiteID:    "site-1",
		StreamID:  "stream-1",
		Plaintext: []byte("bytes"),
	})
	if err == nil {
		t.Fatal("expected missing external_id error")
	}
}

func TestCommandRecoveryTargetDriverTeardown(t *testing.T) {
	var seen commandRecoveryRequest
	driver, err := NewCommandRecoveryTargetDriver(CommandRecoveryTargetDriverConfig{
		EnsureCommand:   []string{"/bin/dr-provision", "ensure"},
		TeardownCommand: []string{"/bin/dr-provision", "teardown"},
	})
	if err != nil {
		t.Fatalf("NewCommandRecoveryTargetDriver: %v", err)
	}
	driver.runner = func(_ context.Context, argv []string, _ []string, stdin []byte) ([]byte, error) {
		if len(argv) != 2 || argv[1] != "teardown" {
			t.Fatalf("argv = %#v, want teardown command", argv)
		}
		if err := json.Unmarshal(stdin, &seen); err != nil {
			t.Fatalf("request json: %v", err)
		}
		return []byte(`{"ok":true}`), nil
	}

	err = driver.Teardown(context.Background(), "vm-123", RestoreContext{
		TenantID: uuid.New(),
		SiteID:   "site-1",
		StreamID: "stream-1",
		Profile:  model.NetworkProfileIsolated,
		Drill:    true,
	})
	if err != nil {
		t.Fatalf("Teardown: %v", err)
	}
	if seen.Action != "teardown" || seen.ExternalID != "vm-123" || !seen.Drill {
		t.Fatalf("teardown request = %+v", seen)
	}
}
