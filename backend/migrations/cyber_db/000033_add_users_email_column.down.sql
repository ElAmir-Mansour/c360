-- True inverse of 000033_add_users_email_column.up.sql.
-- The up migration now owns the full lifecycle of the lightweight cyber_db
-- `users` projection table, so the down simply drops it. CASCADE removes the
-- attached RLS policies and the tenant index. This is idempotent and safe to
-- re-run; a subsequent up will recreate the table cleanly.
DROP TABLE IF EXISTS users CASCADE;
