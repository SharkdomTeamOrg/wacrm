-- ============================================================
-- 046_inbox_delete_archive
--
-- WhatsApp-style inbox actions.
--
--   messages.deleted_at / deleted_by
--     "Delete for me": hides a message from the wacrm inbox for the whole
--     team. The row stays (reports, broadcast stats, audit). Meta's Cloud
--     API cannot recall a sent message, so the customer still has it.
--
--   conversations.archived_at
--     Archived chats leave the main inbox list. A new message from the
--     customer brings the chat back (trigger below), like WhatsApp.
--
--   Delete chat
--     - deals.conversation_id had no ON DELETE action, so any chat with a
--       deal attached could not be deleted at all. It becomes SET NULL:
--       the deal survives, it just loses its link to the chat.
--     - conversations DELETE becomes admin-only (was agent), enforced by
--       RLS as well as the API.
--
-- Re-run safe.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Deleting a chat keeps its deal.
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_conversation_id_fkey;
ALTER TABLE deals
  ADD CONSTRAINT deals_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

-- Only admins/owner may delete a chat.
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- A customer writing to an archived chat un-archives it.
CREATE OR REPLACE FUNCTION public.unarchive_on_customer_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    UPDATE conversations
    SET archived_at = NULL
    WHERE id = NEW.conversation_id
      AND archived_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS unarchive_on_customer_message ON messages;
CREATE TRIGGER unarchive_on_customer_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.unarchive_on_customer_message();
