package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/agent"
)

func TestRenewIdentityOnceReadsTokenFileAndPublishesIdentity(t *testing.T) {
	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "rotate.jwt")
	if err := os.WriteFile(tokenPath, []byte(" fresh-token \n"), 0o600); err != nil {
		t.Fatalf("write token: %v", err)
	}
	store, err := agent.NewIdentityStore(dir)
	if err != nil {
		t.Fatalf("identity store: %v", err)
	}
	provider, err := agent.NewMutableIdentityProvider(&agent.Identity{
		Serial:   "old",
		NotAfter: time.Now().UTC().Add(5 * time.Minute),
	})
	if err != nil {
		t.Fatalf("identity provider: %v", err)
	}
	next := &agent.Identity{
		LeafPEM:  []byte("cert"),
		KeyPEM:   []byte("key"),
		Serial:   "new",
		NotAfter: time.Now().UTC().Add(48 * time.Hour),
	}
	client := &fakeRenewClient{next: next}
	cfg := baseAgentConfig()
	cfg.ControlPlaneURL = "https://dr.example.com:8097"
	cfg.RenewalTokenFile = tokenPath
	cfg.CertRenewBefore = time.Hour

	renewed, err := renewIdentityOnce(context.Background(), cfg, store, provider, client)
	if err != nil {
		t.Fatalf("renewIdentityOnce: %v", err)
	}
	if !renewed {
		t.Fatal("renewed = false, want true")
	}
	if client.got.Token != "fresh-token" {
		t.Fatalf("token = %q, want fresh-token", client.got.Token)
	}
	current, err := provider.Identity()
	if err != nil {
		t.Fatalf("provider identity: %v", err)
	}
	if current.Serial != "new" {
		t.Fatalf("published serial = %q, want new", current.Serial)
	}
	if _, err := os.Stat(filepath.Join(dir, "agent-cert.pem")); err != nil {
		t.Fatalf("renewed cert was not persisted: %v", err)
	}
}

func TestRenewIdentityOnceNoopsOutsideRenewalWindow(t *testing.T) {
	store, _ := agent.NewIdentityStore(t.TempDir())
	provider, _ := agent.NewMutableIdentityProvider(&agent.Identity{
		Serial:   "old",
		NotAfter: time.Now().UTC().Add(48 * time.Hour),
	})
	cfg := baseAgentConfig()
	cfg.ControlPlaneURL = "https://dr.example.com:8097"
	cfg.EnrollmentToken = "unused"
	cfg.CertRenewBefore = time.Hour
	client := &fakeRenewClient{next: &agent.Identity{LeafPEM: []byte("cert"), KeyPEM: []byte("key")}}

	renewed, err := renewIdentityOnce(context.Background(), cfg, store, provider, client)
	if err != nil {
		t.Fatalf("renewIdentityOnce: %v", err)
	}
	if renewed {
		t.Fatal("renewed = true, want false")
	}
	if client.calls != 0 {
		t.Fatalf("enroll calls = %d, want 0", client.calls)
	}
}

func TestRenewIdentityOnceRequiresFreshToken(t *testing.T) {
	store, _ := agent.NewIdentityStore(t.TempDir())
	provider, _ := agent.NewMutableIdentityProvider(&agent.Identity{
		Serial:   "old",
		NotAfter: time.Now().UTC().Add(5 * time.Minute),
	})
	cfg := baseAgentConfig()
	cfg.ControlPlaneURL = "https://dr.example.com:8097"
	cfg.EnrollmentToken = ""
	cfg.CertRenewBefore = time.Hour

	_, err := renewIdentityOnce(context.Background(), cfg, store, provider, &fakeRenewClient{})
	if !errors.Is(err, errNoRenewalToken) {
		t.Fatalf("err = %v, want errNoRenewalToken", err)
	}
}

func TestNextRenewalDelay(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	notAfter := now.Add(10 * time.Hour)

	if got := nextRenewalDelay(now, notAfter, time.Hour, 30*time.Minute); got != 30*time.Minute {
		t.Fatalf("delay before window = %s, want 30m", got)
	}
	if got := nextRenewalDelay(now, now.Add(45*time.Minute), time.Hour, 30*time.Minute); got != 0 {
		t.Fatalf("delay in window = %s, want 0", got)
	}
}

type fakeRenewClient struct {
	calls int
	got   agent.EnrollConfig
	next  *agent.Identity
	err   error
}

func (f *fakeRenewClient) Enroll(_ context.Context, cfg agent.EnrollConfig) (*agent.Identity, error) {
	f.calls++
	f.got = cfg
	if f.err != nil {
		return nil, f.err
	}
	return f.next, nil
}
