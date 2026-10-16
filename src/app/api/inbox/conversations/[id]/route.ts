import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PATCH /api/inbox/conversations/:id  { archived: boolean }
 * Archive / unarchive a chat (migration 046). Any agent. A new message
 * from the customer un-archives it automatically (DB trigger).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid conversation id.' }, { status: 400 })
    }
    const { supabase, accountId } = await requireRole('agent')
    const body = await request.json().catch(() => ({}))
    if (typeof body.archived !== 'boolean') {
      return NextResponse.json({ error: "'archived' must be true or false." }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('conversations')
      .update({ archived_at: body.archived ? new Date().toISOString() : null })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, archived_at')
      .maybeSingle()
    if (error) {
      console.error('[PATCH /api/inbox/conversations] update failed:', error.message)
      return NextResponse.json({ error: 'Failed to update conversation.' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, archived_at: data.archived_at })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/inbox/conversations/:id — delete a chat from wacrm.
 * Admin/owner only (also enforced by RLS since migration 046). Removes the
 * conversation and its messages; the contact and any deal are kept. The
 * customer's WhatsApp is unaffected.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid conversation id.' }, { status: 400 })
    }
    const { supabase, accountId } = await requireRole('admin')

    const { data, error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[DELETE /api/inbox/conversations] delete failed:', error.message)
      return NextResponse.json({ error: 'Failed to delete conversation.' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
