package vault

import (
	"context"
	"errors"
	"testing"
	"time"
)

// stubClient is a minimal Client used for health-checker unit tests.
type stubClient struct {
	healthErr error
}

func (s *stubClient) EnsureTransitKey(context.Context, string) error { return nil }
func (s *stubClient) GenerateDataKey(context.Context, string) (DataKey, error) {
	return DataKey{}, nil
}
func (s *stubClient) Decrypt(context.Context, string, []byte) ([]byte, error) { return nil, nil }
func (s *stubClient) Health(context.Context) error                            { return s.healthErr }
func (s *stubClient) EnsurePKIMount(context.Context, string, time.Duration, time.Duration) error {
	return nil
}
func (s *stubClient) GenerateRootCA(context.Context, string, string, time.Duration) (string, error) {
	return "", nil
}
func (s *stubClient) EnsureIntermediate(context.Context, string, string, string, time.Duration) (string, error) {
	return "", nil
}
func (s *stubClient) EnsurePKIRole(context.Context, string, string, PKIRoleSettings) error {
	return nil
}
func (s *stubClient) IssueLeaf(context.Context, string, string, string, string, time.Duration) (LeafCert, error) {
	return LeafCert{}, nil
}
func (s *stubClient) RevokeLeaf(context.Context, string, string) error { return nil }
func (s *stubClient) Close() error                                     { return nil }

func TestHealthCheckerStates(t *testing.T) {
	t.Parallel()

	cfg := Config{Addr: "http://v", AuthMethod: AuthMethodToken, Token: "x"}

	tests := []struct {
		name       string
		err        error
		wantStatus string
		wantDetail string // key in details that must be present
	}{
		{name: "healthy", err: nil, wantStatus: "healthy", wantDetail: "sealed"},
		{name: "sealed", err: ErrVaultSealed, wantStatus: "unhealthy", wantDetail: "sealed"},
		{name: "standby", err: ErrStandby, wantStatus: "degraded", wantDetail: "standby"},
		{name: "unknown error", err: errors.New("boom"), wantStatus: "unhealthy", wantDetail: "addr"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			hc := NewHealthChecker(&stubClient{healthErr: tc.err}, cfg)
			if hc.Name() != "vault_transit" {
				t.Fatalf("name: %q", hc.Name())
			}
			res := hc.Check(context.Background())
			if res.Status != tc.wantStatus {
				t.Errorf("want status %s, got %s", tc.wantStatus, res.Status)
			}
			if _, ok := res.Details[tc.wantDetail]; !ok {
				t.Errorf("missing detail key %q in %+v", tc.wantDetail, res.Details)
			}
		})
	}
}

func TestHealthCheckerDetailsCarryConfig(t *testing.T) {
	t.Parallel()
	cfg := Config{Addr: "http://v.example", AuthMethod: AuthMethodAppRole, AppRoleRoleID: "r", AppRoleSecretID: "s"}
	hc := NewHealthChecker(&stubClient{}, cfg)
	res := hc.Check(context.Background())
	if res.Details["addr"] != "http://v.example" {
		t.Errorf("addr detail: %v", res.Details["addr"])
	}
	if res.Details["auth_method"] != AuthMethodAppRole {
		t.Errorf("auth_method detail: %v", res.Details["auth_method"])
	}
}
