package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
	"github.com/clario360/platform/internal/integration/connector/adapters"
	intmodel "github.com/clario360/platform/internal/integration/model"
)

// validationRegistry is a package-level registry used solely for schema-driven
// config validation and default application. It registers every connector — the
// five client-backed adapters (with nil client instances, safe because
// Manifest/ValidateConfig/ApplyDefaults never touch the wrapped client; only
// Send/Test/CreateFromEntity do) AND the three pure-SDK connectors (email,
// pagerduty, rest). Because it is built by the SAME adapters.BuildDefaultRegistry
// the dispatch services use, config validation for ALL connectors flows through
// the identical manifest path. Building it once avoids reconstructing manifests
// on every Create/Update call.
var validationRegistry = adapters.BuildDefaultRegistry(adapters.Clients{})

// NormalizeAndValidateConfig applies the connector's schema defaults, then
// delegates validation to the registry (which enforces the same required-field
// and credential rules the legacy type-switch did, via each adapter's
// ValidateConfig). On success it returns the normalized config (defaults
// applied), preserving the legacy behavior of materializing webhook
// method/content_type/headers and the servicenow auth_type default.
func NormalizeAndValidateConfig(typ intmodel.IntegrationType, config map[string]any) (map[string]any, error) {
	if config == nil {
		config = map[string]any{}
	}

	conn, ok := validationRegistry.Get(string(typ))
	if !ok {
		return nil, fmt.Errorf("unsupported integration type %q", typ)
	}

	// Apply schema defaults in place so the returned config matches the legacy
	// normalized shape. ApplyDefaults copies, so we replace the working map with
	// the normalized copy before validating it.
	normalized := connector.ApplyDefaults(conn.Manifest().ConfigSchema, config)

	if err := conn.ValidateConfig(normalized); err != nil {
		return nil, err
	}
	return normalized, nil
}

func SanitizeConfig(config map[string]any) map[string]any {
	if config == nil {
		return map[string]any{}
	}
	result := make(map[string]any, len(config))
	for key, value := range config {
		lower := strings.ToLower(key)
		switch typed := value.(type) {
		case map[string]any:
			result[key] = SanitizeConfig(typed)
		case map[string]string:
			nested := make(map[string]any, len(typed))
			for nestedKey, nestedValue := range typed {
				nested[nestedKey] = nestedValue
			}
			result[key] = SanitizeConfig(nested)
		case []any:
			copied := make([]any, len(typed))
			for idx, item := range typed {
				if nested, ok := item.(map[string]any); ok {
					copied[idx] = SanitizeConfig(nested)
				} else {
					copied[idx] = item
				}
			}
			result[key] = copied
		case string:
			if isSecretLikeKey(lower) {
				result[key] = maskSecret(typed)
			} else {
				result[key] = typed
			}
		default:
			result[key] = value
		}
	}
	return result
}

func DecodeInto[T any](config map[string]any, target *T) error {
	payload, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := json.Unmarshal(payload, target); err != nil {
		return fmt.Errorf("decode config: %w", err)
	}
	return nil
}

func MatchesEventFilters(event *events.Event, filters []intmodel.EventFilter) bool {
	if len(filters) == 0 {
		return true
	}
	for _, filter := range filters {
		if matchesFilter(event, filter) {
			return true
		}
	}
	return false
}

func matchesFilter(event *events.Event, filter intmodel.EventFilter) bool {
	if len(filter.EventTypes) > 0 && !contains(filter.EventTypes, event.Type) && !contains(filter.EventTypes, trimEventType(event.Type)) {
		return false
	}

	suite := extractSuite(event.Type)
	if len(filter.Suites) > 0 && !contains(filter.Suites, suite) {
		return false
	}

	var data map[string]any
	if len(event.Data) > 0 {
		_ = json.Unmarshal(event.Data, &data)
	}

	if len(filter.Severities) > 0 {
		severity := extractString(data, "severity")
		if severity != "" && !contains(filter.Severities, severity) {
			return false
		}
	}

	if filter.MinConfidence > 0 {
		confidence := extractConfidence(data)
		if confidence > 0 && confidence < filter.MinConfidence {
			return false
		}
	}

	return true
}

func extractSuite(eventType string) string {
	trimmed := trimEventType(eventType)
	parts := strings.Split(trimmed, ".")
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func trimEventType(eventType string) string {
	return strings.TrimPrefix(eventType, "com.clario360.")
}

func extractConfidence(data map[string]any) float64 {
	for _, key := range []string{"confidence", "confidence_score", "confidenceScore"} {
		if value, ok := data[key]; ok {
			switch typed := value.(type) {
			case float64:
				return typed
			case int:
				return float64(typed)
			}
		}
	}
	return 0
}

func extractString(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := data[key]; ok {
			if str, ok := value.(string); ok {
				return str
			}
		}
	}
	return ""
}

func contains(items []string, needle string) bool {
	for _, item := range items {
		if strings.EqualFold(strings.TrimSpace(item), strings.TrimSpace(needle)) {
			return true
		}
	}
	return false
}

func isSecretLikeKey(key string) bool {
	for _, fragment := range []string{"token", "secret", "password", "key", "authorization"} {
		if strings.Contains(key, fragment) {
			return true
		}
	}
	return false
}

func maskSecret(secret string) string {
	if secret == "" {
		return ""
	}
	if len(secret) <= 8 {
		return strings.Repeat("*", len(secret))
	}
	return secret[:4] + strings.Repeat("*", len(secret)-8) + secret[len(secret)-4:]
}
