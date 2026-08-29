package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	drprovider "github.com/clario360/platform/internal/dr/provider"
)

// CommandRecoveryTargetDriverConfig wires the external recovery provisioner.
// Commands are argv arrays, not shell strings. The provisioner receives a JSON
// request on stdin and must return {"external_id":"..."} for ensure.
type CommandRecoveryTargetDriverConfig struct {
	EnsureCommand   []string
	TeardownCommand []string
	Timeout         time.Duration
	Env             []string
}

// CommandRecoveryTargetDriver is the production generic RecoveryTargetDriver.
// It lets deployments bind the executor to Kubernetes, hypervisor, database, or
// storage restore tooling without recompiling clario-dr-service.
type CommandRecoveryTargetDriver struct {
	ensure   []string
	teardown []string
	timeout  time.Duration
	env      []string
	runner   commandRunner
}

type commandRunner func(ctx context.Context, argv []string, env []string, stdin []byte) ([]byte, error)

type commandRecoveryRequest struct {
	Action            string            `json:"action"`
	IdempotencyKey    string            `json:"idempotency_key"`
	TenantID          string            `json:"tenant_id"`
	GroupID           string            `json:"group_id"`
	SiteID            string            `json:"site_id"`
	StreamID          string            `json:"stream_id"`
	RecoveryEndpoint  string            `json:"recovery_endpoint,omitempty"`
	ObjectKey         string            `json:"object_key,omitempty"`
	PlaintextPath     string            `json:"plaintext_path,omitempty"`
	PlaintextSHA256   string            `json:"plaintext_sha256,omitempty"`
	PlaintextBytes    int               `json:"plaintext_bytes,omitempty"`
	InstantSessionID  string            `json:"instant_session_id,omitempty"`
	InstantOverlay    string            `json:"instant_overlay_location,omitempty"`
	InstantChunkSize  int               `json:"instant_chunk_size,omitempty"`
	InstantChunks     int               `json:"instant_chunks_total,omitempty"`
	Profile           string            `json:"network_profile"`
	PrimaryToRecovery map[string]string `json:"primary_to_recovery,omitempty"`
	Drill             bool              `json:"drill"`
	ExternalID        string            `json:"external_id,omitempty"`
}

type commandRecoveryResponse struct {
	ExternalID string `json:"external_id"`
}

// NewCommandRecoveryTargetDriver constructs a command-backed recovery target
// driver. Both ensure and teardown are required because rollback/drill teardown
// must be available before a production failover can start.
func NewCommandRecoveryTargetDriver(cfg CommandRecoveryTargetDriverConfig) (*CommandRecoveryTargetDriver, error) {
	if len(cfg.EnsureCommand) == 0 || strings.TrimSpace(cfg.EnsureCommand[0]) == "" {
		return nil, errors.New("command recovery driver: ensure command is required")
	}
	if len(cfg.TeardownCommand) == 0 || strings.TrimSpace(cfg.TeardownCommand[0]) == "" {
		return nil, errors.New("command recovery driver: teardown command is required")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Minute
	}
	return &CommandRecoveryTargetDriver{
		ensure:   compactCommand(cfg.EnsureCommand),
		teardown: compactCommand(cfg.TeardownCommand),
		timeout:  cfg.Timeout,
		env:      append([]string(nil), cfg.Env...),
		runner:   runCommandJSON,
	}, nil
}

// RecoveryCapabilities marks command recovery as a custom extension. It remains
// useful for deployment-specific automation, but is not certified-provider
// compatible for regulated recovery mode.
func (d *CommandRecoveryTargetDriver) RecoveryCapabilities() drprovider.Capabilities {
	return drprovider.Capabilities{
		Kind:                drprovider.KindCustom,
		DisplayName:         "Custom command recovery",
		Live:                true,
		SDKBacked:           false,
		SupportsEnsure:      true,
		SupportsTeardown:    true,
		SupportsDrill:       true,
		SupportsIdempotency: true,
		RegulatedCompatible: false,
		RequiredConfig:      []string{"ensure_command", "teardown_command"},
		Notes: []string{
			"custom extension; not a certified recovery provider",
		},
	}
}

// Ensure restores one target by either passing an instant COW session descriptor
// to the provisioner or, without instant recovery, writing the decrypted chunk to
// a private temp file and passing that path.
func (d *CommandRecoveryTargetDriver) Ensure(ctx context.Context, rc RestoreContext) (string, error) {
	req := newCommandRecoveryRequest("ensure", rc)
	if rc.InstantSessionID != "" {
		return d.ensureWithRequest(ctx, rc.SiteID, req)
	}
	if len(rc.Plaintext) == 0 {
		return "", fmt.Errorf("command recovery driver: empty restored chunk for stream %s", rc.StreamID)
	}
	path, cleanup, err := writeRestoreTemp(rc.Plaintext)
	if err != nil {
		return "", err
	}
	defer cleanup()

	req.PlaintextPath = path
	req.PlaintextBytes = len(rc.Plaintext)
	sum := sha256.Sum256(rc.Plaintext)
	req.PlaintextSHA256 = hex.EncodeToString(sum[:])

	return d.ensureWithRequest(ctx, rc.SiteID, req)
}

func (d *CommandRecoveryTargetDriver) ensureWithRequest(ctx context.Context, siteID string, req commandRecoveryRequest) (string, error) {
	out, err := d.run(ctx, d.ensure, req)
	if err != nil {
		return "", fmt.Errorf("command recovery driver ensure site %s: %w", siteID, err)
	}
	var resp commandRecoveryResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		return "", fmt.Errorf("command recovery driver ensure response: %w", err)
	}
	resp.ExternalID = strings.TrimSpace(resp.ExternalID)
	if resp.ExternalID == "" {
		return "", errors.New("command recovery driver ensure response missing external_id")
	}
	return resp.ExternalID, nil
}

// Teardown invokes the configured teardown command for rollback and drill cleanup.
func (d *CommandRecoveryTargetDriver) Teardown(ctx context.Context, externalID string, rc RestoreContext) error {
	req := newCommandRecoveryRequest("teardown", rc)
	req.ExternalID = externalID
	if _, err := d.run(ctx, d.teardown, req); err != nil {
		return fmt.Errorf("command recovery driver teardown site %s external_id %s: %w", rc.SiteID, externalID, err)
	}
	return nil
}

func (d *CommandRecoveryTargetDriver) run(ctx context.Context, argv []string, req commandRecoveryRequest) ([]byte, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal provisioner request: %w", err)
	}
	if d.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, d.timeout)
		defer cancel()
	}
	return d.runner(ctx, argv, d.env, payload)
}

func newCommandRecoveryRequest(action string, rc RestoreContext) commandRecoveryRequest {
	return commandRecoveryRequest{
		Action:            action,
		IdempotencyKey:    rc.IdempotencyKey,
		TenantID:          rc.TenantID.String(),
		GroupID:           rc.GroupID,
		SiteID:            rc.SiteID,
		StreamID:          rc.StreamID,
		RecoveryEndpoint:  rc.RecoveryEndpoint,
		ObjectKey:         rc.ObjectKey,
		InstantSessionID:  rc.InstantSessionID,
		InstantOverlay:    rc.InstantOverlayLocation,
		InstantChunkSize:  rc.InstantChunkSize,
		InstantChunks:     rc.InstantChunksTotal,
		Profile:           rc.Profile,
		PrimaryToRecovery: rc.PrimaryToRecovery,
		Drill:             rc.Drill,
	}
}

func writeRestoreTemp(plaintext []byte) (string, func(), error) {
	f, err := os.CreateTemp("", "clario-dr-restore-*")
	if err != nil {
		return "", func() {}, fmt.Errorf("create restore temp file: %w", err)
	}
	path := f.Name()
	cleanup := func() { _ = os.Remove(path) }
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		cleanup()
		return "", func() {}, fmt.Errorf("chmod restore temp file: %w", err)
	}
	if _, err := f.Write(plaintext); err != nil {
		_ = f.Close()
		cleanup()
		return "", func() {}, fmt.Errorf("write restore temp file: %w", err)
	}
	if err := f.Close(); err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("close restore temp file: %w", err)
	}
	return path, cleanup, nil
}

func runCommandJSON(ctx context.Context, argv []string, env []string, stdin []byte) ([]byte, error) {
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Stdin = bytes.NewReader(stdin)
	cmd.Env = append(os.Environ(), env...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%s failed: %w: stderr=%q stdout=%q", argv[0], err, trimCommandOutput(stderr.String()), trimCommandOutput(stdout.String()))
	}
	out := bytes.TrimSpace(stdout.Bytes())
	return out, nil
}

func compactCommand(in []string) []string {
	out := make([]string, 0, len(in))
	for _, part := range in {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func trimCommandOutput(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= 2048 {
		return s
	}
	return s[:2048] + "...(truncated)"
}
