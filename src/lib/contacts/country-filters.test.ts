import { describe, expect, it } from 'vitest';
import {
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
});
