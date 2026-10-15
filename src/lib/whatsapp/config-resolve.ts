// ============================================================
// Which WhatsApp number (whatsapp_config row) does this action use?
//
// Since migration 044 an account can connect several numbers, so the old
// `.eq('account_id', x).single()` lookup is wrong (it errors on ≥2 rows).
// Every server path resolves its row here instead:
//
//   1. an explicit `configId` (a broadcast's chosen number, a settings
//      edit) — must belong to the account;
//   2. else the number of `conversationId` (replies always leave from the
//      number the customer wrote to);
//   3. else the account's default number (oldest row as a last resort,
//      so an account whose default was removed still works).
//
// Returns null when the account has no number, or an explicit id/thread
// points at a row outside the account — callers map that to their
// existing "WhatsApp not configured" error.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolveConfigOptions {
  configId?: string | null
  conversationId?: string | null
}

export async function getWhatsAppConfig<T = Record<string, unknown>>(
  db: SupabaseClient,
  accountId: string,
  opts: ResolveConfigOptions = {},
  columns = '*',
): Promise<T | null> {
  let configId = opts.configId ?? null

  if (!configId && opts.conversationId) {
    const { data: conv } = await db
      .from('conversations')
      .select('whatsapp_config_id')
      .eq('id', opts.conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    configId = (conv?.whatsapp_config_id as string | null | undefined) ?? null
  }

  if (configId) {
    const { data } = await db
      .from('whatsapp_config')
      .select(columns)
      .eq('id', configId)
      .eq('account_id', accountId)
      .maybeSingle()
    // An explicit id is a hard choice: don't silently send from another
    // number. A conversation whose number vanished falls through below.
    if (data || opts.configId) return (data as T | null) ?? null
  }

  const { data: rows } = await db
    .from('whatsapp_config')
    .select(columns)
    .eq('account_id', accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
  return ((rows?.[0] as T | undefined) ?? null)
}
