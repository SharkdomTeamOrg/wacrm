import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getWhatsAppConfig } from './config-resolve';

// Two numbers on acct-1 (cfg-us is the default) and one on acct-2.
const ROWS = [
  { id: 'cfg-us', account_id: 'acct-1', is_default: true },
  { id: 'cfg-uk', account_id: 'acct-1', is_default: false },
  { id: 'cfg-other', account_id: 'acct-2', is_default: true },
];
const CONVS = [
  { id: 'conv-uk', account_id: 'acct-1', whatsapp_config_id: 'cfg-uk' },
  { id: 'conv-orphan', account_id: 'acct-1', whatsapp_config_id: null },
];

// Minimal in-memory query builder: eq filters, order/limit list, maybeSingle.
function db(): SupabaseClient {
  return {
    from(table: string) {
      let rows: Record<string, unknown>[] = table === 'conversations' ? CONVS : ROWS;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return b;
        },
        order: () => b,
        limit: async () => ({
          data: [...rows].sort((x, y) => Number(y.is_default) - Number(x.is_default)),
          error: null,
        }),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const id = async (acct: string, opts = {}) =>
  ((await getWhatsAppConfig<{ id: string }>(db(), acct, opts)) ?? null)?.id ?? null;

describe('getWhatsAppConfig', () => {
  it('falls back to the account default', async () => {
    expect(await id('acct-1')).toBe('cfg-us');
  });

  it("uses the conversation's own number", async () => {
    expect(await id('acct-1', { conversationId: 'conv-uk' })).toBe('cfg-uk');
  });

  it('falls back to the default when the thread lost its number', async () => {
    expect(await id('acct-1', { conversationId: 'conv-orphan' })).toBe('cfg-us');
  });

  it('honours an explicit number', async () => {
    expect(await id('acct-1', { configId: 'cfg-uk' })).toBe('cfg-uk');
  });

  it("never returns another account's number for an explicit id", async () => {
    expect(await id('acct-1', { configId: 'cfg-other' })).toBeNull();
  });

  it('returns null when the account has no number', async () => {
    expect(await id('acct-3')).toBeNull();
  });
});
