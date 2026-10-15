import { afterEach, describe, expect, it, vi } from 'vitest';
import { editMessageTemplate } from './meta-api';

afterEach(() => vi.unstubAllGlobals());

describe('Meta error messages', () => {
  it('appends error_user_title / error_user_msg to the generic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'Invalid parameter',
              code: 100,
              error_user_title: 'Template edit not allowed',
              error_user_msg: 'You can only edit an approved template once per day.',
            },
          }),
          { status: 400 },
        ),
      ),
    );
    await expect(
      editMessageTemplate({ metaTemplateId: '1', accessToken: 't', components: [] }),
    ).rejects.toThrow(
      'Invalid parameter — Template edit not allowed: You can only edit an approved template once per day.',
    );
  });

  it('keeps the bare message when Meta gives no extra detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid parameter' } }), { status: 400 })),
    );
    await expect(
      editMessageTemplate({ metaTemplateId: '1', accessToken: 't', components: [] }),
    ).rejects.toThrow(/^Invalid parameter$/);
  });
});
