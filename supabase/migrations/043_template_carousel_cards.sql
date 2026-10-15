-- ============================================================
-- 043_template_carousel_cards
--
-- Media-card carousel templates: a top-level body followed by 2–10
-- horizontally scrollable cards, each with its own image/video header,
-- body text and buttons. Stored as one JSONB array of cards
-- (see `CarouselCard` in src/types). NULL for every non-carousel
-- template. Per-card validation lives in the API layer
-- (template-validators.ts) for the same reason as `buttons`: specific
-- error messages beat a generic CHECK violation.
-- ============================================================

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS carousel_cards JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_templates_carousel_cards_check'
      AND conrelid = 'message_templates'::regclass
  ) THEN
    ALTER TABLE message_templates
      ADD CONSTRAINT message_templates_carousel_cards_check
      CHECK (carousel_cards IS NULL OR jsonb_typeof(carousel_cards) = 'array');
  END IF;
END $$;
