import { describe, expect, it } from 'vitest';
import { failureCode, failureReason, groupFailures } from './message-failures';

describe('failureCode', () => {
  it('reads the code from webhook and send-error shapes', () => {
    expect(failureCode('[131049] This message was not delivered: details')).toBe(131049);
    expect(failureCode('(#131026) Message undeliverable')).toBe(131026);
    expect(failureCode('Invalid phone number format')).toBeNull();
    expect(failureCode(null)).toBeNull();
  });
});

describe('failureReason', () => {
  it.each([
    ['[131049] This message was not delivered to maintain healthy ecosystem engagement.', 'marketingLimit'],
    ['(#131008) Required parameter is missing — Parameter of type text is missing text value', 'missingVariable'],
    ['Not sent: contact opted out of marketing', 'userStoppedMarketing'],
    ['[131050] Unable to deliver the message: user stopped marketing messages', 'userStoppedMarketing'],
    ['(#131026) Message undeliverable', 'undeliverable'],
    ['[130472] User’s number is part of an experiment', 'experiment'],
    ['(#132000) Number of parameters does not match', 'templateProblem'],
    ['(#132015) Template is paused', 'templateProblem'],
    ['(#130429) Rate limit hit', 'rateLimit'],
    ['Invalid OAuth access token - Cannot parse access token', 'authExpired'],
    ['Invalid phone number format', 'invalidNumber'],
    ['[131042] Business eligibility payment issue', 'accountIssue'],
    ['(#100) Invalid parameter', 'other'],
    [undefined, 'other'],
  ])('%s → %s', (msg, reason) => {
    expect(failureReason(msg)).toBe(reason);
  });
});

describe('groupFailures', () => {
  it('counts only failed recipients, largest group first, with codes', () => {
    const groups = groupFailures([
      { status: 'failed', error_message: '[131049] limit' },
      { status: 'failed', error_message: '[131049] limit' },
      { status: 'failed', error_message: '(#131026) undeliverable' },
      { status: 'failed', error_message: '(#100) Invalid parameter' },
      { status: 'failed', error_message: '(#368) Temporarily blocked' },
      { status: 'delivered', error_message: null },
    ]);
    expect(groups).toEqual([
      { reason: 'marketingLimit', count: 2, codes: [131049] },
      { reason: 'undeliverable', count: 1, codes: [131026] },
      { reason: 'policyBlock', count: 1, codes: [368] },
      { reason: 'other', count: 1, codes: [100] },
    ]);
  });
});

describe('failureReason for 1:1 chat errors', () => {
  it.each([
    ['(#131047) Re-engagement message', 'outsideWindow'],
    ['(#131053) Media upload error', 'mediaProblem'],
    ['(#368) Temporarily blocked for policy violations', 'policyBlock'],
    ['(#131000) Something went wrong', 'metaTemporary'],
    ['(#131009) Parameter value is not valid', 'templateProblem'],
    ['Failed to fetch', 'network'],
    ['Invalid phone number format', 'invalidNumber'],
  ])('%j → %s', (msg, reason) => expect(failureReason(msg)).toBe(reason));

  it('prefers a structured code over the text', () => {
    expect(failureReason('Meta API error: Re-engagement message', 131047)).toBe('outsideWindow');
    expect(failureReason('Re-engagement message')).toBe('other');
  });
});
