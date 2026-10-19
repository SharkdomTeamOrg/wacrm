import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateConversationRow } from '@/lib/whatsapp/resolve-conversation';
import { persistBroadcastMessage } from './persist-broadcast-message';

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  findOrCreateConversationRow: vi.fn(),
}));

function makeDb(errorFor?: string) {
  const writes: {
    message?: Record<string, unknown>;
    conversation?: Record<string, unknown>;
  } = {};
  let table = '';
  const builder: Record<string, unknown> = {
    insert: (row: Record<string, unknown>) => {
      if (table === 'messages') writes.message = row;
      return builder;
    },
    update: (row: Record<string, unknown>) => {
      if (table === 'conversations') writes.conversation = row;
      return builder;
    },
    eq: () => builder,
    then: (
      resolve: (result: { error: { message: string } | null }) => unknown
    ) =>
      Promise.resolve({
        error: errorFor === table ? { message: 'write failed' } : null,
      }).then(resolve),
  };
  const db = {
    from: (tableName: string) => {
      table = tableName;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, writes };
}

describe('persistBroadcastMessage', () => {
  beforeEach(() => {
    vi.mocked(findOrCreateConversationRow).mockResolvedValue('conversation-1');
  });

  it('stores a rendered template message and refreshes the conversation preview', async () => {
    const { db, writes } = makeDb();

    await persistBroadcastMessage(db, {
      accountId: 'account-1',
      userId: 'user-1',
      contactId: 'contact-1',
      whatsappConfigId: 'config-1',
      templateName: 'welcome',
      templateRow: {
        id: 'template-1',
        user_id: 'user-1',
        name: 'welcome',
        category: 'Marketing',
        body_text: 'Hello {{1}}, your {{2}} is ready.',
        created_at: '',
      },
      templateParams: ['Asha', 'order'],
      templateLanguage: 'en_US',
      whatsappMessageId: 'wamid-1',
    });

    expect(findOrCreateConversationRow).toHaveBeenCalledWith(
      db,
      'account-1',
      'contact-1',
      'user-1',
      'config-1'
    );
    // recorded so a 131049 auto-retry can resend it identically
    expect(writes.message).toMatchObject({
      template_send: { language: 'en_US', params: ['Asha', 'order'] },
    });
    expect(writes.message).toMatchObject({
      conversation_id: 'conversation-1',
      sender_type: 'agent',
      content_type: 'template',
      content_text: 'Hello Asha, your order is ready.',
      template_name: 'welcome',
      message_id: 'wamid-1',
      status: 'sent',
    });
    expect(writes.conversation).toMatchObject({
      last_message_text: 'Hello Asha, your order is ready.',
    });
    expect(Date.parse(writes.message!.created_at as string)).not.toBeNaN();
  });

  it('surfaces a failed inbox write to its caller', async () => {
    const { db } = makeDb('messages');

    await expect(
      persistBroadcastMessage(db, {
        accountId: 'account-1',
        userId: 'user-1',
        contactId: 'contact-1',
        whatsappConfigId: 'config-1',
        templateName: 'welcome',
        templateRow: null,
        templateParams: [],
        templateLanguage: 'en_US',
        whatsappMessageId: 'wamid-1',
      })
    ).rejects.toThrow('Failed to save broadcast message: write failed');
  });
});
