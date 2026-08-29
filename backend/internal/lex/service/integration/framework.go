// Package integration is the lex (Watheeq) connector framework (Phase 1).
//
// It grows the registry's IntegrationAdapter port (Kind + Probe) with a set of
// OPTIONAL capability interfaces that the registry type-asserts at call time:
//
//   - ConnectionTester — a non-mutating auth/reachability probe (Test Connection).
//   - Syncer           — pull connectors (HR feed, najiz read, archiving reconcile).
//   - Invoker          — action connectors (najiz add-rep, e-archive write, esign).
//
// An adapter implements none, some, or all of these. The registry asserts the
// capability before dispatching, returning a typed "not supported" error when an
// adapter does not implement the requested capability, so a planned/stub
// connector reports honestly rather than faking the operation.
//
// CONFIG + SECRETS CUSTODY. Adapters that need connection settings resolve the
// PLAINTEXT config via the repository directly (the najiz_court_adapter.go
// pattern), because the repository FieldCrypto-decrypts config_encrypted on read.
// They never call IntegrationRegistryService.Get/List, which schema-redacts
// secrets before returning to API callers. Secrets MUST NOT be logged or returned
// in cleartext anywhere in this package.
//
// The capability seam imports only model (no service-layer types), so connector
// implementations in service/ can depend on it without an import cycle.
package integration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// ErrCapabilityNotSupported is returned by the registry when an adapter does not
// implement the requested optional capability (ConnectionTester / Syncer /
// Invoker). It is an honest "not wired" signal, not a faked success.
var ErrCapabilityNotSupported = errors.New("lex/integration: connector does not support this capability")

// SyncMode selects the breadth of a Syncer pull. A full sync re-reads the entire
// upstream dataset; a delta sync reads only changes since the connector's stored
// watermark (metadata-tracked by the adapter).
type SyncMode string

const (
	// SyncModeFull re-reads the entire upstream dataset.
	SyncModeFull SyncMode = "full"
	// SyncModeDelta reads only records changed since the last successful run.
	SyncModeDelta SyncMode = "delta"
	// SyncModePreview (feature 3, dry-run) re-reads upstream like a full sync but
	// COMMITS NOTHING: the syncer computes the would-be Created/Updated/Skipped
	// counts and returns them with SyncReport.DryRun=true. No lex rows are written
	// and no external system is mutated. The registry still records a sync-run
	// ledger row with mode=preview so the console can show "what a real sync would
	// do" without side effects.
	SyncModePreview SyncMode = "preview"
)

// Valid reports whether the mode is a recognised sync mode.
func (m SyncMode) Valid() bool {
	switch m {
	case SyncModeFull, SyncModeDelta, SyncModePreview:
		return true
	default:
		return false
	}
}

// IsPreview reports whether this is the dry-run mode (compute counts, commit
// nothing). Syncers honour it by skipping all writes/external mutation.
func (m SyncMode) IsPreview() bool { return m == SyncModePreview }

// NormalizeSyncMode coerces an arbitrary string to a valid SyncMode, defaulting
// to delta (the cheaper, safer cadence) when empty or unrecognised.
func NormalizeSyncMode(s string) SyncMode {
	switch SyncMode(s) {
	case SyncModeFull:
		return SyncModeFull
	case SyncModeDelta:
		return SyncModeDelta
	case SyncModePreview:
		return SyncModePreview
	default:
		return SyncModeDelta
	}
}

// TestResult is the sanitized outcome of a ConnectionTester.TestConnection probe.
// It NEVER carries secret material: Detail is an operator-safe message and the
// optional Sample fields summarise reachability without echoing credentials.
type TestResult struct {
	// Reachable reports whether the connector reached and authenticated against
	// the upstream system.
	Reachable bool `json:"reachable"`
	// Detail is an operator-facing, secret-free message (e.g. "200 OK; token
	// acquired", "401 unauthorized", "dns lookup failed").
	Detail string `json:"detail"`
	// SampleCount is an optional count of upstream records observed by a
	// read-capable connector during the probe (0 when not applicable).
	SampleCount int `json:"sample_count"`
	// LatencyMillis is the round-trip latency of the probe in milliseconds.
	LatencyMillis int64 `json:"latency_millis"`
	// CheckedAt is when the probe completed (UTC).
	CheckedAt time.Time `json:"checked_at"`
	// Metadata is non-sensitive provider annotation (server version, region).
	Metadata map[string]any `json:"metadata,omitempty"`
	// Steps (feature 2, ADDITIVE) is the per-stage diagnostic breakdown a connector
	// emits (reachable -> authenticated -> authorized -> sample_fetch). It lets the
	// console render a staged diagnostic timeline. A connector that only reports a
	// coarse Reachable/Detail leaves this empty; the registry then calls
	// SynthesizeSteps so the UI always has at least one stage. Steps never carry
	// secrets — Detail/Hint are operator-safe.
	Steps []DiagnosticStep `json:"steps,omitempty"`
}

// DiagnosticStep (feature 2) is one stage of a staged connection diagnostic. A
// connector emits an ordered slice of these on TestResult.Steps so the console
// can show the operator exactly which stage failed and how to remediate. It is
// strictly non-sensitive: Detail and Hint are operator-safe messages and NEVER
// echo credentials.
type DiagnosticStep struct {
	// Key is the stable stage identifier (e.g. reachable / authenticated /
	// authorized / sample_fetch).
	Key string `json:"key"`
	// Label is the bilingual operator-facing stage name.
	Label forms.LocalizedText `json:"label"`
	// Status is the stage verdict: one of ok | warn | fail | skip.
	Status string `json:"status"`
	// LatencyMs is the wall-clock time spent on this stage in milliseconds.
	LatencyMs int64 `json:"latency_ms"`
	// Detail is an operator-safe message for the stage (secret-free).
	Detail string `json:"detail,omitempty"`
	// Hint is a short, secret-free remediation suggestion shown on a failing stage.
	Hint string `json:"hint,omitempty"`
}

// Diagnostic step statuses (DiagnosticStep.Status domain).
const (
	DiagStatusOK   = "ok"
	DiagStatusWarn = "warn"
	DiagStatusFail = "fail"
	DiagStatusSkip = "skip"
)

// SynthesizeSteps (feature 2) guarantees the diagnostic UI always has at least
// one stage. When a connector returned no Steps (older connectors only set the
// coarse Reachable/Detail/LatencyMillis fields), it builds a single
// reachable/auth step from the coarse result so the console can still render a
// staged view. When the connector already populated Steps, they are returned
// unchanged. It never invents secrets and never mutates the input slice.
func SynthesizeSteps(result TestResult) []DiagnosticStep {
	if len(result.Steps) > 0 {
		return result.Steps
	}
	status := DiagStatusOK
	hint := ""
	if !result.Reachable {
		status = DiagStatusFail
		hint = "verify connection settings and credentials, then re-test"
	}
	detail := result.Detail
	if detail == "" {
		if result.Reachable {
			detail = "reachable"
		} else {
			detail = "not reachable"
		}
	}
	return []DiagnosticStep{{
		Key:       "reachable",
		Label:     forms.LocalizedText{AR: "إمكانية الوصول والمصادقة", EN: "Reachable / authenticated"},
		Status:    status,
		LatencyMs: result.LatencyMillis,
		Detail:    detail,
		Hint:      hint,
	}}
}

// SyncReport is the outcome of a Syncer.Sync run. Counts are non-sensitive and
// drive the sync-runs ledger row written by the registry.
type SyncReport struct {
	// Mode is the sync breadth that was executed.
	Mode SyncMode `json:"mode"`
	// Processed is the number of upstream records examined.
	Processed int `json:"processed"`
	// Created / Updated / Skipped / Failed break the processed records down by
	// outcome for the ledger.
	Created int `json:"created"`
	Updated int `json:"updated"`
	Skipped int `json:"skipped"`
	Failed  int `json:"failed"`
	// Watermark is the connector's opaque cursor after the run (e.g. an upstream
	// "modified since" timestamp), persisted for the next delta sync. It must not
	// contain secrets.
	Watermark string `json:"watermark,omitempty"`
	// Detail is an operator-facing summary message (secret-free).
	Detail string `json:"detail"`
	// Metadata is non-sensitive run annotation merged into the ledger row.
	Metadata map[string]any `json:"metadata,omitempty"`
	// DryRun (feature 3) reports that this report was produced by a SyncModePreview
	// pass: the counts are what a real sync WOULD do, but nothing was written and no
	// external system was mutated. A Syncer honouring SyncModePreview sets this true.
	DryRun bool `json:"dry_run,omitempty"`
}

// InvokeResult is the outcome of an Invoker.Invoke action call. Provider-assigned
// references and a sanitized detail are surfaced; credentials never are.
type InvokeResult struct {
	// Operation echoes the invoked operation name.
	Operation string `json:"operation"`
	// Success reports whether the upstream accepted the action.
	Success bool `json:"success"`
	// Reference is a provider-assigned identifier for the action (e.g. an esign
	// envelope id, an archive object key), when any.
	Reference string `json:"reference,omitempty"`
	// Detail is an operator-facing, secret-free message.
	Detail string `json:"detail"`
	// Output is non-sensitive structured result data for the caller.
	Output map[string]any `json:"output,omitempty"`
}

// ConnectionTester is the OPTIONAL capability for a non-mutating auth/reachability
// probe. The adapter resolves the endpoint's plaintext config via the repository
// and performs a lightweight, side-effect-free check. It must return a sanitized
// TestResult and must NOT log or echo secrets.
type ConnectionTester interface {
	TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error)
}

// Syncer is the OPTIONAL capability for pull connectors. Sync reads upstream
// records (full or delta) and reconciles them into lex storage, returning a
// non-sensitive SyncReport for the ledger.
type Syncer interface {
	Sync(ctx context.Context, endpoint model.IntegrationEndpoint, mode SyncMode) (SyncReport, error)
}

// Invoker is the OPTIONAL capability for action connectors. Invoke performs a
// named, mutating upstream operation with a JSON payload and returns a sanitized
// InvokeResult.
type Invoker interface {
	Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error)
}

// SandboxInvoker (feature 9) is the OPTIONAL capability for the console "try it"
// action. SandboxInvoke runs the connector in mock/sandbox mode for a named op,
// REGARDLESS of the endpoint's real config: it NEVER touches a real upstream /
// government system and NEVER mutates real or external state. Every result is
// clearly marked sandbox (Output["sandbox"]=true). It mirrors Invoker's shape so a
// connector can implement both — production through Invoke, demonstrable mock
// through SandboxInvoke.
type SandboxInvoker interface {
	SandboxInvoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error)
}

// SimulateNafathWebhook (feature 8) builds a SYNTHETIC NafathVerificationCompleted
// webhook body, signs it with the supplied secret using the SAME HMAC-SHA256 the
// public webhook verifier checks, then runs it back through VerifyNafathWebhook to
// PROVE the inbound loop end-to-end — entirely in-process, with NO external call
// and NO mutation. It returns the normalised event on success, or the verifier's
// error. The secret is never logged or returned. The registry's SendTestEvent
// uses this to demonstrate that an endpoint's webhook secret + signature path is
// wired correctly.
//
// The synthetic body declares a strong assurance level (NafathLoABiometric) and
// the verification asserts NO minimum (NafathLoANone), so the loop proof exercises
// the signature/secret path WITHOUT being gated on an assurance policy — the
// purpose here is to prove the webhook secret + HMAC path, not the LoA gate (which
// is enforced on real inbound traffic by the live webhook handler with the
// endpoint's configured minimum).
func SimulateNafathWebhook(secret string, now time.Time) (NafathWebhookEvent, error) {
	body, _ := json.Marshal(map[string]any{
		"trans_id":    "synthetic-" + now.UTC().Format("20060102T150405"),
		"national_id": "1000000000",
		"status":      "COMPLETED",
		"loa":         string(NafathLoABiometric),
	})
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return VerifyNafathWebhook(secret, body, signature, NafathLoANone, now)
}

// =============================================================================
// Reconciliation (feature 3 — read-only source-vs-lex compare)
// =============================================================================

// ReconItem is one reconciliation finding: an external record with no lex
// counterpart, a lex record with no source, or a value conflict between the two.
// It is non-sensitive (identifiers + an operator-safe description) and never
// carries secret material.
type ReconItem struct {
	// ExternalID is the upstream system's identifier for the record (when known).
	ExternalID string `json:"external_id"`
	// LexKind is the lex resource type the record maps to (e.g. case, contact).
	LexKind string `json:"lex_kind"`
	// Issue classifies the finding: unmatched_source | orphan_lex | conflict.
	Issue string `json:"issue"`
	// Detail is an operator-facing description of the discrepancy (secret-free).
	Detail string `json:"detail"`
	// Suggested is a short, secret-free remediation suggestion.
	Suggested string `json:"suggested"`
}

// Recon issue classifications (ReconItem.Issue domain).
const (
	// ReconIssueUnmatchedSource is a source record with no lex counterpart.
	ReconIssueUnmatchedSource = "unmatched_source"
	// ReconIssueOrphanLex is a lex record whose source record is gone/absent.
	ReconIssueOrphanLex = "orphan_lex"
	// ReconIssueConflict is a record present on both sides with diverging values.
	ReconIssueConflict = "conflict"
)

// ReconciliationReport is the outcome of a read-only Reconcile pass: gaps (records
// missing on one side) and conflicts (records diverging across both), plus a
// roll-up summary keyed by issue type for the console banner.
type ReconciliationReport struct {
	Gaps      []ReconItem    `json:"gaps"`
	Conflicts []ReconItem    `json:"conflicts"`
	Summary   map[string]int `json:"summary"`
}

// Reconciler (feature 3) is the OPTIONAL capability a Syncer-backed connector
// implements to support a read-only source-vs-lex compare. When a connector does
// not implement it, the registry falls back to deriving a coarse reconciliation
// from a SyncModePreview pass (preview counts -> gaps), so every Syncer-capable
// kind still produces a useful report.
type Reconciler interface {
	Reconcile(ctx context.Context, endpoint model.IntegrationEndpoint) (ReconciliationReport, error)
}

// =============================================================================
// Catalog (feature 7 — connector catalog / onboarding metadata)
// =============================================================================

// CatalogEntry is the static, tenant-agnostic catalog metadata for one
// integration kind: how mature/gated it is, the bilingual prerequisite steps an
// operator must complete before activation, the webhook callback URL templates to
// register with the provider, KSA/regulatory tags, and whether the kind is
// self-serve (operator can activate without a gov gate). It carries NO secrets and
// NO tenant config — it is the same for every tenant.
type CatalogEntry struct {
	// Kind is the integration kind this entry describes.
	Kind model.IntegrationKind `json:"kind"`
	// Maturity is production | gov_gated. gov_gated kinds require a sandbox/manual
	// onboarding gate (Najiz/Nafath/emdha) before live use.
	Maturity string `json:"maturity"`
	// PrerequisiteSteps are the bilingual onboarding actions an operator completes
	// before activating the connector (register the app, obtain credentials, etc.).
	PrerequisiteSteps []forms.LocalizedText `json:"prerequisite_steps"`
	// CallbackTemplates maps a human label to a webhook/callback URL TEMPLATE
	// containing {tenantID}/{id} placeholders the console fills in (e.g.
	// "/webhooks/lex/nafath/verify/{tenantID}").
	CallbackTemplates map[string]string `json:"callback_templates,omitempty"`
	// KsaTags are KSA/regulatory tags (pdpl, in_kingdom, moj, nca, ...).
	KsaTags []string `json:"ksa_tags,omitempty"`
	// SelfServe reports whether an operator can activate this kind without a manual
	// government onboarding gate.
	SelfServe bool `json:"self_serve"`
}

// Catalog maturity values (CatalogEntry.Maturity domain).
const (
	MaturityProduction = "production"
	MaturityGovGated   = "gov_gated"
)

// HealthCheckRecord and ExpiryWarning (features 5/10) are defined alongside the
// HealthRecorder in health_history.go (feature 6). The registry consumes them via
// the HealthRecorder seam; the catalog/reconcile/secret-rotation work in this
// unit references them but does not redeclare them.
