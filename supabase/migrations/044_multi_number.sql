-- ============================================================
-- 044_multi_number
--
-- Several WhatsApp numbers per account (e.g. India, US, UK — more than
-- one per region allowed), all under the same WABA so templates stay
-- shared. Until now `whatsapp_config` was one row per account and
-- `conversations` one row per (account, contact).
--
--   whatsapp_config
--     - drop UNIQUE(account_id): an account may connect many numbers
--       (phone_number_id stays globally UNIQUE — one number, one account)
--     - label                 admin-facing name ("US Sales")
--     - display_phone_number  "+1 555 0100", cached from Meta on save
--     - verified_name         Meta display name, cached on save
--     - is_default            number used when nothing else decides
--                             (new outbound conversations, API sends,
--                             broadcasts without a chosen number).
--                             At most one per account.
--
--   conversations
--     - whatsapp_config_id    the business number this thread is on.
--                             A customer who writes to two numbers gets
--                             two threads, matching WhatsApp itself.
--                             SET NULL on number removal: the history
--                             stays and replies fall back to the default.
--     - unique key becomes (account_id, contact_id, whatsapp_config_id)
--
--   broadcasts
--     - whatsapp_config_id    sending number (NULL = default)
--
-- Backfill: every existing row is its account's only number, so it
-- becomes the default and every existing conversation is attached to it.
-- ============================================================

ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS verified_name TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- Pre-044 an account could only have one row, so each existing row is
-- its account's default. Written to be safe on re-run: only accounts
-- with no default yet get one (their oldest number).
UPDATE whatsapp_config w
SET is_default = TRUE
WHERE w.id = (
    SELECT w2.id FROM whatsapp_config w2
    WHERE w2.account_id = w.account_id
    ORDER BY w2.created_at, w2.id
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_config w3
    WHERE w3.account_id = w.account_id AND w3.is_default
  );

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_one_default_per_account
  ON whatsapp_config (account_id) WHERE is_default;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;

-- Re-run safe: skips a numberless thread (e.g. orphaned by removing a
-- number) whose contact already has a thread on the default number.
UPDATE conversations c
SET whatsapp_config_id = w.id
FROM whatsapp_config w
WHERE w.account_id = c.account_id
  AND w.is_default
  AND c.whatsapp_config_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM conversations c2
    WHERE c2.account_id = c.account_id
      AND c2.contact_id = c.contact_id
      AND c2.whatsapp_config_id = w.id
  );

-- Any conversation created without a number gets the account default.
-- Covers the window between running this migration and deploying the
-- code that sets whatsapp_config_id (old code inserts without it), and
-- any insert path that doesn't pick a number — so no thread is ever
-- numberless by accident and later duplicated by a number-scoped lookup.
CREATE OR REPLACE FUNCTION public.conversations_default_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.whatsapp_config_id IS NULL THEN
    SELECT id INTO NEW.whatsapp_config_id
    FROM whatsapp_config
    WHERE account_id = NEW.account_id
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_default_number ON conversations;
CREATE TRIGGER conversations_default_number
  BEFORE INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_default_number();

DROP INDEX IF EXISTS idx_conversations_account_contact;
-- Default NULLS DISTINCT on purpose: conversations orphaned by removing
-- a number (SET NULL above) must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_number
  ON conversations (account_id, contact_id, whatsapp_config_id);
CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;
