package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/automation/model"
)

// This file holds the trigger-source read paths (WP-9 consumers): the bus
// sources list enabled automations by trigger type + topic, the cron source
// enumerates every enabled schedule across all tenants (SYSTEM PATH), and the
// webhook source resolves an opaque token to its automation. All three read the
// trigger config out of the JSONB `trigger` column rather than denormalized
// columns, so a trigger reshape never needs a schema change. They are kept
// separate from the CRUD repository methods to keep the WP-8 file focused.

// listEnabledByTopicSQL selects enabled automations whose trigger JSONB declares
// the given type and topic. The topic predicate matches both the "event" and
// "threshold" trigger kinds, which both store their subscription in trigger.topic
// (model.TriggerConfig.Topic). Filtering on trigger->>'type' AND trigger->>'topic'
// in SQL keeps the hot bus path from loading every tenant automation.
const listEnabledByTopicSQL = `
SELECT id, tenant_id, name, enabled, trigger, runbook_id, COALESCE(created_by::text, ''), created_at, updated_at
FROM automations
WHERE tenant_id = $1
  AND enabled = true
  AND trigger->>'type' = $2
  AND trigger->>'topic' = $3
ORDER BY name`

// ListEnabledByTopic returns the tenant's enabled automations of triggerType
// subscribed to topic. It satisfies trigger.AutomationLister for the event and
// threshold sources. Rules are NOT eagerly loaded; the service loads them per
// matched automation when it creates a run (the filter/threshold check runs on
// the trigger config, the rule evaluation runs after a match).
func (r *Repository) ListEnabledByTopic(ctx context.Context, db DBTX, tenantID, triggerType, topic string) ([]*model.Automation, error) {
	rows, err := db.Query(ctx, listEnabledByTopicSQL, tenantID, triggerType, topic)
	if err != nil {
		return nil, fmt.Errorf("listing enabled automations by topic %s: %w", topic, err)
	}
	defer rows.Close()

	var out []*model.Automation
	for rows.Next() {
		a, err := r.scanAutomation(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning automation: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading enabled automations by topic: %w", err)
	}
	return out, nil
}

// systemListEnabledSchedulesSQL selects every enabled schedule-trigger
// automation across all tenants for the leader-singleton cron source.
//
// SYSTEM PATH — the cron clock is a single leader that fires every tenant's
// schedules, so this query is cross-tenant by design and must run under
// app.bypass_rls = on (RunSystemRead), mirroring the run driver's claim query.
const systemListEnabledSchedulesSQL = `
SELECT id, tenant_id, name, enabled, trigger, runbook_id, COALESCE(created_by::text, ''), created_at, updated_at
FROM automations
WHERE enabled = true
  AND trigger->>'type' = '` + model.TriggerTypeSchedule + `'
ORDER BY tenant_id, name`

// SystemListEnabledSchedules returns every enabled schedule-trigger automation
// across all tenants. It satisfies trigger.ScheduleLister.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design.
func (r *Repository) SystemListEnabledSchedules(ctx context.Context, db DBTX) ([]*model.Automation, error) {
	rows, err := db.Query(ctx, systemListEnabledSchedulesSQL)
	if err != nil {
		return nil, fmt.Errorf("system listing enabled schedules: %w", err)
	}
	defer rows.Close()

	var out []*model.Automation
	for rows.Next() {
		a, err := r.scanAutomation(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning schedule automation: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading schedule automations: %w", err)
	}
	return out, nil
}

// systemResolveWebhookSQL finds the single enabled webhook-trigger automation
// whose trigger declares the given token. The token lives in
// trigger->>'webhook_token' (model.TriggerConfig.WebhookToken). Resolution is
// cross-tenant because the inbound webhook (POST /webhooks/{token}) carries no
// tenant context — the token IS the credential — so this is a SYSTEM PATH read.
const systemResolveWebhookSQL = `
SELECT id, tenant_id, name, enabled, trigger, runbook_id, COALESCE(created_by::text, ''), created_at, updated_at
FROM automations
WHERE enabled = true
  AND trigger->>'type' = '` + model.TriggerTypeWebhook + `'
  AND trigger->>'webhook_token' = $1
LIMIT 1`

// SystemResolveWebhook resolves an opaque webhook token to its enabled
// automation, or model.ErrNotFound when no enabled webhook automation owns it.
// It is the repository half of trigger.WebhookResolver.
//
// SYSTEM PATH — the inbound webhook has no tenant context (the token is the
// credential), so this must run under app.bypass_rls = on. Returning ErrNotFound
// for an unknown/disabled token lets the source answer 404 without leaking
// whether a token ever existed.
func (r *Repository) SystemResolveWebhook(ctx context.Context, db DBTX, token string) (*model.Automation, error) {
	a, err := r.scanAutomation(db.QueryRow(ctx, systemResolveWebhookSQL, token))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("webhook token: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("resolving webhook token: %w", err)
	}
	return a, nil
}
