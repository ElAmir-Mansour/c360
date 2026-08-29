package crypto

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/clario360/platform/internal/siem/store/schemas"
)

// PIIRegistry exposes the set of ECS paths considered PII under the
// active pii-fields.yaml. Implementations are immutable after construction
// and safe for concurrent use.
type PIIRegistry interface {
	IsPII(path string) bool
	AllPaths() []string
	SchemaID() string
	SchemaVersion() int
	SchemaHash() string
}

type piiRegistry struct {
	paths    []string
	pathSet  map[string]struct{}
	schemaID string
	version  int
	hashHex  string
}

// piiSpec is the YAML shape.
type piiSpec struct {
	Version     int      `yaml:"version"`
	SchemaID    string   `yaml:"schema_id"`
	Description string   `yaml:"description"`
	Fields      []string `yaml:"fields"`
	NotPII      []string `yaml:"not_pii"`
}

// NewPIIRegistry parses the embedded pii-fields.yaml and returns a
// PIIRegistry. Returns ErrPIIRegistryLoad on parse failure.
func NewPIIRegistry() (PIIRegistry, error) {
	return newPIIRegistryFromBytes(schemas.PIIFieldsYAML)
}

func newPIIRegistryFromBytes(raw []byte) (PIIRegistry, error) {
	var spec piiSpec
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPIIRegistryLoad, err)
	}
	if spec.SchemaID == "" {
		return nil, fmt.Errorf("%w: schema_id missing", ErrPIIRegistryLoad)
	}
	if spec.Version <= 0 {
		return nil, fmt.Errorf("%w: version invalid", ErrPIIRegistryLoad)
	}
	// Sort & dedupe paths for deterministic ordering.
	seen := make(map[string]struct{}, len(spec.Fields))
	paths := make([]string, 0, len(spec.Fields))
	for _, p := range spec.Fields {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, dup := seen[p]; dup {
			continue
		}
		seen[p] = struct{}{}
		paths = append(paths, p)
	}
	sort.Strings(paths)

	sum := sha256.Sum256(raw)
	return &piiRegistry{
		paths:    paths,
		pathSet:  seen,
		schemaID: spec.SchemaID,
		version:  spec.Version,
		hashHex:  hex.EncodeToString(sum[:]),
	}, nil
}

func (r *piiRegistry) IsPII(path string) bool {
	_, ok := r.pathSet[path]
	return ok
}

func (r *piiRegistry) AllPaths() []string {
	out := make([]string, len(r.paths))
	copy(out, r.paths)
	return out
}

func (r *piiRegistry) SchemaID() string   { return r.schemaID }
func (r *piiRegistry) SchemaVersion() int { return r.version }
func (r *piiRegistry) SchemaHash() string { return r.hashHex }
