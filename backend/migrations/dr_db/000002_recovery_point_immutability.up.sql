-- Harden recovery_point to match FR-DR-004:
-- sealed recovery-point identity/content fields are immutable, and deletion is
-- blocked until retention expires. Validation metadata remains updatable so the
-- validator can attach its result after sealing.

CREATE OR REPLACE FUNCTION prevent_recovery_point_mutation()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.retention_until > now() THEN
            RAISE EXCEPTION 'recovery_point is WORM-locked until %', OLD.retention_until
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.group_id IS DISTINCT FROM OLD.group_id
        OR NEW.marker_lsn IS DISTINCT FROM OLD.marker_lsn
        OR NEW.rpo_seconds IS DISTINCT FROM OLD.rpo_seconds
        OR NEW.object_keys IS DISTINCT FROM OLD.object_keys
        OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
        OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
        OR NEW.retention_until IS DISTINCT FROM OLD.retention_until THEN
        RAISE EXCEPTION 'recovery_point sealed fields are immutable'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recovery_point_immutable_guard ON recovery_point;
CREATE TRIGGER recovery_point_immutable_guard
    BEFORE UPDATE OR DELETE ON recovery_point
    FOR EACH ROW
    EXECUTE FUNCTION prevent_recovery_point_mutation();

DROP POLICY IF EXISTS tenant_update ON recovery_point;
DROP POLICY IF EXISTS tenant_delete ON recovery_point;
DROP POLICY IF EXISTS tenant_update_validation ON recovery_point;
DROP POLICY IF EXISTS tenant_delete_expired ON recovery_point;

CREATE POLICY tenant_update_validation ON recovery_point
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete_expired ON recovery_point
    FOR DELETE
    USING (
        (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        AND retention_until <= now()
    );
