import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import {
  getPhoneCountryPrefix,
  type PhoneCountryFilterId,
} from './country-filters';

/**
 * Every contact whose number starts with one of the countries' dialing
 * prefixes, minus contacts carrying an excluded tag. One `filter_contacts`
 * call per country (paged), merged and de-duplicated.
 *
 * Shared by the broadcast audience review list and the sender, so the
 * list the user ticks through is exactly the set that gets resolved.
 */
export async function fetchCountryContacts(
  supabase: SupabaseClient,
  countries: readonly PhoneCountryFilterId[],
  excludeTagIds: readonly string[] = [],
): Promise<Contact[]> {
  const pageSize = 500;
  const byId = new Map<string, Contact>();

  for (const country of countries) {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.rpc('filter_contacts', {
        p_tag_ids: [],
        p_phone_prefix: getPhoneCountryPrefix(country),
        p_exclude_tag_ids: excludeTagIds,
        p_search: null,
        p_limit: pageSize,
        p_offset: offset,
      });
      if (error) throw new Error(`Failed to fetch country contacts: ${error.message}`);
      const rows = (data ?? []) as { contact: Contact }[];
      for (const row of rows) byId.set(row.contact.id, row.contact);
      if (rows.length < pageSize) break;
    }
  }

  return [...byId.values()];
}
