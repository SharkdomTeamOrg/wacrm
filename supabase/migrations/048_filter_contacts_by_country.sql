-- Filter and page contacts by tags and/or international dialing prefix.
-- SECURITY INVOKER keeps the caller's contacts and contact_tags RLS in force.
CREATE OR REPLACE FUNCTION public.filter_contacts(
  p_tag_ids UUID[] DEFAULT '{}',
  p_phone_prefix TEXT DEFAULT NULL,
  p_exclude_tag_ids UUID[] DEFAULT '{}',
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT c.id, c.created_at
    FROM contacts c
    WHERE (
        COALESCE(cardinality(p_tag_ids), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM contact_tags ct
          WHERE ct.contact_id = c.id
            AND ct.tag_id = ANY(p_tag_ids)
        )
      )
      AND (
        p_phone_prefix IS NULL
        OR c.phone_normalized LIKE p_phone_prefix || '%'
      )
      AND (
        COALESCE(cardinality(p_exclude_tag_ids), 0) = 0
        OR NOT EXISTS (
          SELECT 1
          FROM contact_tags ct
          WHERE ct.contact_id = c.id
            AND ct.tag_id = ANY(p_exclude_tag_ids)
        )
      )
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts(UUID[], TEXT, UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts(UUID[], TEXT, UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts(UUID[], TEXT, UUID[], TEXT, INT, INT) TO authenticated;
