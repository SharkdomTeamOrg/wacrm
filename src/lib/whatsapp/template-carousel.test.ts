import { describe, expect, it } from 'vitest';
import { validateTemplatePayload, type TemplatePayload } from './template-validators';
import { buildMetaTemplatePayload } from './template-components';
import { buildSendComponents } from './template-send-builder';
import { templateContentText } from './template-body';
import type { CarouselCard, MessageTemplate } from '@/types';

function card(n: number, overrides: Partial<CarouselCard> = {}): CarouselCard {
  return {
    header_type: 'image',
    header_media_url: `https://cdn.example.com/offer${n}.jpg`,
    body_text: `Offer ${n}`,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Interested' },
      { type: 'URL', text: 'Book now', url: `https://example.com/offer/${n}` },
    ],
    ...overrides,
  };
}

const payload: TemplatePayload = {
  name: 'monsoon_offers',
  category: 'Marketing',
  language: 'en_US',
  body_text: 'Hi {{1}}, swipe for this week’s offers.',
  sample_values: { body: ['Asha'] },
  carousel_cards: [card(1), card(2)],
};

describe('validateCarousel', () => {
  it('accepts a valid 2-card carousel', () => {
    expect(() => validateTemplatePayload(payload)).not.toThrow();
  });

  it.each<[string, Partial<TemplatePayload>, RegExp]>([
    ['one card', { carousel_cards: [card(1)] }, /2–10 cards/],
    ['eleven cards', { carousel_cards: Array.from({ length: 11 }, (_, i) => card(i)) }, /2–10 cards/],
    ['top-level header', { header_type: 'text', header_content: 'Hi' }, /top-level header/],
    ['footer', { footer_text: 'bye' }, /footer/],
    ['mixed media', { carousel_cards: [card(1), card(2, { header_type: 'video' })] }, /same header type/],
    ['missing media', { carousel_cards: [card(1), card(2, { header_media_url: undefined })] }, /missing its image/],
    ['card variable', { carousel_cards: [card(1), card(2, { body_text: 'Hi {{1}}' })] }, /cannot contain/],
    ['long card body', { carousel_cards: [card(1), card(2, { body_text: 'x'.repeat(161) })] }, /160/],
    [
      'button mismatch',
      { carousel_cards: [card(1), card(2, { buttons: [{ type: 'QUICK_REPLY', text: 'Hi' }] })] },
      /same buttons/,
    ],
    [
      'variable url',
      {
        carousel_cards: [
          card(1),
          card(2, {
            buttons: [
              { type: 'QUICK_REPLY', text: 'Interested' },
              { type: 'URL', text: 'Book', url: 'https://x.com/{{1}}', example: 'a' },
            ],
          }),
        ],
      },
      /fixed URLs/,
    ],
  ])('rejects %s', (_label, patch, message) => {
    expect(() => validateTemplatePayload({ ...payload, ...patch })).toThrow(message);
  });
});

describe('buildMetaTemplatePayload — carousel', () => {
  it('emits BODY then CAROUSEL with per-card HEADER/BODY/BUTTONS', () => {
    const p = { ...payload, carousel_cards: [card(1, { header_handle: 'h1' }), card(2)] };
    const { components } = buildMetaTemplatePayload(p);
    expect(components.map((c) => c.type)).toEqual(['BODY', 'CAROUSEL']);
    expect(components[1].cards![0].components).toEqual([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h1'] } },
      { type: 'BODY', text: 'Offer 1' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Interested' },
          { type: 'URL', text: 'Book now', url: 'https://example.com/offer/1' },
        ],
      },
    ]);
  });
});

const row: MessageTemplate = {
  id: 'r1',
  user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  ...payload,
};

describe('buildSendComponents — carousel', () => {
  it('sends each card media + quick-reply payload, indexed by card', () => {
    const components = buildSendComponents(row, { body: ['Asha'] });
    expect(components[0]).toEqual({ type: 'body', parameters: [{ type: 'text', text: 'Asha' }] });
    expect(components[1]).toEqual({
      type: 'carousel',
      cards: [0, 1].map((ci) => ({
        card_index: ci,
        components: [
          {
            type: 'header',
            parameters: [{ type: 'image', image: { link: `https://cdn.example.com/offer${ci + 1}.jpg` } }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: `card${ci}_Interested` }],
          },
        ],
      })),
    });
  });

  it('throws a fixable error when a synced card has no media link', () => {
    const synced = { ...row, carousel_cards: [card(1), card(2, { header_media_url: undefined })] };
    expect(() => buildSendComponents(synced, { body: ['Asha'] })).toThrow(/card #2 has no media URL/);
  });
});

describe('templateContentText — carousel', () => {
  it('lists the cards under the rendered body', () => {
    expect(templateContentText(row, ['Asha'])).toBe(
      'Hi Asha, swipe for this week’s offers.\n\n▸ Card 1: Offer 1\n▸ Card 2: Offer 2',
    );
  });
});
