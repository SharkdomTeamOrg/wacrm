-- Bring archived chats back to the inbox when either side sends a message.
-- Migration 046 only handled inbound customer messages. This also covers an
-- agent starting or resuming a conversation from the inbox.

CREATE OR REPLACE FUNCTION public.unarchive_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversations
  SET archived_at = NULL
  WHERE id = NEW.conversation_id
    AND archived_at IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS unarchive_on_customer_message ON messages;
DROP TRIGGER IF EXISTS unarchive_on_message ON messages;
CREATE TRIGGER unarchive_on_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.unarchive_on_message();

DROP FUNCTION IF EXISTS public.unarchive_on_customer_message();
