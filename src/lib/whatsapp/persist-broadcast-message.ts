import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageTemplate } from '@/types';
import { findOrCreateConversationRow } from '@/lib/whatsapp/resolve-conversation';
import { templateContentText } from '@/lib/whatsapp/template-body';

export interface PersistBroadcastMessageParams {
  accountId: string;
  userId: string;
  contactId: string;
  whatsappConfigId: string;
  templateName: string;
  templateRow: MessageTemplate | null;
  templateParams: string[];
  /** Language the template was sent in (for exact retries). */
  templateLanguage: string;
  /** Structured header/button values, when the sender used them. */
  messageParams?: unknown;
  whatsappMessageId: string;
}

export async function persistBroadcastMessage(
  db: SupabaseClient,
  params: PersistBroadcastMessageParams
): Promise<void> {
  const conversationId = await findOrCreateConversationRow(
    db,
    params.accountId,
    params.contactId,
    params.userId,
    params.whatsappConfigId
  );
  const createdAt = new Date().toISOString();
  const contentText = templateContentText(
    params.templateRow,
    params.templateParams
  );

  const { error: messageError } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'agent',
    content_type: 'template',
    content_text: contentText,
    template_name: params.templateName,
    template_send: {
      language: params.templateLanguage,
      params: params.templateParams,
      messageParams: params.messageParams ?? null,
    },
    message_id: params.whatsappMessageId,
    status: 'sent',
    created_at: createdAt,
  });

  if (messageError) {
    throw new Error(
      `Failed to save broadcast message: ${messageError.message}`
    );
  }

  const { error: conversationError } = await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${params.templateName}]`,
      last_message_at: createdAt,
      updated_at: createdAt,
    })
    .eq('id', conversationId)
    .eq('account_id', params.accountId);

  if (conversationError) {
    throw new Error(
      `Failed to update inbox conversation: ${conversationError.message}`
    );
  }
}
