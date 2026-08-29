package opensearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// RolloverHot triggers a rollover on the tenant's write alias.
func (c *client) RolloverHot(ctx context.Context, tenantID uuid.UUID) (RolloverResult, error) {
	ctx, span := c.startSpan(ctx, "rollover_hot", tenantID)
	defer span.End()

	alias := storetypes.WriteAlias(tenantID)
	body, _ := json.Marshal(map[string]any{
		"conditions": map[string]any{
			"max_age":                c.cfg.RolloverMaxAge,
			"max_primary_shard_size": c.cfg.RolloverMaxPrimaryShardSize,
		},
	})
	status, respBody, err := c.do(ctx, http.MethodPost, "/"+alias+"/_rollover",
		bytes.NewReader(body),
		http.Header{"Content-Type": []string{"application/json"}})
	if err != nil {
		c.recordRollover(tenantID, "fail")
		return RolloverResult{}, fmt.Errorf("opensearch: rollover: %w", err)
	}
	if err := classifyStatus(status, respBody); err != nil {
		c.recordRollover(tenantID, "fail")
		return RolloverResult{}, fmt.Errorf("opensearch: rollover: %w", err)
	}
	var parsed struct {
		OldIndex   string `json:"old_index"`
		NewIndex   string `json:"new_index"`
		RolledOver bool   `json:"rolled_over"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		c.recordRollover(tenantID, "fail")
		return RolloverResult{}, fmt.Errorf("opensearch: parse rollover response: %w", err)
	}
	c.recordRollover(tenantID, "ok")

	// Emit CloudEvent (best-effort).
	if c.cfg.EventPublisher != nil {
		_ = c.cfg.EventPublisher.Publish(ctx, "siem.opensearch.rollover", parsed.NewIndex, map[string]any{
			"tenant_id":   tenantID.String(),
			"old_index":   parsed.OldIndex,
			"new_index":   parsed.NewIndex,
			"rolled_over": parsed.RolledOver,
		})
	}

	return RolloverResult(parsed), nil
}

// FreezeWarm marks an index read-only and force-merges to a single segment.
func (c *client) FreezeWarm(ctx context.Context, tenantID uuid.UUID, indexName string) error {
	ctx, span := c.startSpan(ctx, "freeze_warm", tenantID)
	defer span.End()

	// 1. Force-merge to one segment.
	status, body, err := c.do(ctx, http.MethodPost,
		"/"+indexName+"/_forcemerge?max_num_segments=1", nil, nil)
	if err != nil {
		c.recordFreeze(tenantID, "fail")
		return fmt.Errorf("opensearch: freeze force-merge: %w", err)
	}
	if err := classifyStatus(status, body); err != nil {
		c.recordFreeze(tenantID, "fail")
		return fmt.Errorf("opensearch: freeze force-merge: %w", err)
	}

	// 2. Set index.blocks.write=true and codec=best_compression.
	settings, _ := json.Marshal(map[string]any{
		"index": map[string]any{
			"blocks.write": true,
			"codec":        "best_compression",
		},
	})
	status, body, err = c.do(ctx, http.MethodPut, "/"+indexName+"/_settings",
		bytes.NewReader(settings),
		http.Header{"Content-Type": []string{"application/json"}})
	if err != nil {
		c.recordFreeze(tenantID, "fail")
		return fmt.Errorf("opensearch: freeze settings: %w", err)
	}
	if err := classifyStatus(status, body); err != nil {
		c.recordFreeze(tenantID, "fail")
		return fmt.Errorf("opensearch: freeze settings: %w", err)
	}
	c.recordFreeze(tenantID, "ok")

	if c.cfg.EventPublisher != nil {
		_ = c.cfg.EventPublisher.Publish(ctx, "siem.opensearch.freeze", indexName, map[string]any{
			"tenant_id":  tenantID.String(),
			"index_name": indexName,
		})
	}

	return nil
}

func (c *client) recordRollover(tenantID uuid.UUID, result string) {
	if c.m != nil {
		c.m.RolloverTotal.WithLabelValues(tenantID.String(), result).Inc()
	}
}

func (c *client) recordFreeze(tenantID uuid.UUID, result string) {
	if c.m != nil {
		c.m.FreezeTotal.WithLabelValues(tenantID.String(), result).Inc()
	}
}
