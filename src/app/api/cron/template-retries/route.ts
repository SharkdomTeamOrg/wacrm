import { NextResponse } from 'next/server'
import { cronAuthError } from '@/lib/cron-auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { processDueRetries } from '@/lib/whatsapp/marketing-retry'

// Retries resend templates to Meta; never prerender or cache.
export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/template-retries — resend due 131049 retries (migration 050).
 *
 * Lives outside /api/whatsapp/ on purpose: middleware rejects signed-out
 * requests there (only the webhook is exempt), which would block the cron.
 *
 * Run hourly. Vercel Cron (vercel.json) calls it with
 * `Authorization: Bearer $CRON_SECRET`; self-hosted pingers can use the
 * same `x-cron-secret: $AUTOMATION_CRON_SECRET` header as the other crons.
 */
export async function GET(request: Request) {
  const denied = cronAuthError(request)
  if (denied) return denied

  try {
    const result = await processDueRetries(supabaseAdmin())
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/template-retries] failed:', err)
    return NextResponse.json({ error: 'Retry run failed' }, { status: 500 })
  }
}
