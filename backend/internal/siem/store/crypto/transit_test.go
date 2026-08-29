package crypto

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/clario360/platform/internal/vault"
)

// fakeVault is the minimal vault.Client implementation used by transit tests.
type fakeVault struct {
	ensureErr error
	genResult vault.DataKey
	genErr    error
	decErr    error
	decBytes  []byte
}

func (f *fakeVault) EnsureTransitKey(ctx context.Context, keyName string) error {
	return f.ensureErr
}
func (f *fakeVault) GenerateDataKey(ctx context.Context, keyName string) (vault.DataKey, error) {
	return f.genResult, f.genErr
}
func (f *fakeVault) Decrypt(ctx context.Context, keyName string, env []byte) ([]byte, error) {
	if f.decErr != nil {
		return nil, f.decErr
	}
	return f.decBytes, nil
}
func (f *fakeVault) Health(ctx context.Context) error { return nil }
func (f *fakeVault) Close() error                     { return nil }

// SIEM-03 PKI methods (no-op stubs).
func (f *fakeVault) EnsurePKIMount(ctx context.Context, mountPath string, defaultTTL, maxTTL time.Duration) error {
	return nil
}
func (f *fakeVault) GenerateRootCA(ctx context.Context, mountPath, commonName string, ttl time.Duration) (string, error) {
	return "", nil
}
func (f *fakeVault) EnsureIntermediate(ctx context.Context, rootMount, intermediateMount, commonName string, ttl time.Duration) (string, error) {
	return "", nil
}
func (f *fakeVault) EnsurePKIRole(ctx context.Context, mountPath, roleName string, settings vault.PKIRoleSettings) error {
	return nil
}
func (f *fakeVault) IssueLeaf(ctx context.Context, mountPath, roleName, csrPEM, commonName string, ttl time.Duration) (vault.LeafCert, error) {
	return vault.LeafCert{}, nil
}
func (f *fakeVault) RevokeLeaf(ctx context.Context, mountPath, serial string) error {
	return nil
}

func TestNewTransit_NilVault(t *testing.T) {
	tr := NewTransit(nil)
	if err := tr.EnsureKey(context.Background(), "k"); err == nil {
		t.Error("expected error on nil vault")
	}
	if _, _, _, err := tr.Generate(context.Background(), "k"); err == nil {
		t.Error("expected generate error on nil vault")
	}
	if _, err := tr.Decrypt(context.Background(), "k", nil); err == nil {
		t.Error("expected decrypt error on nil vault")
	}
}

func TestTransit_EnsureKey(t *testing.T) {
	vc := &fakeVault{}
	tr := NewTransit(vc)
	if err := tr.EnsureKey(context.Background(), "k"); err != nil {
		t.Fatalf("EnsureKey: %v", err)
	}
	vc.ensureErr = errors.New("boom")
	if err := tr.EnsureKey(context.Background(), "k"); err == nil {
		t.Error("expected wrapped error")
	} else if !errors.Is(err, ErrDEKUnavailable) {
		t.Errorf("error not wrapped as ErrDEKUnavailable: %v", err)
	}
}

func TestTransit_Generate(t *testing.T) {
	dek := make([]byte, 32)
	vc := &fakeVault{
		genResult: vault.DataKey{
			Plaintext:  dek,
			Ciphertext: []byte("vault:v1:abc"),
			KEKVersion: 1,
		},
	}
	tr := NewTransit(vc)
	pt, env, ver, err := tr.Generate(context.Background(), "k")
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if len(pt) != 32 {
		t.Errorf("plaintext len = %d, want 32", len(pt))
	}
	if string(env) != "vault:v1:abc" {
		t.Errorf("envelope = %s", env)
	}
	if ver != 1 {
		t.Errorf("ver = %d", ver)
	}

	// Short DEK rejected.
	vc.genResult.Plaintext = []byte("short")
	if _, _, _, err := tr.Generate(context.Background(), "k"); err == nil {
		t.Error("expected error on short DEK")
	} else if !errors.Is(err, ErrInvalidDEK) {
		t.Errorf("err = %v, want ErrInvalidDEK", err)
	}
}

func TestTransit_Decrypt(t *testing.T) {
	dek := make([]byte, 32)
	vc := &fakeVault{decBytes: dek}
	tr := NewTransit(vc)
	pt, err := tr.Decrypt(context.Background(), "k", []byte("vault:v1:x"))
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if len(pt) != 32 {
		t.Errorf("len = %d", len(pt))
	}

	vc.decBytes = []byte("short")
	if _, err := tr.Decrypt(context.Background(), "k", []byte("vault:v1:x")); err == nil {
		t.Error("expected short-DEK error")
	} else if !errors.Is(err, ErrInvalidDEK) {
		t.Errorf("err = %v", err)
	}

	vc.decBytes = nil
	vc.decErr = errors.New("denied")
	if _, err := tr.Decrypt(context.Background(), "k", []byte("vault:v1:x")); err == nil {
		t.Error("expected decrypt error")
	} else if !errors.Is(err, ErrDEKUnavailable) {
		t.Errorf("err = %v", err)
	}
}
