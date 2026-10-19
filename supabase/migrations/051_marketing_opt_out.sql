-- ============================================================
-- 051_marketing_opt_out
--
-- Do-not-market list. A contact is opted out of MARKETING when they:
--   - reply with an opt-out keyword (STOP, UNSUBSCRIBE, "stop
--     promotions", …)          → source 'keyword'
--   - Meta reports 131050 ("user stopped marketing messages") for a send
--                               → source 'meta'
--   - an agent marks them       → source 'manual'
-- "START" (or an agent) opts them back in (columns cleared).
--
-- Effect (app layer): broadcasts and marketing-category templates from
-- automations skip opted-out contacts. Utility/transactional messages and
-- agent replies in an open chat are unaffected, as WhatsApp allows.
--
-- Re-run safe.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_source TEXT
    CHECK (marketing_opt_out_source IN ('keyword', 'meta', 'manual'));

CREATE INDEX IF NOT EXISTS idx_contacts_marketing_opt_out
  ON contacts (account_id) WHERE marketing_opt_out_at IS NOT NULL;
