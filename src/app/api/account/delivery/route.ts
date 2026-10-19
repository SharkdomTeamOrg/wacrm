import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET/PATCH /api/account/delivery — account delivery settings.
 * `auto_retry_marketing_limit`: resend templates Meta refused with 131049
 * once, 24 hours later (migration 050). Admins change it; members can read.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { data, error } = await supabase
      .from('accounts')
      .select('auto_retry_marketing_limit')
      .eq('id', accountId)
      .single()
    if (error) return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
    return NextResponse.json({ auto_retry_marketing_limit: data.auto_retry_marketing_limit })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => ({}))
    if (typeof body.auto_retry_marketing_limit !== 'boolean') {
      return NextResponse.json(
        { error: "'auto_retry_marketing_limit' must be true or false" },
        { status: 400 },
      )
    }
    const { data, error } = await supabase
      .from('accounts')
      .update({ auto_retry_marketing_limit: body.auto_retry_marketing_limit })
      .eq('id', accountId)
      .select('auto_retry_marketing_limit')
      .single()
    if (error) return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    return NextResponse.json({ auto_retry_marketing_limit: data.auto_retry_marketing_limit })
  } catch (err) {
    return toErrorResponse(err)
  }
}
