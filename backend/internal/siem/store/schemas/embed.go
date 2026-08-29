// Package schemas exposes the SIEM-02 schema bytes via go:embed so that
// every subpackage (opensearch, crypto) can load them without I/O.
//
// These bytes are the single source of truth for: ECS 8.11 mapping, Clario
// ECS extensions, and the PII field list. Hash-pinning tests live in the
// subpackages that consume them; this package only owns the bytes.
package schemas

import _ "embed"

// ECSMapping is the baseline ECS 8.11 index template body. Contains the
// literal placeholder __siem_template_placeholder__ in index_patterns;
// callers rewrite it at template-creation time.
//
//go:embed ecs-v8.11-mapping.json
var ECSMapping []byte

// ClarioExtensions are the Clario-specific ECS extensions merged into the
// ECS template at index-template creation time.
//
//go:embed clario-ecs-extensions.json
var ClarioExtensions []byte

// PIIFieldsYAML is the raw bytes of pii-fields.yaml. Loaded by
// crypto.NewPIIRegistry.
//
//go:embed pii-fields.yaml
var PIIFieldsYAML []byte
