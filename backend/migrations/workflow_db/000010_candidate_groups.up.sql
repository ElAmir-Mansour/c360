-- =============================================================================
-- HUMAN-SCALE — CANDIDATE-GROUP / WORK-QUEUE ASSIGNMENT.
--
-- Assignment today is single-user (assignee_id) OR single-role (assignee_role)
-- ONLY. Large organisations route work to a QUEUE that any member of one or more
-- GROUPS may pull from (a "group inbox"): the task is offered to the pool, and
-- the first eligible claimant becomes its owner (claim-from-pool), or hands it
-- back to the pool (unclaim). This migration adds the two candidate columns that
-- express that pool alongside the existing single assignee/role — ADDITIVELY, so
-- every existing task (both candidate arrays empty/NULL) behaves exactly as
-- before.
--
--   candidate_groups TEXT[]  -- groups (roles) whose members may claim from pool
--   candidate_users  UUID[]  -- specific extra users who may claim from pool
--
-- These are matched at read time against the requesting user's roles/id, mirror-
-- ing the existing "assignee_role IN (roles)" visibility model — no separate
-- group registry is introduced. The claim path itself is UNCHANGED (still the
-- exactly-one-winner FOR UPDATE SKIP LOCKED lock); only who is ELIGIBLE to claim
-- an unassigned task widens to the pool.
--
-- RLS: workflow_tasks is already FORCE-RLS'd (000008); adding columns does NOT
-- change the tenant policies, so no policy work is needed here. The GIN index on
-- candidate_groups keeps the group-inbox lookup ("any of my roles overlaps a
-- task's candidate_groups") fast; a partial index restricts it to the only rows
-- a group inbox surfaces (unclaimed pending tasks).
--
-- Additive, reversible, idempotent: IF NOT EXISTS on every object; no existing
-- column/constraint is altered. The down migration drops only what this adds.
-- The migration role must have BYPASSRLS. Requires no data migration.
-- =============================================================================

ALTER TABLE workflow_tasks
    ADD COLUMN IF NOT EXISTS candidate_groups TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE workflow_tasks
    ADD COLUMN IF NOT EXISTS candidate_users  UUID[] NOT NULL DEFAULT '{}';

-- Group-inbox lookup: "does any of my roles overlap this task's candidate_groups"
-- uses the array-overlap operator (&&), which a GIN index accelerates. Partial to
-- the rows a group inbox actually offers (unclaimed, pending, has a group).
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_candidate_groups
    ON workflow_tasks USING gin (candidate_groups)
    WHERE status = 'pending' AND claimed_by IS NULL;

-- Candidate-user lookup for the same unclaimed-pending pool.
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_candidate_users
    ON workflow_tasks USING gin (candidate_users)
    WHERE status = 'pending' AND claimed_by IS NULL;
