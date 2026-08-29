package iacdr

// normalizeAttributes returns a copy of attrs with volatile / provider-internal
// keys removed, so attribute-level drift comparison reflects MEANINGFUL changes
// to the declared infrastructure rather than churn the provider injects on every
// refresh (timestamps, computed metadata generations, internal version stamps).
//
// This is REAL domain logic, not cosmetic: without it a drift diff between two
// otherwise-identical snapshots would report spurious changes on every capture
// (e.g. a Kubernetes object's metadata.resourceVersion always differs). The
// stripped set is intentionally conservative — only fields known to be
// non-declarative are removed; everything else is preserved verbatim and
// recursively normalised so nested maps are stable for the canonical hash.
func normalizeAttributes(attrs map[string]any) map[string]any {
	if attrs == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(attrs))
	for k, v := range attrs {
		if volatileKey(k) {
			continue
		}
		out[k] = normalizeValue(v)
	}
	return out
}

// volatileKey reports whether an attribute key is provider-internal churn that
// must not register as drift. The list covers the common Terraform and
// Kubernetes volatile fields.
func volatileKey(k string) bool {
	switch k {
	// Kubernetes object metadata churn.
	case "resourceVersion", "generation", "creationTimestamp", "uid",
		"managedFields", "selfLink", "status",
		// Terraform / provider churn.
		"id_was", "last_updated", "%", "timeouts":
		return true
	default:
		return false
	}
}

// normalizeValue recursively normalises a nested attribute value. Maps have their
// volatile keys stripped; slices are normalised element-wise. Scalars pass
// through unchanged. The output is stable for canonical hashing.
func normalizeValue(v any) any {
	switch val := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(val))
		for k, vv := range val {
			if volatileKey(k) {
				continue
			}
			out[k] = normalizeValue(vv)
		}
		return out
	case []any:
		out := make([]any, len(val))
		for i, e := range val {
			out[i] = normalizeValue(e)
		}
		return out
	default:
		return val
	}
}
