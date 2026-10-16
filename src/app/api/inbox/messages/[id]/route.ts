import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * DELETE /api/inbox/messages/:id — "Delete for me" (migration 046).
 *
 * Hides the message from the wacrm inbox for the whole team; the row is
 * kept (deleted_at) for reports and audit. WhatsApp's Cloud API cannot
 * recall a sent message, so the customer still has it — there is no
 * "delete for everyone".
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid message id.' }, { status: 400 })
    }
    const { supabase, accountId, userId } = await requireRole('agent')

    // Tenancy: the message must sit in a conversation of this account.
    const { data: msg } = await supabase
      .from('messages')
      .select('id, conversation_id, deleted_at, conversations!inner(account_id)')
      .eq('id', id)
      .eq('conversations.account_id', accountId)
      .maybeSingle()
    if (!msg) {
      return NextResponse.json({ error: 'Message not found.' }, { status: 404 })
    }
    if (msg.deleted_at) return NextResponse.json({ success: true })

    const { error } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq('id', id)
    if (error) {
      console.error('[DELETE /api/inbox/messages] update failed:', error.message)
      return NextResponse.json({ error: 'Failed to delete message.' }, { status: 500 })
    }

    // Keep the chat-list preview honest: show the latest message still
    // visible (or nothing). last_message_at is left alone so the chat
    // doesn't jump around in the list.
    const { data: latest } = await supabase
      .from('messages')
      .select('content_text, content_type')
      .eq('conversation_id', msg.conversation_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const preview = latest?.[0]
      ? latest[0].content_text || `[${latest[0].content_type}]`
      : null
    await supabase
      .from('conversations')
      .update({ last_message_text: preview })
      .eq('id', msg.conversation_id)
      .eq('account_id', accountId)

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
