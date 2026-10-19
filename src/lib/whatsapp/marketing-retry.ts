// ============================================================
// Auto-retry for Meta error 131049 (migration 050).
//
// 131049 = "This message was not delivered to maintain healthy ecosystem
// engagement": Meta's per-user cap on marketing templates. Meta's guidance
// is to wait at least 24 hours before resending, and that retrying sooner
// only fails again. So a failed template gets ONE retry, 24 hours later,
// sent through the normal send core (same number, same thread, same
// template + values). If the retry is refused too, we stop.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import type { TemplateSendRecord } from '@/types'
import { isRetryable, RETRY_DELAY_MS } from './marketing-retry-rules'

export { MARKETING_LIMIT_ERROR, RETRY_DELAY_MS, isRetryable } from './marketing-retry-rules'

interface RetryCandidate {
  id: string
  conversation_id: string
  content_type: string
  template_name: string | null
  template_send: TemplateSendRecord | null
  error_code: number | null
  retry_status: string | null
  retry_of: string | null
  message_id: string | null
}

const CANDIDATE_COLUMNS =
  'id, conversation_id, content_type, template_name, template_send, error_code, retry_status, retry_of, message_id'

/**
 * Webhook hook: a status update reported 131049 for this Meta message id.
 * Schedules the retry if the account has auto-retry on; if the failed
 * message is itself a retry, marks the original's retry as failed.
 */
export async function onMarketingLimitFailure(
  db: SupabaseClient,
  whatsappMessageId: string,
  now: Date = new Date(),
): Promise<void> {
  const { data: msg } = await db
    .from('messages')
    .select(`${CANDIDATE_COLUMNS}, conversations!inner(account_id, accounts!inner(auto_retry_marketing_limit))`)
    .eq('message_id', whatsappMessageId)
    .maybeSingle()
  if (!msg) return

  if (msg.retry_of) {
    await db
      .from('messages')
      .update({ retry_status: 'failed', retry_error: 'Meta refused the retry too (131049).' })
      .eq('id', msg.retry_of)
    return
  }

  const conv = msg.conversations as unknown as {
    accounts: { auto_retry_marketing_limit: boolean } | null
  } | null
  const autoRetry = conv?.accounts?.auto_retry_marketing_limit !== false
  if (!autoRetry || !isRetryable(msg as RetryCandidate)) return

  await db
    .from('messages')
    .update({
      retry_status: 'scheduled',
      retry_at: new Date(now.getTime() + RETRY_DELAY_MS).toISOString(),
      retry_error: null,
    })
    .eq('id', msg.id)
    .is('retry_status', null)
}

/** Manual control from the inbox: schedule (+24h) or cancel a retry. */
export async function setRetry(
  db: SupabaseClient,
  accountId: string,
  messageId: string,
  action: 'schedule' | 'cancel',
  now: Date = new Date(),
): Promise<{ ok: true; retry_status: string; retry_at: string | null } | { ok: false; status: number; error: string }> {
  const { data: msg } = await db
    .from('messages')
    .select(`${CANDIDATE_COLUMNS}, conversations!inner(account_id)`)
    .eq('id', messageId)
    .eq('conversations.account_id', accountId)
    .maybeSingle()
  if (!msg) return { ok: false, status: 404, error: 'Message not found.' }

  if (action === 'cancel') {
    if (msg.retry_status !== 'scheduled') {
      return { ok: false, status: 400, error: 'No retry is scheduled for this message.' }
    }
    await db.from('messages').update({ retry_status: 'cancelled', retry_at: null }).eq('id', messageId)
    return { ok: true, retry_status: 'cancelled', retry_at: null }
  }

  if (!isRetryable(msg as RetryCandidate)) {
    return {
      ok: false,
      status: 400,
      error: 'Only a template refused by Meta’s marketing limit (131049) can be retried, once.',
    }
  }
  const retryAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString()
  await db
    .from('messages')
    .update({ retry_status: 'scheduled', retry_at: retryAt, retry_error: null })
    .eq('id', messageId)
  return { ok: true, retry_status: 'scheduled', retry_at: retryAt }
}

/**
 * The scheduled job: resend every due retry. Each row is claimed first
 * (scheduled → running) so overlapping runs never double-send.
 */
export async function processDueRetries(
  db: SupabaseClient,
  now: Date = new Date(),
  limit = 50,
): Promise<{ processed: number; sent: number; failed: number }> {
  const { data: due, error } = await db
    .from('messages')
    .select(`${CANDIDATE_COLUMNS}, conversations!inner(account_id)`)
    .eq('retry_status', 'scheduled')
    .lte('retry_at', now.toISOString())
    .order('retry_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`Failed to load due retries: ${error.message}`)

  let sent = 0
  let failed = 0
  for (const row of due ?? []) {
    const { data: claimed } = await db
      .from('messages')
      .update({ retry_status: 'running' })
      .eq('id', row.id)
      .eq('retry_status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    const accountId = (row.conversations as unknown as { account_id: string }).account_id
    const send = row.template_send as TemplateSendRecord
    try {
      const result = await sendMessageToConversation(db, accountId, {
        conversationId: row.conversation_id,
        messageType: 'template',
        templateName: row.template_name,
        templateLanguage: send.language,
        templateParams: send.params ?? [],
        templateMessageParams: send.messageParams ?? undefined,
      })
      await db.from('messages').update({ retry_of: row.id }).eq('id', result.messageId)
      await db
        .from('messages')
        .update({ retry_status: 'sent', retry_message_id: result.messageId, retry_error: null })
        .eq('id', row.id)
      // A broadcast recipient follows its message to the resend, so the
      // campaign's delivered/read stats pick up the retry's outcome.
      if (row.message_id) {
        await db
          .from('broadcast_recipients')
          .update({
            whatsapp_message_id: result.whatsappMessageId,
            status: 'sent',
            sent_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('whatsapp_message_id', row.message_id)
      }
      sent++
    } catch (err) {
      await db
        .from('messages')
        .update({
          retry_status: 'failed',
          retry_error: err instanceof Error ? err.message.slice(0, 500) : 'Retry failed',
        })
        .eq('id', row.id)
      failed++
    }
  }
  return { processed: sent + failed, sent, failed }
}
