import { describe, expect, it } from 'vitest';
import { waSegments } from './wa-format';

const show = (t: string) =>
  waSegments(t)
    .map((s) => {
      let x = s.text;
      if (s.bold) x = `<b>${x}</b>`;
      if (s.italic) x = `<i>${x}</i>`;
      if (s.strike) x = `<s>${x}</s>`;
      if (s.mono) x = `<code>${x}</code>`;
      return x;
    })
    .join('');

describe('waSegments', () => {
  it('renders WhatsApp markers', () => {
    expect(show('Hi *Rahul*, _see_ ~old~ ```code```')).toBe(
      'Hi <b>Rahul</b>, <i>see</i> <s>old</s> <code>code</code>',
    );
  });

  it('shows markdown-style ** the way the phone does: stray stars around bold', () => {
    expect(show('**Tomorrow, 19th Oct**')).toBe('*<b>Tomorrow, 19th Oct</b>*');
  });

  it('ignores markers with spaces inside or across lines', () => {
    expect(show('5 * 3 * 2')).toBe('5 * 3 * 2');
    expect(show('*not\nbold*')).toBe('*not\nbold*');
    expect(show('snake_case_name')).toBe('snake_case_name');
  });

  it('nests', () => {
    expect(show('*_both_*')).toBe('<i><b>both</b></i>');
  });
});
