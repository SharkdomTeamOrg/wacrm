import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({}) }));

import { resolveVariables } from './use-broadcast-sending';
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
