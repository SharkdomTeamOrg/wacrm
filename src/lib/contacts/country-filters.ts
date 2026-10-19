export const PHONE_COUNTRY_FILTERS = {
  india: { phonePrefix: '91' },
  northAmerica: { phonePrefix: '1' },
  uk: { phonePrefix: '44' },
} as const;

export type PhoneCountryFilterId = keyof typeof PHONE_COUNTRY_FILTERS;

export function getPhoneCountryPrefix(country: PhoneCountryFilterId): string {
  return PHONE_COUNTRY_FILTERS[country].phonePrefix;
}

/**
 * The countries a broadcast audience targets. Multi-select (`phoneCountries`)
 * since the review-list change; drafts saved before it carry the single
 * `phoneCountry`, so that is still honoured. Unknown ids are dropped.
 */
export function audienceCountries(audience: {
  phoneCountries?: readonly string[] | null;
  phoneCountry?: string | null;
}): PhoneCountryFilterId[] {
  const raw = audience.phoneCountries?.length
    ? audience.phoneCountries
    : audience.phoneCountry
      ? [audience.phoneCountry]
      : [];
  return [...new Set(raw)].filter((c): c is PhoneCountryFilterId =>
    Object.hasOwn(PHONE_COUNTRY_FILTERS, c),
  );
}
