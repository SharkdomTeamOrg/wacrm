import { describe, expect, it } from 'vitest';
import { optKeyword } from './marketing-opt-out';

describe('optKeyword', () => {
  it.each(['STOP', 'stop', ' Stop! ', 'Unsubscribe', 'UNSUBSCRIBE ME', 'Stop promotions', 'opt-out', 'Stop 🛑'])(
    'opts out on %j',
    (t) => expect(optKeyword(t)).toBe('out'),
  );

  it.each(['START', 'Start', 'subscribe', 'Resume promotions', 'opt in'])('opts back in on %j', (t) =>
    expect(optKeyword(t)).toBe('in'),
  );

  it.each([
    "don't stop",
    'stop by tomorrow please',
    'Please stop sending me the wrong invoice', // a complaint, not an opt-out
    'hello',
    '',
    null,
    undefined,
  ])('ignores %j', (t) => expect(optKeyword(t)).toBeNull());
});
