// Do-not-market list (migration 051). Pure keyword matching + the one
// write helper; callers decide what "opted out" blocks (marketing only).

import type { SupabaseClient } from '@supabase/supabase-js'

export type OptOutSource = 'keyword' | 'meta' | 'manual'

// Whole-message matches only — "don't stop" or "stop by tomorrow" must
// not unsubscribe anyone. Includes WhatsApp's marketing opt-out button
// label ("Stop promotions") and its resume counterpart.
const OPT_OUT = new Set([
  'stop', 'stop all', 'stopall', 'unsubscribe', 'unsubscribe me', 'opt out', 'optout',
  'stop promotions', 'stop promotion', 'stop marketing', 'stop messages', 'remove me',
])
const OPT_IN = new Set([
  'start', 'unstop', 'subscribe', 'opt in', 'optin', 'resume promotions', 'resume',
])

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation / emoji
    .replace(/\s+/g, ' ')
    .trim()
}

/** 'out' / 'in' when the whole message is an opt keyword, else null. */
export function optKeyword(text: string | null | undefined): 'out' | 'in' | null {
  if (!text) return null
  const t = normalize(text)
  if (OPT_OUT.has(t)) return 'out'
  if (OPT_IN.has(t)) return 'in'
  return null
}

export const OPTED_OUT_ERROR = 'Not sent: contact opted out of marketing'

/** Only Marketing templates are blocked; utility/auth still go out. */
export function isMarketingTemplate(row: { category?: string | null } | null | undefined): boolean {
  return row?.category?.toUpperCase() === 'MARKETING'
}

/** Which of these contacts are on the do-not-market list. */
export async function optedOutContactIds(db: SupabaseClient, contactIds: string[]): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set()
  const { data, error } = await db
    .from('contacts')
    .select('id')
    .in('id', contactIds)
    .not('marketing_opt_out_at', 'is', null)
  if (error) throw new Error(`Failed to check marketing opt-outs: ${error.message}`)
  return new Set((data ?? []).map((c: { id: string }) => c.id))
}

export function isOptedOut(contact: { marketing_opt_out_at?: string | null } | null | undefined): boolean {
  return !!contact?.marketing_opt_out_at
}

/** Opt a contact out of (or back into) marketing. Idempotent. */
export async function setMarketingOptOut(
  db: SupabaseClient,
  contactId: string,
  optedOut: boolean,
  source: OptOutSource,
): Promise<void> {
  const q = db
    .from('contacts')
    .update(
      optedOut
        ? { marketing_opt_out_at: new Date().toISOString(), marketing_opt_out_source: source }
        : { marketing_opt_out_at: null, marketing_opt_out_source: null },
    )
    .eq('id', contactId)
  // Opting out keeps the first timestamp/source; re-opting is a no-op.
  const { error } = await (optedOut ? q.is('marketing_opt_out_at', null) : q)
  if (error) throw new Error(`Failed to update marketing opt-out: ${error.message}`)
}
