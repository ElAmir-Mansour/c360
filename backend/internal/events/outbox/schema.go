package outbox

import (
	"context"
	"fmt"
)

// schemaDDL mirrors migrations/platform_core/000015_event_outbox.up.sql.
// Every statement is idempotent (IF NOT EXISTS), so services that manage
// their own schema lifecycle (e.g. workflow-engine's RunMigration) and
// migrator-managed environments converge on the same table. Keep the two in
// sync when either changes.
const schemaDDL = `
CREATE TABLE IF NOT EXISTS event_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL UNIQUE,
    tenant_id       UUID        NOT NULL,
    topic           TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
    attempts        INT         NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_claim
    ON event_outbox (next_attempt_at, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_event_outbox_stuck
    ON event_outbox (claimed_at)
    WHERE status = 'publishing';

CREATE INDEX IF NOT EXISTS idx_event_outbox_purge
    ON event_outbox (published_at)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_event_outbox_failed
    ON event_outbox (tenant_id, created_at)
    WHERE status = 'failed';
`

// EnsureSchema creates the outbox table and its indexes if they do not exist.
// Safe to call on every service start.
func EnsureSchema(ctx context.Context, q Querier) error {
	if _, err := q.Exec(ctx, schemaDDL); err != nil {
		return fmt.Errorf("ensuring event_outbox schema: %w", err)
	}
	return nil
}
