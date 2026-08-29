package provider

import (
	"context"
	"fmt"
)

// Operation is the live provider client seam used by future vendor SDK-backed
// adapters and by conformance fakes in tests.
type Operation interface {
	Ensure(context.Context, Config, EnsureRequest) (EnsureResult, error)
	Teardown(context.Context, Config, TeardownRequest) error
}

// SDKlessSpec describes a certified provider foundation whose live client is not
// linked into this binary yet.
type SDKlessSpec struct {
	Kind           string
	DisplayName    string
	RequiredConfig []string
	Operation      Operation
}

// SDKlessAdapter validates provider config and fails closed unless a live
// Operation is injected by a vendor-backed build or test fake.
type SDKlessAdapter struct {
	cfg  Config
	spec SDKlessSpec
}

func NewSDKlessAdapter(cfg Config, spec SDKlessSpec) *SDKlessAdapter {
	cfg.Kind = normalizeKind(firstNonEmpty(cfg.Kind, spec.Kind))
	return &SDKlessAdapter{cfg: cfg, spec: spec}
}

func (a *SDKlessAdapter) Capabilities() Capabilities {
	return Capabilities{
		Kind:                normalizeKind(firstNonEmpty(a.spec.Kind, a.cfg.Kind)),
		DisplayName:         firstNonEmpty(a.spec.DisplayName, a.spec.Kind, a.cfg.Kind),
		Live:                a.spec.Operation != nil,
		SDKBacked:           a.spec.Operation != nil,
		SupportsEnsure:      true,
		SupportsTeardown:    true,
		SupportsDrill:       true,
		SupportsIdempotency: true,
		RegulatedCompatible: a.spec.Operation != nil,
		RequiredConfig:      append([]string(nil), a.spec.RequiredConfig...),
		Notes: []string{
			"fails closed without a live provider SDK operation",
		},
	}
}

func (a *SDKlessAdapter) Validate(cfg Config) error {
	if cfg.Kind == "" {
		cfg.Kind = a.cfg.Kind
	}
	if err := missingRequired(cfg, a.spec.RequiredConfig...); err != nil {
		return err
	}
	if a.spec.Operation == nil {
		return fmt.Errorf("%w: %s live provider client is not configured", ErrNotConfigured, a.Capabilities().Kind)
	}
	return nil
}

func (a *SDKlessAdapter) Ensure(ctx context.Context, req EnsureRequest) (EnsureResult, error) {
	if err := a.Validate(a.cfg); err != nil {
		return EnsureResult{}, err
	}
	return a.spec.Operation.Ensure(ctx, a.cfg, req)
}

func (a *SDKlessAdapter) Teardown(ctx context.Context, req TeardownRequest) error {
	if err := a.Validate(a.cfg); err != nil {
		return err
	}
	return a.spec.Operation.Teardown(ctx, a.cfg, req)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
