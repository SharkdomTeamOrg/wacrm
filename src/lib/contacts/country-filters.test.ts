import { describe, expect, it } from 'vitest';
import {
  audienceCountries,
  getPhoneCountryPrefix,
  PHONE_COUNTRY_FILTERS,
} from './country-filters';

describe('phone country filters', () => {
  it('maps the supported countries to their international dialing prefixes', () => {
    expect(getPhoneCountryPrefix('india')).toBe('91');
    expect(getPhoneCountryPrefix('northAmerica')).toBe('1');
    expect(getPhoneCountryPrefix('uk')).toBe('44');
  });

  it('exposes exactly the supported country filter options', () => {
    expect(Object.keys(PHONE_COUNTRY_FILTERS)).toEqual([
      'india',
      'northAmerica',
      'uk',
    ]);
  });

  it('reads multi-country audiences and still honours old single-country drafts', () => {
    expect(audienceCountries({ phoneCountries: ['india', 'uk'] })).toEqual(['india', 'uk']);
    expect(audienceCountries({ phoneCountry: 'northAmerica' })).toEqual(['northAmerica']);
    // multi wins over the legacy field; duplicates and unknown ids drop out
    expect(
      audienceCountries({ phoneCountries: ['uk', 'uk', 'mars'], phoneCountry: 'india' }),
    ).toEqual(['uk']);
    expect(audienceCountries({})).toEqual([]);
  });
});
