package iacdr

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// TerraformParser parses a Terraform STATE file (terraform.tfstate). The state
// file is JSON, so this is a fully real, dependency-free parser over
// encoding/json — no HCL parsing is needed and none is done. It supports the
// modern state format (version 4): a top-level "resources" array where each
// resource has type/name/provider/mode and an "instances" array carrying the
// resolved attributes and the resource's "dependencies" (the depends_on edges
// Terraform itself recorded). It also tolerates the legacy format (version 3),
// where resources live under modules[].resources as a map keyed by address with
// a primary.attributes object and a depends_on list — so older estates still
// version cleanly.
type TerraformParser struct{}

// NewTerraformParser constructs a TerraformParser.
func NewTerraformParser() *TerraformParser { return &TerraformParser{} }

// Kind reports the source kind this parser handles.
func (*TerraformParser) Kind() string { return SourceTerraformState }

// tfState models the parts of terraform.tfstate we read. We keep the version and
// terraform_version for provenance metadata and lineage for snapshot identity.
type tfState struct {
	Version          int            `json:"version"`
	TerraformVersion string         `json:"terraform_version"`
	Lineage          string         `json:"lineage"`
	Serial           int64          `json:"serial"`
	Resources        []tfResourceV4 `json:"resources"`
	Modules          []tfModuleV3   `json:"modules"`
	Outputs          map[string]any `json:"outputs"`
}

// tfResourceV4 is one entry of the version-4 "resources" array.
type tfResourceV4 struct {
	Module    string         `json:"module"`
	Mode      string         `json:"mode"`
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	Provider  string         `json:"provider"`
	Instances []tfInstanceV4 `json:"instances"`
}

// tfInstanceV4 is one instance of a v4 resource (count/for_each expand a resource
// into multiple instances; each carries its own attributes + dependencies).
type tfInstanceV4 struct {
	IndexKey     any            `json:"index_key"`
	Attributes   map[string]any `json:"attributes"`
	Dependencies []string       `json:"dependencies"`
}

// tfModuleV3 / tfResourceV3 model the legacy version-3 layout.
type tfModuleV3 struct {
	Path      []string                `json:"path"`
	Resources map[string]tfResourceV3 `json:"resources"`
}

type tfResourceV3 struct {
	Type      string      `json:"type"`
	DependsOn []string    `json:"depends_on"`
	Provider  string      `json:"provider"`
	Primary   tfPrimaryV3 `json:"primary"`
}

type tfPrimaryV3 struct {
	ID         string            `json:"id"`
	Attributes map[string]string `json:"attributes"`
}

// providerAddrRe extracts the provider name from a Terraform provider address
// such as `provider["registry.terraform.io/hashicorp/aws"]` or the legacy
// `provider.aws`. The captured group is the short provider name.
var providerAddrRe = regexp.MustCompile(`([A-Za-z0-9_-]+)("?\])?$`)

// Parse decodes a terraform.tfstate artifact into normalised resources.
func (p *TerraformParser) Parse(artifact []byte) (ParseResult, error) {
	if len(artifact) == 0 {
		return ParseResult{}, fmt.Errorf("terraform state is empty: %w", ErrEmptyArtifact)
	}
	var st tfState
	if err := json.Unmarshal(artifact, &st); err != nil {
		return ParseResult{}, fmt.Errorf("decoding terraform state: %w: %v", ErrParse, err)
	}

	var resources []Resource
	switch {
	case len(st.Resources) > 0:
		resources = p.parseV4(st)
	case len(st.Modules) > 0:
		resources = p.parseV3(st)
	}

	if len(resources) == 0 {
		return ParseResult{}, fmt.Errorf("terraform state has no managed resources: %w", ErrEmptyArtifact)
	}

	// Deterministic resource order so the snapshot's resource_count and any
	// downstream listing are stable.
	sort.Slice(resources, func(i, j int) bool {
		return resources[i].Address < resources[j].Address
	})

	meta := map[string]string{
		"format":            "terraform_state",
		"state_version":     fmt.Sprintf("%d", st.Version),
		"terraform_version": st.TerraformVersion,
	}
	if st.Lineage != "" {
		meta["lineage"] = st.Lineage
	}
	if st.Serial != 0 {
		meta["serial"] = fmt.Sprintf("%d", st.Serial)
	}

	return ParseResult{SourceKind: SourceTerraformState, Resources: resources, Metadata: meta}, nil
}

// parseV4 walks the version-4 "resources" array. Only managed resources (mode
// "managed") are reconstituted — data sources (mode "data") are reads, not
// infrastructure to rebuild, so they are skipped. count/for_each instances each
// become their own resource keyed by an index suffix so attributes and deps stay
// per-instance.
func (p *TerraformParser) parseV4(st tfState) []Resource {
	var out []Resource
	for _, r := range st.Resources {
		if r.Mode != "" && r.Mode != "managed" {
			continue
		}
		provider := providerShortName(r.Provider)
		base := r.Type + "." + r.Name
		if r.Module != "" {
			base = r.Module + "." + base
		}
		for _, inst := range r.Instances {
			addr := base
			if key := indexKeySuffix(inst.IndexKey); key != "" {
				addr = base + key
			}
			attrs := inst.Attributes
			if attrs == nil {
				attrs = map[string]any{}
			}
			deps := normalizeDeps(inst.Dependencies)
			res := Resource{
				Provider:   provider,
				Type:       r.Type,
				Name:       resourceNameForAddr(r.Name, inst.IndexKey),
				Address:    addr,
				Attributes: normalizeAttributes(attrs),
				DependsOn:  deps,
			}
			res.Hash = res.ComputeHash()
			out = append(out, res)
		}
		// A resource with zero instances (rare: destroyed but retained shell) still
		// counts as a captured vertex with empty attributes.
		if len(r.Instances) == 0 {
			res := Resource{
				Provider:   provider,
				Type:       r.Type,
				Name:       r.Name,
				Address:    base,
				Attributes: map[string]any{},
				DependsOn:  nil,
			}
			res.Hash = res.ComputeHash()
			out = append(out, res)
		}
	}
	return out
}

// parseV3 walks the legacy modules[].resources map. v3 attributes are flat
// string maps; we lift them to map[string]any so the hash/diff path is uniform.
func (p *TerraformParser) parseV3(st tfState) []Resource {
	var out []Resource
	for _, mod := range st.Modules {
		modPrefix := strings.Join(mod.Path, ".")
		// state v3 path always begins with "root"; drop it for a clean address.
		modPrefix = strings.TrimPrefix(modPrefix, "root")
		modPrefix = strings.TrimPrefix(modPrefix, ".")
		for addr, r := range mod.Resources {
			attrs := make(map[string]any, len(r.Primary.Attributes))
			for k, v := range r.Primary.Attributes {
				attrs[k] = v
			}
			fullAddr := addr
			if modPrefix != "" {
				fullAddr = modPrefix + "." + addr
			}
			res := Resource{
				Provider:   providerShortName(r.Provider),
				Type:       r.Type,
				Name:       resourceNameFromAddress(addr, r.Type),
				Address:    fullAddr,
				Attributes: normalizeAttributes(attrs),
				DependsOn:  normalizeDeps(r.DependsOn),
			}
			res.Hash = res.ComputeHash()
			out = append(out, res)
		}
	}
	return out
}

// providerShortName extracts the short provider name from a Terraform provider
// address. Returns "" for an empty address.
func providerShortName(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return ""
	}
	// `provider["registry.terraform.io/hashicorp/aws"]` -> the slash-separated
	// last path component, stripped of the trailing `"]`.
	if idx := strings.LastIndex(addr, "/"); idx >= 0 {
		tail := addr[idx+1:]
		tail = strings.TrimSuffix(tail, `"]`)
		tail = strings.TrimSuffix(tail, "]")
		tail = strings.Trim(tail, `"`)
		if tail != "" {
			return tail
		}
	}
	// `provider.aws` legacy form.
	if strings.HasPrefix(addr, "provider.") {
		return strings.TrimPrefix(addr, "provider.")
	}
	m := providerAddrRe.FindStringSubmatch(addr)
	if len(m) >= 2 {
		return m[1]
	}
	return addr
}

// indexKeySuffix renders a count/for_each instance index key into an address
// suffix: a numeric key -> `[0]`, a string key -> `["blue"]`, nil -> "".
func indexKeySuffix(key any) string {
	switch k := key.(type) {
	case nil:
		return ""
	case float64:
		return fmt.Sprintf("[%d]", int(k))
	case json.Number:
		return fmt.Sprintf("[%s]", k.String())
	case string:
		return fmt.Sprintf("[%q]", k)
	default:
		return fmt.Sprintf("[%v]", k)
	}
}

// resourceNameForAddr appends an index suffix to the resource name for
// count/for_each instances so each instance has a distinct (provider,type,name)
// diff key.
func resourceNameForAddr(name string, key any) string {
	suffix := indexKeySuffix(key)
	if suffix == "" {
		return name
	}
	return name + suffix
}

// resourceNameFromAddress derives the resource name from a v3 resource address of
// the form "type.name" (best-effort; falls back to the whole address).
func resourceNameFromAddress(addr, typ string) string {
	prefix := typ + "."
	if strings.HasPrefix(addr, prefix) {
		return strings.TrimPrefix(addr, prefix)
	}
	if idx := strings.LastIndex(addr, "."); idx >= 0 {
		return addr[idx+1:]
	}
	return addr
}

// normalizeDeps trims, drops empties, de-duplicates and sorts a dependency list
// so a resource's depends_on edges are canonical (the hash and the plan are
// order-independent).
func normalizeDeps(deps []string) []string {
	if len(deps) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(deps))
	out := make([]string, 0, len(deps))
	for _, d := range deps {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		if _, dup := seen[d]; dup {
			continue
		}
		seen[d] = struct{}{}
		out = append(out, d)
	}
	if len(out) == 0 {
		return nil
	}
	sort.Strings(out)
	return out
}
