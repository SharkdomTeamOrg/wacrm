export const PHONE_COUNTRY_FILTERS = {
  india: { phonePrefix: '91' },
  northAmerica: { phonePrefix: '1' },
  uk: { phonePrefix: '44' },
} as const;

export type PhoneCountryFilterId = keyof typeof PHONE_COUNTRY_FILTERS;

export function getPhoneCountryPrefix(country: PhoneCountryFilterId): string {
  return PHONE_COUNTRY_FILTERS[country].phonePrefix;
}
