// Package opensearch is the SIEM-02 wrapper around
// github.com/opensearch-project/opensearch-go/v3.
//
// This is the ONLY package under internal/siem/store/... that imports
// opensearch-go/v3 — the contract test in the parent store package
// enforces that.
//
// The wrapper presents a narrow Client interface (template, bulk, search,
// rollover, freeze, health) rather than re-exposing the upstream API. Tenant
// scoping is enforced at this layer: Search injects a tenant_id filter into
// the caller's DSL, BulkIndex rejects documents whose tenant_id field does
// not match the call's tenant argument, and index names are derived from the
// canonical helpers in the parent store package.
package opensearch
