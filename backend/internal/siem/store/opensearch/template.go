package opensearch

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store/schemas"
	"github.com/clario360/platform/internal/siem/store/storetypes"
)

const schemaVersion = "ecs-8.11+clario-1.0"

// EnsureIndexTemplate loads the ECS baseline + Clario extensions, merges
// them, rewrites the index_patterns placeholder, and PUTs the resulting
// template to OpenSearch. The operation is idempotent — the cluster
// accepts repeated PUTs with the same body.
func (c *client) EnsureIndexTemplate(ctx context.Context, tenantID uuid.UUID) error {
	ctx, span := c.startSpan(ctx, "ensure_index_template", tenantID)
	defer span.End()

	body, hash, err := BuildTemplate(tenantID)
	if err != nil {
		return err
	}

	path := "/_index_template/" + storetypes.TemplateName(tenantID)
	status, respBody, err := c.do(ctx, http.MethodPut, path,
		bytes.NewReader(body),
		http.Header{"Content-Type": []string{"application/json"}})
	if err != nil {
		return fmt.Errorf("opensearch: ensure template: %w", err)
	}
	if err := classifyStatus(status, respBody); err != nil {
		return fmt.Errorf("opensearch: ensure template: %w", err)
	}
	if c.m != nil {
		c.m.TemplateHash.WithLabelValues(tenantID.String(), hash).Set(1)
	}
	return nil
}

// BuildTemplate merges schemas/ECS + extensions for a tenant. It is
// exported so tests (and the contract test) can inspect the template
// bytes deterministically.
func BuildTemplate(tenantID uuid.UUID) (body []byte, hash string, err error) {
	var ecs map[string]any
	if err := json.Unmarshal(schemas.ECSMapping, &ecs); err != nil {
		return nil, "", fmt.Errorf("opensearch: parse ECS mapping: %w", err)
	}
	var ext map[string]any
	if err := json.Unmarshal(schemas.ClarioExtensions, &ext); err != nil {
		return nil, "", fmt.Errorf("opensearch: parse Clario extensions: %w", err)
	}

	// 1. Rewrite index_patterns from the placeholder to the tenant pattern.
	ecs["index_patterns"] = []string{storetypes.IndexPattern(tenantID)}

	// 2. Merge ext.mappings.properties into ecs.template.mappings.properties.
	tplRaw, ok := ecs["template"].(map[string]any)
	if !ok {
		return nil, "", fmt.Errorf("opensearch: template root missing")
	}
	mappings, ok := tplRaw["mappings"].(map[string]any)
	if !ok {
		return nil, "", fmt.Errorf("opensearch: template.mappings missing")
	}
	props, _ := mappings["properties"].(map[string]any)
	if props == nil {
		props = map[string]any{}
	}
	extMappings, _ := ext["mappings"].(map[string]any)
	if extMappings != nil {
		extProps, _ := extMappings["properties"].(map[string]any)
		for k, v := range extProps {
			props[k] = v
		}
	}
	mappings["properties"] = props

	// 3. Annotate _meta with schema_version + template_hash. We first hash
	// the merged body sans _meta.template_hash, then we slot the hash in.
	meta, _ := ecs["_meta"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
	}
	meta["schema_version"] = schemaVersion
	// Set a deterministic write_alias hint that consumers can read back.
	meta["write_alias"] = storetypes.WriteAlias(tenantID)
	// Reset template_hash for now; we recompute after marshaling-without-it.
	delete(meta, "template_hash")
	ecs["_meta"] = meta

	// Compute hash over a canonical (sorted-keys) marshal.
	canonical, err := canonicalJSON(ecs)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(canonical)
	hash = hex.EncodeToString(sum[:])
	meta["template_hash"] = hash
	ecs["_meta"] = meta

	out, err := json.Marshal(ecs)
	if err != nil {
		return nil, "", fmt.Errorf("opensearch: marshal template: %w", err)
	}
	return out, hash, nil
}

// canonicalJSON marshals v with sorted map keys (encoding/json sorts keys
// automatically). The wrapper is documented so future readers know this
// works without an external dependency.
func canonicalJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, fmt.Errorf("opensearch: canonical encode: %w", err)
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}
