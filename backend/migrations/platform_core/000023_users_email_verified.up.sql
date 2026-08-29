ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.email_verified IS 'Whether the user has verified their email address';

UPDATE users
SET email_verified = true
WHERE status = 'active'
  AND email_verified = false;
