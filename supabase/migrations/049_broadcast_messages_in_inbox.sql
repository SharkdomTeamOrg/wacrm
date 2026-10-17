-- Backfill successful broadcast deliveries into the shared Inbox.
--
-- Broadcast recipients already keep Meta's message id, contact and send
-- timestamp, but the old sender did not create the corresponding
-- conversations/messages rows. This migration imports that history;
-- new sends are persisted by the broadcast delivery code.

CREATE OR REPLACE FUNCTION public._render_broadcast_body(
  p_body TEXT,
  p_params JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_result TEXT := p_body;
  v_index INTEGER;
BEGIN
  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_params) = 'array' THEN
    FOR v_index IN 0..jsonb_array_length(p_params) - 1 LOOP
      v_result := replace(
        v_result,
        '{{' || (v_index + 1)::TEXT || '}}',
        COALESCE(p_params ->> v_index, '')
      );
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;

WITH delivered AS (
  SELECT
    b.account_id,
    b.user_id,
    br.contact_id,
    COALESCE(b.whatsapp_config_id, default_number.id) AS whatsapp_config_id,
    COALESCE(br.sent_at, br.created_at, b.updated_at, b.created_at) AS sent_at,
    COALESCE(
      public._render_broadcast_body(template.body_text, br.template_params),
      b.template_name
    ) AS content_text
  FROM broadcasts b
  JOIN broadcast_recipients br ON br.broadcast_id = b.id
  LEFT JOIN LATERAL (
    SELECT w.id
    FROM whatsapp_config w
    WHERE w.account_id = b.account_id
    ORDER BY w.is_default DESC, w.created_at ASC, w.id
    LIMIT 1
  ) default_number ON TRUE
  LEFT JOIN LATERAL (
    SELECT mt.body_text
    FROM message_templates mt
    WHERE mt.account_id = b.account_id
      AND mt.name = b.template_name
    ORDER BY
      CASE
        WHEN lower(mt.language) = lower(b.template_language) THEN 0
        WHEN split_part(lower(mt.language), '_', 1) =
             split_part(lower(b.template_language), '_', 1) THEN 1
        ELSE 2
      END,
      mt.created_at,
      mt.id
    LIMIT 1
  ) template ON TRUE
  WHERE br.status IN ('sent', 'delivered', 'read', 'replied')
    AND br.whatsapp_message_id IS NOT NULL
),
latest_per_thread AS (
  SELECT DISTINCT ON (
    account_id,
    contact_id,
    whatsapp_config_id
  ) *
  FROM delivered
  ORDER BY
    account_id,
    contact_id,
    whatsapp_config_id,
    sent_at DESC
)
INSERT INTO conversations (
  account_id,
  user_id,
  contact_id,
  whatsapp_config_id,
  last_message_text,
  last_message_at,
  created_at,
  updated_at
)
SELECT
  latest.account_id,
  latest.user_id,
  latest.contact_id,
  latest.whatsapp_config_id,
  latest.content_text,
  latest.sent_at,
  latest.sent_at,
  latest.sent_at
FROM latest_per_thread latest
WHERE NOT EXISTS (
  SELECT 1
  FROM conversations c
  WHERE c.account_id = latest.account_id
    AND c.contact_id = latest.contact_id
    AND c.whatsapp_config_id IS NOT DISTINCT FROM latest.whatsapp_config_id
);

WITH delivered AS (
  SELECT
    b.account_id,
    br.contact_id,
    b.template_name,
    br.whatsapp_message_id,
    br.status AS recipient_status,
    COALESCE(b.whatsapp_config_id, default_number.id) AS whatsapp_config_id,
    COALESCE(br.sent_at, br.created_at, b.updated_at, b.created_at) AS sent_at,
    COALESCE(
      public._render_broadcast_body(template.body_text, br.template_params),
      b.template_name
    ) AS content_text
  FROM broadcasts b
  JOIN broadcast_recipients br ON br.broadcast_id = b.id
  LEFT JOIN LATERAL (
    SELECT w.id
    FROM whatsapp_config w
    WHERE w.account_id = b.account_id
    ORDER BY w.is_default DESC, w.created_at ASC, w.id
    LIMIT 1
  ) default_number ON TRUE
  LEFT JOIN LATERAL (
    SELECT mt.body_text
    FROM message_templates mt
    WHERE mt.account_id = b.account_id
      AND mt.name = b.template_name
    ORDER BY
      CASE
        WHEN lower(mt.language) = lower(b.template_language) THEN 0
        WHEN split_part(lower(mt.language), '_', 1) =
             split_part(lower(b.template_language), '_', 1) THEN 1
        ELSE 2
      END,
      mt.created_at,
      mt.id
    LIMIT 1
  ) template ON TRUE
  WHERE br.status IN ('sent', 'delivered', 'read', 'replied')
    AND br.whatsapp_message_id IS NOT NULL
)
INSERT INTO messages (
  conversation_id,
  sender_type,
  content_type,
  content_text,
  template_name,
  message_id,
  status,
  created_at
)
SELECT
  thread.id,
  'agent',
  'template',
  delivered.content_text,
  delivered.template_name,
  delivered.whatsapp_message_id,
  CASE delivered.recipient_status
    WHEN 'replied' THEN 'read'
    ELSE delivered.recipient_status
  END,
  delivered.sent_at
FROM delivered
JOIN LATERAL (
  SELECT c.id
  FROM conversations c
  WHERE c.account_id = delivered.account_id
    AND c.contact_id = delivered.contact_id
    AND c.whatsapp_config_id IS NOT DISTINCT FROM delivered.whatsapp_config_id
  ORDER BY c.created_at, c.id
  LIMIT 1
) thread ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM messages m
  WHERE m.conversation_id = thread.id
    AND m.message_id = delivered.whatsapp_message_id
);

WITH delivered AS (
  SELECT
    b.account_id,
    br.contact_id,
    COALESCE(b.whatsapp_config_id, default_number.id) AS whatsapp_config_id,
    COALESCE(br.sent_at, br.created_at, b.updated_at, b.created_at) AS sent_at,
    COALESCE(
      public._render_broadcast_body(template.body_text, br.template_params),
      b.template_name
    ) AS content_text
  FROM broadcasts b
  JOIN broadcast_recipients br ON br.broadcast_id = b.id
  LEFT JOIN LATERAL (
    SELECT w.id
    FROM whatsapp_config w
    WHERE w.account_id = b.account_id
    ORDER BY w.is_default DESC, w.created_at ASC, w.id
    LIMIT 1
  ) default_number ON TRUE
  LEFT JOIN LATERAL (
    SELECT mt.body_text
    FROM message_templates mt
    WHERE mt.account_id = b.account_id
      AND mt.name = b.template_name
    ORDER BY
      CASE
        WHEN lower(mt.language) = lower(b.template_language) THEN 0
        WHEN split_part(lower(mt.language), '_', 1) =
             split_part(lower(b.template_language), '_', 1) THEN 1
        ELSE 2
      END,
      mt.created_at,
      mt.id
    LIMIT 1
  ) template ON TRUE
  WHERE br.status IN ('sent', 'delivered', 'read', 'replied')
    AND br.whatsapp_message_id IS NOT NULL
),
latest_per_thread AS (
  SELECT DISTINCT ON (
    account_id,
    contact_id,
    whatsapp_config_id
  ) *
  FROM delivered
  ORDER BY
    account_id,
    contact_id,
    whatsapp_config_id,
    sent_at DESC
)
UPDATE conversations c
SET last_message_text = latest.content_text,
    last_message_at = latest.sent_at,
    updated_at = GREATEST(c.updated_at, latest.sent_at)
FROM latest_per_thread latest
WHERE c.account_id = latest.account_id
  AND c.contact_id = latest.contact_id
  AND c.whatsapp_config_id IS NOT DISTINCT FROM latest.whatsapp_config_id
  AND (c.last_message_at IS NULL OR c.last_message_at <= latest.sent_at);

DROP FUNCTION public._render_broadcast_body(TEXT, JSONB);
