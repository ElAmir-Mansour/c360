package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/redis/go-redis/v9"

	gwmw "github.com/clario360/platform/internal/gateway/middleware"
)

// KillSwitchScope identifies what a kill switch matches against an incoming
// request. Scopes are evaluated in the early KillSwitch middleware (G19).
type KillSwitchScope string

const (
	// KillScopeRoute matches by route prefix (e.g. "/api/v1/lex").
	KillScopeRoute KillSwitchScope = "route"
	// KillScopeService matches by backend service name (e.g. "lex-service").
	KillScopeService KillSwitchScope = "service"
	// KillScopeTenant matches by tenant ID from the validated JWT.
	KillScopeTenant KillSwitchScope = "tenant"
	// KillScopeEntitlement matches by the route's entitlement key (e.g. "suite.cyber").
	KillScopeEntitlement KillSwitchScope = "entitlement"
)

// ValidScope reports whether s is a recognised kill-switch scope.
func ValidScope(s KillSwitchScope) bool {
	switch s {
	case KillScopeRoute, KillScopeService, KillScopeTenant, KillScopeEntitlement:
		return true
	default:
		return false
	}
}

// KillSwitch is a single kill-switch record. It is persisted in Redis so it
// survives gateway restarts and is shared across replicas.
type KillSwitch struct {
	Scope     KillSwitchScope `json:"scope"`
	Target    string          `json:"target"`
	Enabled   bool            `json:"enabled"`
	Reason    string          `json:"reason,omitempty"`
	UpdatedBy string          `json:"updated_by,omitempty"`
	UpdatedAt time.Time       `json:"updated_at"`
}

// killSwitchKeyPrefix is the Redis key namespace for kill switches.
const killSwitchKeyPrefix = "gw:killswitch:"

func killSwitchKey(scope KillSwitchScope, target string) string {
	return fmt.Sprintf("%s%s:%s", killSwitchKeyPrefix, scope, target)
}

// KillSwitchStore is a Redis-backed store for gateway kill switches.
type KillSwitchStore struct {
	rdb *redis.Client
}

// NewKillSwitchStore creates a kill-switch store. A nil Redis client makes the
// store a no-op (List returns empty, IsTripped always false) so the gateway
// fails open when Redis is unconfigured.
func NewKillSwitchStore(rdb *redis.Client) *KillSwitchStore {
	return &KillSwitchStore{rdb: rdb}
}

// Set upserts (Enabled=true) or removes (Enabled=false) a kill switch.
func (s *KillSwitchStore) Set(ctx context.Context, ks KillSwitch) error {
	if s.rdb == nil {
		return fmt.Errorf("kill switch store: redis unavailable")
	}
	key := killSwitchKey(ks.Scope, ks.Target)
	if !ks.Enabled {
		return s.rdb.Del(ctx, key).Err()
	}
	ks.UpdatedAt = time.Now().UTC()
	payload, err := json.Marshal(ks)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, key, payload, 0).Err()
}

// List returns all currently-enabled kill switches, sorted by scope then target.
func (s *KillSwitchStore) List(ctx context.Context) ([]KillSwitch, error) {
	out := []KillSwitch{}
	if s.rdb == nil {
		return out, nil
	}
	var cursor uint64
	for {
		keys, next, err := s.rdb.Scan(ctx, cursor, killSwitchKeyPrefix+"*", 200).Result()
		if err != nil {
			return nil, err
		}
		for _, key := range keys {
			val, err := s.rdb.Get(ctx, key).Result()
			if err != nil {
				continue
			}
			var ks KillSwitch
			if json.Unmarshal([]byte(val), &ks) == nil {
				out = append(out, ks)
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Scope != out[j].Scope {
			return out[i].Scope < out[j].Scope
		}
		return out[i].Target < out[j].Target
	})
	return out, nil
}

// IsTripped (gwmw.KillSwitchEvaluator) adapts the store to the gateway proxy
// middleware's kill-switch interface so the early ProxyKillSwitch middleware can
// consult the Redis-backed store without an import cycle. It delegates to the
// store's native matcher and translates the result into the middleware types.
func (s *KillSwitchStore) IsTripped(ctx context.Context, in gwmw.KillSwitchMatch) (bool, gwmw.KillSwitchReason) {
	tripped, ks := s.match(ctx, MatchInput{
		RoutePrefix: in.RoutePrefix,
		Service:     in.Service,
		TenantID:    in.TenantID,
		Entitlement: in.Entitlement,
	})
	if !tripped {
		return false, gwmw.KillSwitchReason{}
	}
	return true, gwmw.KillSwitchReason{
		Scope:  string(ks.Scope),
		Target: ks.Target,
		Reason: ks.Reason,
	}
}

// MatchInput is the per-request data the kill-switch evaluator inspects.
type MatchInput struct {
	RoutePrefix string
	Service     string
	TenantID    string
	Entitlement string
}

// match reports whether any enabled kill switch matches the request. The
// returned KillSwitch is the matching record (for the reason). On Redis error or
// when no store is configured it fails open (returns false).
func (s *KillSwitchStore) match(ctx context.Context, in MatchInput) (bool, KillSwitch) {
	if s.rdb == nil {
		return false, KillSwitch{}
	}
	candidates := []struct {
		scope  KillSwitchScope
		target string
	}{
		{KillScopeService, in.Service},
		{KillScopeRoute, in.RoutePrefix},
		{KillScopeTenant, in.TenantID},
		{KillScopeEntitlement, in.Entitlement},
	}
	for _, c := range candidates {
		if c.target == "" {
			continue
		}
		val, err := s.rdb.Get(ctx, killSwitchKey(c.scope, c.target)).Result()
		if err == redis.Nil || err != nil {
			continue
		}
		var ks KillSwitch
		if json.Unmarshal([]byte(val), &ks) == nil && ks.Enabled {
			return true, ks
		}
	}
	return false, KillSwitch{}
}
