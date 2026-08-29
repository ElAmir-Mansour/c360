package provider

import (
	"fmt"
	"strings"
)

// Factory builds an adapter for a parsed provider config.
type Factory func(Config) (Adapter, error)

// Registry maps provider kinds to adapter factories.
type Registry struct {
	factories map[string]Factory
}

// NewRegistry returns the certified-provider registry. The built-in adapters are
// live and fail closed: Kubernetes talks directly to the Kubernetes API server,
// while vSphere/cloud/NetApp delegate to a configured provider gateway where the
// deployment-owned vendor SDK clients run.
func NewRegistry() *Registry {
	r := &Registry{factories: map[string]Factory{}}
	r.Register(KindVSphere, func(cfg Config) (Adapter, error) {
		return NewGatewayAdapter(cfg, GatewaySpec{
			Kind:           KindVSphere,
			DisplayName:    "VMware vSphere",
			RequiredConfig: []string{"endpoint", "credential_ref", "datacenter"},
			Notes: []string{
				"delegates vSphere recovery to a configured gateway backed by certified VMware SDK operations",
			},
		})
	})
	r.Register(KindKubernetes, func(cfg Config) (Adapter, error) {
		return NewKubernetesAdapter(cfg), nil
	})
	r.Register(KindCloud, func(cfg Config) (Adapter, error) {
		return NewGatewayAdapter(cfg, GatewaySpec{
			Kind:           KindCloud,
			DisplayName:    "Cloud recovery",
			RequiredConfig: []string{"endpoint", "credential_ref", "region", "project"},
			Notes: []string{
				"delegates cloud recovery to a configured gateway backed by certified AWS/Azure/GCP SDK operations",
			},
		})
	})
	r.Register(KindNetApp, func(cfg Config) (Adapter, error) {
		return NewGatewayAdapter(cfg, GatewaySpec{
			Kind:           KindNetApp,
			DisplayName:    "NetApp ONTAP",
			RequiredConfig: []string{"endpoint", "credential_ref", "storage_vm"},
			Notes: []string{
				"delegates ONTAP recovery to a configured gateway backed by certified NetApp operations",
			},
		})
	})
	return r
}

// Register installs or replaces an adapter factory.
func (r *Registry) Register(kind string, factory Factory) {
	if r.factories == nil {
		r.factories = map[string]Factory{}
	}
	r.factories[normalizeKind(kind)] = factory
}

// Build constructs the adapter selected by cfg.Kind.
func (r *Registry) Build(cfg Config) (Adapter, error) {
	kind := normalizeKind(cfg.Kind)
	if kind == "" {
		return nil, fmt.Errorf("%w: provider kind is required", ErrNotConfigured)
	}
	factory, ok := r.factories[kind]
	if !ok {
		return nil, fmt.Errorf("unsupported dr provider %q", cfg.Kind)
	}
	cfg.Kind = kind
	return factory(cfg)
}

func normalizeKind(kind string) string {
	return strings.ToLower(strings.TrimSpace(kind))
}
