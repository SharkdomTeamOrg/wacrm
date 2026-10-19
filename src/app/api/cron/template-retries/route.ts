import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { processDueRetries } from '@/lib/whatsapp/marketing-retry'

// Retries resend templates to Meta; never prerender or cache.
export const dynamic = 'force-dynamic'

function matches(supplied: string, expected: string | undefined): boolean {
  if (!expected) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

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
  const cronSecret = process.env.CRON_SECRET
  const pingerSecret = process.env.AUTOMATION_CRON_SECRET
  if (!cronSecret && !pingerSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const header = request.headers.get('x-cron-secret') ?? ''
  if (!matches(bearer, cronSecret) && !matches(header, pingerSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processDueRetries(supabaseAdmin())
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/template-retries] failed:', err)
    return NextResponse.json({ error: 'Retry run failed' }, { status: 500 })
  }
}
