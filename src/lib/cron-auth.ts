import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

function matches(supplied: string, expected: string | undefined): boolean {
  if (!expected) return false
  // Length pre-check is required by timingSafeEqual and leaks only length.
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Shared auth for the scheduled endpoints (automations, flows, template
 * retries). Accepts either:
 *   - `Authorization: Bearer $CRON_SECRET` — what Vercel Cron sends
 *     (vercel.json), the only header it can send;
 *   - `x-cron-secret: $AUTOMATION_CRON_SECRET` — external pingers /
 *     self-hosted setups (docs/docker.md).
 *
 * Returns null when authorized, else the response to send: 503 when
 * neither secret is configured, 401 on a wrong/missing secret.
 */
export function cronAuthError(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  const pingerSecret = process.env.AUTOMATION_CRON_SECRET
  if (!cronSecret && !pingerSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const header = request.headers.get('x-cron-secret') ?? ''
  if (matches(bearer, cronSecret) || matches(header, pingerSecret)) return null
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
