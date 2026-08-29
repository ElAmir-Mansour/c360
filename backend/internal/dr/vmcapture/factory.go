package vmcapture

import (
	"context"
	"fmt"
	"time"
)

// DefaultBindingFactory builds capture bindings from a source's stored config
// for the bindings this package implements natively with real I/O:
//
//   - vm_disk + file        -> FileHypervisorBinding over config["path"]
//   - k8s_workload + rest   -> RESTResourceSource over the K8s REST API
//
// Production-only bindings (vmware_cbt, libvirt for VM; fixture for K8s tests)
// are NOT built here: the integration phase injects a factory that wraps this
// one and adds the hypervisor/test adapters. Returning ErrNotConfigured for an
// unhandled binding keeps the failure explicit rather than silent.
type DefaultBindingFactory struct {
	// Now overrides the file-binding marker clock (tests); nil uses time.Now.
	Now func() time.Time
}

// NewDefaultBindingFactory constructs a DefaultBindingFactory.
func NewDefaultBindingFactory() *DefaultBindingFactory { return &DefaultBindingFactory{} }

// VMBinding returns the hypervisor binding for a vm_disk source.
func (f *DefaultBindingFactory) VMBinding(ctx context.Context, s *Source) (HypervisorBinding, error) {
	if s.SourceKind != SourceKindVMDisk {
		return nil, fmt.Errorf("%w: VMBinding called for source_kind %q", ErrInvalid, s.SourceKind)
	}
	switch s.BindingKind {
	case BindingFile:
		path, _ := s.Config["path"].(string)
		if path == "" {
			return nil, fmt.Errorf("%w: vm_disk file binding requires config.path", ErrInvalid)
		}
		blockSize := s.BlockSizeBytes
		if blockSize <= 0 {
			blockSize = DefaultBlockSize
		}
		return FileHypervisorBinding{Path: path, BlockSize: blockSize, Now: f.Now}, nil
	default:
		return nil, fmt.Errorf("%w: binding %q for vm_disk is wired by the integration phase", ErrNotConfigured, s.BindingKind)
	}
}

// K8sSource returns the resource source for a k8s_workload source.
func (f *DefaultBindingFactory) K8sSource(ctx context.Context, s *Source) (ResourceSource, error) {
	if s.SourceKind != SourceKindK8sWorkload {
		return nil, fmt.Errorf("%w: K8sSource called for source_kind %q", ErrInvalid, s.SourceKind)
	}
	switch s.BindingKind {
	case BindingREST:
		cfg := RESTConfig{
			APIServer:             stringFromConfig(s.Config, "api_server"),
			BearerToken:           stringFromConfig(s.Config, "bearer_token"),
			Namespaces:            stringsFromConfig(s.Config, "namespaces"),
			Kinds:                 stringsFromConfig(s.Config, "kinds"),
			InsecureSkipTLSVerify: boolFromConfig(s.Config, "insecure_skip_tls_verify"),
		}
		if ca := stringFromConfig(s.Config, "ca_cert_pem"); ca != "" {
			cfg.CACertPEM = []byte(ca)
		}
		return NewRESTResourceSource(cfg)
	default:
		return nil, fmt.Errorf("%w: binding %q for k8s_workload is wired by the integration phase", ErrNotConfigured, s.BindingKind)
	}
}

func stringFromConfig(cfg map[string]any, key string) string {
	if cfg == nil {
		return ""
	}
	s, _ := cfg[key].(string)
	return s
}

func boolFromConfig(cfg map[string]any, key string) bool {
	if cfg == nil {
		return false
	}
	b, _ := cfg[key].(bool)
	return b
}

func stringsFromConfig(cfg map[string]any, key string) []string {
	if cfg == nil {
		return nil
	}
	switch v := cfg[key].(type) {
	case []string:
		return append([]string(nil), v...)
	case []any:
		out := make([]string, 0, len(v))
		for _, e := range v {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}
