import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({}) }));

import { presendCheck, resolveVariables } from './use-broadcast-sending';
import type { Contact } from '@/types';

const contact = (name?: string) => ({ id: 'c', phone: '+14155550001', name }) as Contact;

describe('resolveVariables fallback', () => {
  const vars = { '1': { type: 'field' as const, value: 'name', fallback: 'there' } };

  it('uses the contact value when present', () => {
    expect(resolveVariables(vars, contact('Asha'))).toEqual(['Asha']);
  });

  it('uses the fallback when the value is missing or blank (Meta 131008)', () => {
    expect(resolveVariables(vars, contact())).toEqual(['there']);
    expect(resolveVariables(vars, contact('  '))).toEqual(['there']);
  });

  it('applies to custom fields too', () => {
    const cf = { '1': { type: 'custom_field' as const, value: 'f1', fallback: 'friend' } };
    expect(resolveVariables(cf, contact(), new Map())).toEqual(['friend']);
  });
});

describe('presendCheck', () => {
  const people = [
    { id: 'a', phone: '+1', name: 'Asha' },
    { id: 'b', phone: '+2' },
    { id: 'c', phone: '+3', name: ' ' },
    { id: 'd', phone: '+4', marketing_opt_out_at: '2026-10-01T00:00:00Z' },
  ] as Contact[];
  const byName = { '1': { type: 'field' as const, value: 'name' } };

  it('counts blank values per variable and opted-out contacts for Marketing', () => {
    // d is opted out: skipped, so not also counted as missing a name.
    expect(presendCheck(people, byName, new Map(), true)).toEqual({
      total: 4,
      optedOut: 1,
      missing: [{ key: '1', count: 2 }],
    });
  });

  it('ignores opt-outs for non-Marketing templates', () => {
    expect(presendCheck(people, byName, new Map(), false)).toMatchObject({ optedOut: 0, missing: [{ key: '1', count: 3 }] });
  });

  it('does not warn when a fallback is set or the value is static', () => {
    const vars = {
      '1': { type: 'field' as const, value: 'name', fallback: 'there' },
      '2': { type: 'static' as const, value: '' },
    };
    expect(presendCheck(people, vars, new Map(), true).missing).toEqual([]);
  });

  it('reads custom field values from the index', () => {
    const vars = { '1': { type: 'custom_field' as const, value: 'f1' } };
    const index = new Map([['a', new Map([['f1', 'Gold']])]]);
    expect(presendCheck(people, vars, index, true).missing).toEqual([{ key: '1', count: 2 }]);
  });
});
