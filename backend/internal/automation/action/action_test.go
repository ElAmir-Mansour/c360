package action

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
	"github.com/clario360/platform/internal/events"
)

// svcOutput aliases the orchestrator's Output type so the test doubles read
// cleanly without repeating the package qualifier.
type svcOutput = service.Output

// ---- shared test doubles & helpers -----------------------------------------

const testTenant = "tenant-7f1c"

// tenantCtx returns a context carrying the run's tenant, exactly as the
// orchestrator drives a claimed run (auth.WithTenantID).
func tenantCtx() context.Context {
	return auth.WithTenantID(context.Background(), testTenant)
}

// fakeMinter records the tenant it was asked to mint for and returns a stable
// token, or a forced error to exercise the retry path.
type fakeMinter struct {
	mu      sync.Mutex
	token   string
	err     error
	tenants []string
}

func newFakeMinter(token string) *fakeMinter { return &fakeMinter{token: token} }

func (m *fakeMinter) MintSystemToken(tenantID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tenants = append(m.tenants, tenantID)
	if m.err != nil {
		return "", m.err
	}
	return m.token, nil
}

func (m *fakeMinter) lastTenant() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.tenants) == 0 {
		return ""
	}
	return m.tenants[len(m.tenants)-1]
}

// capturedPublish records one Publish call.
type capturedPublish struct {
	topic string
	event *events.Event
}

// fakePublisher records every published event and may force an error to
// exercise the bus-unavailable retry path.
type fakePublisher struct {
	mu       sync.Mutex
	err      error
	captured []capturedPublish
}

func (p *fakePublisher) Publish(_ context.Context, topic string, event *events.Event) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return p.err
	}
	p.captured = append(p.captured, capturedPublish{topic: topic, event: event})
	return nil
}

func (p *fakePublisher) last() (capturedPublish, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.captured) == 0 {
		return capturedPublish{}, false
	}
	return p.captured[len(p.captured)-1], true
}

func (p *fakePublisher) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.captured)
}

// actionStep builds a run step carrying an action of the given kind + config.
func actionStep(kind string, cfg map[string]any) *model.RunStep {
	return &model.RunStep{
		RunID:  "run-1",
		Index:  0,
		Action: model.ActionRef{Kind: kind, Config: cfg},
		Status: model.StepStatusRunning,
	}
}

// staticExecutor is a service.ActionExecutor double for dispatcher tests.
type staticExecutor struct {
	mu      sync.Mutex
	calls   int
	out     map[string]any
	err     error
	gotKind string
}

func (s *staticExecutor) Execute(_ context.Context, step *model.RunStep) (svcOutput, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.gotKind = step.Action.Kind
	if s.err != nil {
		return svcOutput{}, s.err
	}
	return svcOutput{Data: cloneAny(s.out)}, nil
}

func cloneAny(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// retryableErr returns a synthetic target-unavailable error for policy tests.
func retryableErr(msg string) error {
	return fmt.Errorf("%w: %s", ErrTargetUnavailable, msg)
}

// permanentErr returns a synthetic permanent (non-retryable) error.
func permanentErr(msg string) error { return errors.New(msg) }
