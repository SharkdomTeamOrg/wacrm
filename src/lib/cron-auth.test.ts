import { afterEach, describe, expect, it, vi } from 'vitest';
import { cronAuthError } from './cron-auth';

const req = (headers: Record<string, string>) =>
  new Request('https://x.test/api/automations/cron', { headers });

afterEach(() => vi.unstubAllEnvs());

describe('cronAuthError', () => {
  it('503 when no secret is configured', () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    expect(cronAuthError(req({}))?.status).toBe(503);
  });

  it("accepts Vercel Cron's Bearer CRON_SECRET", () => {
    vi.stubEnv('CRON_SECRET', 'vercel-secret');
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    expect(cronAuthError(req({ authorization: 'Bearer vercel-secret' }))).toBeNull();
  });

  it("accepts an external pinger's x-cron-secret", () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'pinger-secret');
    expect(cronAuthError(req({ 'x-cron-secret': 'pinger-secret' }))).toBeNull();
  });

  it('401 on a wrong secret, and never crosses the two secrets', () => {
    vi.stubEnv('CRON_SECRET', 'vercel-secret');
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'pinger-secret');
    expect(cronAuthError(req({ authorization: 'Bearer nope' }))?.status).toBe(401);
    expect(cronAuthError(req({ 'x-cron-secret': 'vercel-secret' }))?.status).toBe(401);
    expect(cronAuthError(req({ authorization: 'Bearer pinger-secret' }))?.status).toBe(401);
    expect(cronAuthError(req({}))?.status).toBe(401);
  });
});
