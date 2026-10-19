import { describe, expect, it } from 'vitest';
import { isRetryable, MARKETING_LIMIT_ERROR, type RetryFields } from './marketing-retry-rules';

const failed: RetryFields = {
  content_type: 'template',
  template_name: 'promo',
  template_send: { language: 'en_US', params: ['Asha'] },
  error_code: MARKETING_LIMIT_ERROR,
  retry_status: null,
  retry_of: null,
};

describe('isRetryable (131049 auto-retry)', () => {
  it('allows a template refused with 131049 that has its send payload', () => {
    expect(isRetryable(failed)).toBe(true);
  });

  it('allows re-scheduling after a cancel', () => {
    expect(isRetryable({ ...failed, retry_status: 'cancelled' })).toBe(true);
  });

  it.each<[string, Partial<RetryFields>]>([
    ['another error code', { error_code: 131026 }],
    ['a non-template message', { content_type: 'text' }],
    ['a pre-050 row without its payload', { template_send: null }],
    ['a message that is itself a retry', { retry_of: 'orig-1' }],
    ['one already scheduled', { retry_status: 'scheduled' }],
    ['one already retried', { retry_status: 'sent' }],
    ['one whose retry failed', { retry_status: 'failed' }],
  ])('refuses %s', (_label, patch) => {
    expect(isRetryable({ ...failed, ...patch })).toBe(false);
  });
});
