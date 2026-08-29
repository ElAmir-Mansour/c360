package integration

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// Reliability feature #12 — per-endpoint circuit-breaker controls + quarantine.
//
// BreakerController holds one logical circuit-breaker state machine per endpoint
// (keyed tenant+endpoint), parametrised from the endpoint's non-secret config
// (failure_threshold, breaker_cooldown_seconds). The registry calls Allow BEFORE
// dispatching a Sync / Invoke / TestConnection and OnResult AFTER, so a flapping
// upstream trips OPEN and fails fast (callers skip the dispatch) until the cooldown
// elapses and the breaker HALF-OPENs to probe recovery.
//
// AUTO-QUARANTINE: when a breaker re-opens repeatedly (opens >= quarantineOpens),
// the controller marks the endpoint QUARANTINED and, through the optional
// Quarantiner seam, flips the endpoint's status so the registry/scheduler STOPS
// calling it — a persistent, operator-visible "stop" rather than an endless retry.
// Reset(id) manually closes the breaker and clears the quarantine (un-disabling the
// endpoint via the Quarantiner). No DB table is needed: breaker state is in-process
// and quarantine reflects onto the endpoint's existing status column.
//
// Secrets are never read here — config thresholds are non-secret integers.
// =============================================================================

// Breaker state names (BreakerState.State domain). They match sony/gobreaker's
// string states, normalised to snake_case for the API.
const (
	BreakerStateClosed   = "closed"
	BreakerStateOpen     = "open"
	BreakerStateHalfOpen = "half_open"
)

// Config keys (non-secret) the controller reads from an endpoint's config to
// parametrise its breaker. Defaults apply when absent/blank/non-positive.
const (
	// FailureThresholdKey trips the breaker after this many consecutive failures.
	FailureThresholdKey = "failure_threshold"
	// BreakerCooldownSecondsKey is how long the breaker stays open before half-open.
	BreakerCooldownSecondsKey = "breaker_cooldown_seconds"
	// DLQMaxAttemptsKey caps DLQ replay attempts (read by callers; surfaced here for
	// schema co-location).
	DLQMaxAttemptsKey = "dlq_max_attempts"
	// DLQBackoffSecondsKey is the DLQ replay backoff (read by callers).
	DLQBackoffSecondsKey = "dlq_backoff_seconds"
)

// Breaker-control defaults (also the schema defaults). Centralised so the schema
// and the runtime agree.
const (
	DefaultFailureThreshold      = 5
	DefaultBreakerCooldownSecond = 60
	DefaultDLQMaxAttempts        = 3
	DefaultDLQBackoffSeconds     = 30

	// quarantineOpens is how many times a breaker may OPEN before the controller
	// auto-quarantines the endpoint (stops it being called). Held constant: a
	// breaker that re-opens this many times has a persistently unhealthy upstream.
	quarantineOpens = 3
)

// BreakerState is the API-facing snapshot of one endpoint's breaker. The JSON shape
// matches the pinned reliability API exactly.
type BreakerState struct {
	State            string     `json:"state"`
	Failures         int        `json:"failures"`
	FailureThreshold int        `json:"failure_threshold"`
	OpenedAt         *time.Time `json:"opened_at,omitempty"`
	CooldownSeconds  int        `json:"cooldown_seconds"`
	Quarantined      bool       `json:"quarantined"`
}

// Quarantiner is the seam the controller uses to STOP / RESUME an endpoint being
// called when it auto-quarantines (or is manually reset). The registry satisfies
// it: Quarantine flips the endpoint status to disabled; Unquarantine restores it to
// active. Taking it as a narrow interface keeps this package free of an import
// cycle on package service. A nil Quarantiner disables the status side-effect (the
// breaker still opens/fails-fast; the endpoint is just not auto-disabled).
type Quarantiner interface {
	// Quarantine marks the endpoint as quarantined (e.g. status -> disabled) so it
	// stops being dispatched. reason is operator-safe (secret-free).
	Quarantine(ctx context.Context, tenantID, endpointID uuid.UUID, reason string) error
	// Unquarantine restores a quarantined endpoint (e.g. status -> active).
	Unquarantine(ctx context.Context, tenantID, endpointID uuid.UUID) error
}

// breakerEntry is the per-endpoint runtime state the controller tracks alongside
// the sony/gobreaker wrapper.
type breakerEntry struct {
	breaker          *Breaker
	failureThreshold int
	cooldownSeconds  int
	consecutiveFails int
	opens            int
	openedAt         *time.Time
	quarantined      bool
}

// BreakerController owns the per-endpoint breakers + quarantine bookkeeping. It is
// concurrency-safe (the registry calls it from request handlers and the scheduler).
type BreakerController struct {
	mu          sync.Mutex
	entries     map[uuid.UUID]*breakerEntry
	quarantiner Quarantiner
	logger      zerolog.Logger
	now         func() time.Time
}

// NewBreakerController builds an empty controller. The Quarantiner is wired
// separately via WithQuarantiner (it is the registry, which holds the controller).
func NewBreakerController(logger zerolog.Logger) *BreakerController {
	return &BreakerController{
		entries: map[uuid.UUID]*breakerEntry{},
		logger:  logger.With().Str("component", "lex-integration-breaker").Logger(),
		now:     func() time.Time { return time.Now().UTC() },
	}
}

// WithQuarantiner wires the quarantine seam (the registry) after construction.
// Returns the receiver for chaining. A nil quarantiner disables the auto-disable
// side-effect (the breaker still opens/fails fast).
func (c *BreakerController) WithQuarantiner(q Quarantiner) *BreakerController {
	if c != nil {
		c.quarantiner = q
	}
	return c
}

// Allow reports whether a dispatch to the endpoint is permitted right now. It is
// the cheap pre-dispatch gate: a QUARANTINED endpoint is always denied; an OPEN
// breaker (cooldown not yet elapsed) is denied (fail fast); a closed/half-open
// breaker is allowed. It (re-)parametrises the endpoint's breaker from its config
// on first use so a threshold/cooldown change takes effect.
func (c *BreakerController) Allow(endpoint model.IntegrationEndpoint) bool {
	if c == nil {
		return true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.entryLocked(endpoint)
	if e.quarantined {
		return false
	}
	// gobreaker fails fast on its own while open; mirror that decision here so the
	// caller can skip the dispatch entirely without invoking the breaker.
	return e.breaker.State() != BreakerStateOpen
}

// OnResult records the outcome of a dispatch so the breaker can trip/recover. It
// drives the sony/gobreaker state machine (a no-op fn that errors on failure),
// tracks the consecutive-failure count + open transitions, stamps opened_at on an
// open edge, and AUTO-QUARANTINES the endpoint when the breaker has opened too many
// times. ctx scopes the (best-effort) quarantine side-effect.
func (c *BreakerController) OnResult(ctx context.Context, endpoint model.IntegrationEndpoint, success bool) {
	if c == nil {
		return
	}
	c.mu.Lock()
	e := c.entryLocked(endpoint)
	wasOpen := e.breaker.State() == BreakerStateOpen
	// Feed the breaker so its internal state machine advances. We never surface this
	// error — Allow consults State() — but the failing call is what trips it.
	_ = e.breaker.Execute(ctx, func(context.Context) error {
		if success {
			return nil
		}
		return errBreakerSyntheticFailure
	})
	if success {
		e.consecutiveFails = 0
	} else {
		e.consecutiveFails++
	}
	nowOpen := e.breaker.State() == BreakerStateOpen
	if nowOpen && !wasOpen {
		now := c.now()
		e.openedAt = &now
		e.opens++
	}
	if !nowOpen {
		e.openedAt = nil
	}
	shouldQuarantine := e.opens >= quarantineOpens && !e.quarantined
	if shouldQuarantine {
		e.quarantined = true
	}
	c.mu.Unlock()

	if shouldQuarantine {
		c.applyQuarantine(ctx, endpoint)
	}
}

// State returns the API snapshot for an endpoint's breaker, (re-)parametrised from
// its config. A never-seen endpoint reports a fresh closed breaker with the config
// (or default) threshold/cooldown.
func (c *BreakerController) State(endpoint model.IntegrationEndpoint) BreakerState {
	if c == nil {
		return BreakerState{State: BreakerStateClosed, FailureThreshold: DefaultFailureThreshold, CooldownSeconds: DefaultBreakerCooldownSecond}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.entryLocked(endpoint)
	return BreakerState{
		State:            normalizeBreakerState(e.breaker.State()),
		Failures:         e.consecutiveFails,
		FailureThreshold: e.failureThreshold,
		OpenedAt:         e.openedAt,
		CooldownSeconds:  e.cooldownSeconds,
		Quarantined:      e.quarantined,
	}
}

// Reset manually CLOSES the endpoint's breaker and CLEARS its quarantine. It drops
// the in-process entry (so the next dispatch builds a fresh closed breaker from
// config) and, through the Quarantiner, un-disables the endpoint so it resumes
// being called. It returns the post-reset state snapshot. ctx scopes the
// (best-effort) un-quarantine side-effect.
func (c *BreakerController) Reset(ctx context.Context, endpoint model.IntegrationEndpoint) BreakerState {
	if c == nil {
		return BreakerState{State: BreakerStateClosed, FailureThreshold: DefaultFailureThreshold, CooldownSeconds: DefaultBreakerCooldownSecond}
	}
	c.mu.Lock()
	// Drop the entry so the next Allow/State rebuilds a fresh CLOSED breaker from the
	// endpoint's current config.
	delete(c.entries, endpoint.ID)
	fresh := c.entryLocked(endpoint)
	state := BreakerState{
		State:            BreakerStateClosed,
		Failures:         0,
		FailureThreshold: fresh.failureThreshold,
		OpenedAt:         nil,
		CooldownSeconds:  fresh.cooldownSeconds,
		Quarantined:      false,
	}
	c.mu.Unlock()

	// Always attempt to un-quarantine on an explicit reset: even if the in-process
	// entry was lost (process restart), the endpoint's persisted status may still be
	// disabled-by-quarantine, and the operator asked to resume it.
	if c.quarantiner != nil {
		if err := c.quarantiner.Unquarantine(ctx, endpoint.TenantID, endpoint.ID); err != nil {
			c.logger.Warn().Err(err).Str("endpoint_id", endpoint.ID.String()).Msg("clear integration breaker quarantine")
		}
	}
	return state
}

// applyQuarantine flips the endpoint to quarantined via the Quarantiner (best-
// effort; a failure is logged and does not roll back the in-process flag — the
// breaker is still open / failing fast either way).
func (c *BreakerController) applyQuarantine(ctx context.Context, endpoint model.IntegrationEndpoint) {
	c.logger.Warn().
		Str("endpoint_id", endpoint.ID.String()).
		Str("code", endpoint.Code).
		Msg("integration endpoint auto-quarantined after repeated breaker opens")
	if c.quarantiner == nil {
		return
	}
	reason := "auto-quarantined: circuit breaker opened repeatedly (upstream persistently unhealthy)"
	if err := c.quarantiner.Quarantine(ctx, endpoint.TenantID, endpoint.ID, reason); err != nil {
		c.logger.Warn().Err(err).Str("endpoint_id", endpoint.ID.String()).Msg("apply integration breaker quarantine")
	}
}

// entryLocked returns (building if needed) the endpoint's breaker entry,
// (re-)parametrising its threshold/cooldown from current config. Caller holds c.mu.
func (c *BreakerController) entryLocked(endpoint model.IntegrationEndpoint) *breakerEntry {
	threshold := configInt(endpoint.Config, FailureThresholdKey, DefaultFailureThreshold)
	cooldown := configInt(endpoint.Config, BreakerCooldownSecondsKey, DefaultBreakerCooldownSecond)
	e, ok := c.entries[endpoint.ID]
	if ok && e.failureThreshold == threshold && e.cooldownSeconds == cooldown {
		return e
	}
	// New endpoint, or a config change to threshold/cooldown: rebuild the breaker
	// while preserving the quarantine flag + open counter (a config tweak must not
	// silently un-quarantine an unhealthy endpoint).
	quarantined := false
	opens := 0
	if e != nil {
		quarantined = e.quarantined
		opens = e.opens
	}
	entry := &breakerEntry{
		breaker: NewBreaker(BreakerConfig{
			Name:                "lex-integration-" + endpoint.Code + "-" + endpoint.ID.String(),
			ConsecutiveFailures: uint32(threshold),
			OpenTimeout:         time.Duration(cooldown) * time.Second,
		}),
		failureThreshold: threshold,
		cooldownSeconds:  cooldown,
		quarantined:      quarantined,
		opens:            opens,
	}
	c.entries[endpoint.ID] = entry
	return entry
}

// normalizeBreakerState maps sony/gobreaker's state string ("half-open") to the
// API snake_case domain ("half_open").
func normalizeBreakerState(s string) string {
	switch strings.ToLower(strings.ReplaceAll(s, "-", "_")) {
	case BreakerStateOpen:
		return BreakerStateOpen
	case BreakerStateHalfOpen:
		return BreakerStateHalfOpen
	default:
		return BreakerStateClosed
	}
}

// configInt reads a non-secret integer config field, tolerating int/float/string
// encodings (the config map round-trips through JSON). A missing/blank/unparseable/
// non-positive value yields the default.
func configInt(config map[string]any, key string, def int) int {
	if config == nil {
		return def
	}
	raw, ok := config[key]
	if !ok || raw == nil {
		return def
	}
	switch v := raw.(type) {
	case int:
		if v > 0 {
			return v
		}
	case int64:
		if v > 0 {
			return int(v)
		}
	case float64:
		if v > 0 {
			return int(v)
		}
	case float32:
		if v > 0 {
			return int(v)
		}
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return def
		}
		n := 0
		for _, ch := range s {
			if ch < '0' || ch > '9' {
				return def
			}
			n = n*10 + int(ch-'0')
		}
		if n > 0 {
			return n
		}
	}
	return def
}

// errBreakerSyntheticFailure is the sentinel fed to the gobreaker so a failed
// dispatch trips the internal counter. It is never surfaced to a caller.
var errBreakerSyntheticFailure = &breakerSyntheticError{}

type breakerSyntheticError struct{}

func (*breakerSyntheticError) Error() string { return "lex/integration: breaker synthetic failure" }
