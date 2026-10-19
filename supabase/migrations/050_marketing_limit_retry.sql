-- ============================================================
-- 050_marketing_limit_retry
--
-- Auto-retry templates that Meta refused with error 131049 ("This
-- message was not delivered to maintain healthy ecosystem engagement"):
-- Meta's per-user cap on marketing templates. Meta's guidance is to wait
-- at least 24 hours before resending, and that retrying sooner only fails
-- again — so one retry, 24 hours later, and no more.
--
--   messages.template_send   what was sent ({language, params,
--                            messageParams}) so a retry is identical.
--                            NULL for non-template and pre-050 rows
--                            (those can't be retried).
--   messages.retry_status    scheduled | running | sent | failed | cancelled
--   messages.retry_at        when a scheduled retry is due
--   messages.retry_error     why a retry attempt failed
--   messages.retry_of        on the resent message: the original
--   messages.retry_message_id on the original: the resent message
--
--   accounts.auto_retry_marketing_limit  schedule retries automatically
--                            (default on); off = only on request.
--
-- Re-run safe.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS template_send JSONB,
  ADD COLUMN IF NOT EXISTS retry_status TEXT
    CHECK (retry_status IN ('scheduled', 'running', 'sent', 'failed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_error TEXT,
  ADD COLUMN IF NOT EXISTS retry_of UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retry_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- The retry job only ever scans due, scheduled rows.
CREATE INDEX IF NOT EXISTS idx_messages_retry_due
  ON messages (retry_at) WHERE retry_status = 'scheduled';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auto_retry_marketing_limit BOOLEAN NOT NULL DEFAULT TRUE;
