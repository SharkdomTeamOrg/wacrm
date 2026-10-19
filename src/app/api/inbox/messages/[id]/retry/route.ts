import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { setRetry } from '@/lib/whatsapp/marketing-retry'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/inbox/messages/:id/retry  { action: 'schedule' | 'cancel' }
 * Schedule the one 24h retry of a template Meta refused with 131049, or
 * cancel a scheduled one (migration 050). Any agent.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid message id.' }, { status: 400 })
    }
    const { supabase, accountId } = await requireRole('agent')
    const body = await request.json().catch(() => ({}))
    if (body.action !== 'schedule' && body.action !== 'cancel') {
      return NextResponse.json({ error: "'action' must be schedule or cancel." }, { status: 400 })
    }
    const result = await setRetry(supabase, accountId, id, body.action)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
