-- Working Calendar Engine (CAP-020, CAP-021, CAP-029).
-- Per-tenant working-time definitions consumed by the SLA / Execution / Reporting
-- modules through the frozen calendar.Calculator contract (C-1).

CREATE TABLE IF NOT EXISTS legal_working_calendars (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    name          TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    timezone      TEXT        NOT NULL DEFAULT 'Asia/Riyadh',
    is_default    BOOLEAN     NOT NULL DEFAULT false,
    -- Ramadan is entered as an explicit Gregorian window (no Hijri auto-convert v1).
    ramadan_start DATE,
    ramadan_end   DATE,
    metadata      JSONB       NOT NULL DEFAULT '{}',
    created_by    UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    CHECK (ramadan_start IS NULL OR ramadan_end IS NULL OR ramadan_end >= ramadan_start)
);

-- At most one default working calendar per tenant (active rows only).
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_working_calendars_default
    ON legal_working_calendars (tenant_id)
    WHERE is_default = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_working_calendars_tenant
    ON legal_working_calendars (tenant_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS legal_working_hours (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    calendar_id   UUID        NOT NULL REFERENCES legal_working_calendars(id) ON DELETE CASCADE,
    profile       TEXT        NOT NULL DEFAULT 'standard' CHECK (profile IN ('standard', 'ramadan')),
    day_of_week   SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    segment_index SMALLINT    NOT NULL DEFAULT 0 CHECK (segment_index >= 0),
    start_minute  SMALLINT    NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
    end_minute    SMALLINT    NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_minute > start_minute),
    UNIQUE (calendar_id, profile, day_of_week, segment_index)
);

CREATE INDEX IF NOT EXISTS idx_legal_working_hours_calendar
    ON legal_working_hours (tenant_id, calendar_id, profile, day_of_week, segment_index);

CREATE TABLE IF NOT EXISTS legal_calendar_holidays (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    calendar_id  UUID        NOT NULL REFERENCES legal_working_calendars(id) ON DELETE CASCADE,
    holiday_date DATE        NOT NULL,
    kind         TEXT        NOT NULL DEFAULT 'official' CHECK (kind IN ('weekly', 'official', 'religious')),
    name         JSONB       NOT NULL DEFAULT '{}',
    created_by   UUID        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (calendar_id, holiday_date, kind)
);

CREATE INDEX IF NOT EXISTS idx_legal_calendar_holidays_calendar
    ON legal_calendar_holidays (tenant_id, calendar_id, holiday_date);

-- Row-Level Security policies (tenant isolation on every table). Currently
-- inert under the superuser lex pool — see 000002 for why and what enabling
-- them requires; the explicit WHERE tenant_id filter in the repositories is the
-- live control.
ALTER TABLE legal_working_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_working_calendars FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_working_calendars
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_working_calendars
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_working_calendars
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_working_calendars
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE legal_working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_working_hours FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_working_hours
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_working_hours
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_working_hours
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_working_hours
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE legal_calendar_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_calendar_holidays FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_calendar_holidays
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_calendar_holidays
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_calendar_holidays
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_calendar_holidays
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
