'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { useFailureText } from '@/hooks/use-failure-text';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Send,
  Loader2,
  Users,
  Save,
  FlaskConical,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useWhatsAppNumbers } from '@/hooks/use-whatsapp-numbers';
import { flagForPhone, numberName } from '@/lib/whatsapp/number-label';
import { audienceCountries } from '@/lib/contacts/country-filters';
import type {
  AudienceConfig,
  TestSendResult,
  PresendCheck,
  PresendPayload,
  VariableMapping,
} from '@/hooks/use-broadcast-sending';
import { toast } from 'sonner';

const TEST_PHONE_KEY = 'wacrm.broadcastTestPhone';
/** Stop waiting for a delivery report after this long. */
const TEST_WATCH_MS = 90_000;

type TestState =
  | { phase: 'failed'; failure: ReturnType<ReturnType<typeof useFailureText>> }
  | {
      phase: 'accepted' | 'delivered' | 'read' | 'untracked' | 'noReport';
      wamid: string;
      filledFrom: string | null;
    };

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  variables: Record<string, VariableMapping>;
  /** Reach + would-fail/skipped counts; never sends or writes. */
  checkAudience: (payload: PresendPayload) => Promise<PresendCheck>;
  /** Send the template once to a phone. */
  onSendTest?: (phone: string) => Promise<TestSendResult>;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
  /** Sending number (migration 044); '' = the account default. */
  fromNumberId?: string;
  onFromNumberChange?: (id: string) => void;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  variables,
  checkAudience,
  onSendTest,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
  fromNumberId = '',
  onFromNumberChange,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const numbers = useWhatsAppNumbers();
  const [showConfirm, setShowConfirm] = useState(false);
  const [check, setCheck] = useState<PresendCheck | null>(null);
  const [loadingReach, setLoadingReach] = useState(true);
  // Remembered per browser so the tester doesn't retype their number.
  const [testPhone, setTestPhone] = useState(() => {
    try {
      return localStorage.getItem(TEST_PHONE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestState | null>(null);
  const explainFailure = useFailureText();

  async function handleSendTest() {
    if (!onSendTest) return;
    setTesting(true);
    setTest(null);
    try {
      localStorage.setItem(TEST_PHONE_KEY, testPhone.trim());
    } catch {}
    try {
      const r = await onSendTest(testPhone.trim());
      setTest(
        r.ok
          ? { phase: r.tracked ? 'accepted' : 'untracked', wamid: r.wamid, filledFrom: r.filledFrom }
          : { phase: 'failed', failure: explainFailure(r.error) }
      );
    } catch (err) {
      setTest({ phase: 'failed', failure: explainFailure(err instanceof Error ? err.message : String(err)) });
    } finally {
      setTesting(false);
    }
  }

  // Meta accepts first and reports delivery later (webhook → messages row).
  // Watch the test's row until it's delivered, read or failed.
  const testWamid = test?.phase === 'accepted' ? test.wamid : null;
  useEffect(() => {
    if (!testWamid) return;
    const supabase = createClient();
    const started = Date.now();
    let stopped = false;
    const tick = async () => {
      const { data } = await supabase
        .from('messages')
        .select('status, error_code, error_title')
        .eq('message_id', testWamid)
        .limit(1)
        .maybeSingle();
      if (stopped) return;
      const done = (next: TestState) => {
        stopped = true;
        setTest((prev) => (prev && 'wamid' in prev && prev.wamid === testWamid ? next : prev));
      };
      if (data?.status === 'delivered' || data?.status === 'read') {
        done({ phase: data.status, wamid: testWamid, filledFrom: null });
      } else if (data?.status === 'failed') {
        done({ phase: 'failed', failure: explainFailure(data.error_title, data.error_code) });
      } else if (Date.now() - started > TEST_WATCH_MS) {
        done({ phase: 'noReport', wamid: testWamid, filledFrom: null });
      }
    };
    const id = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [testWamid, explainFailure]);

  // The hook hands back a fresh function each render; reading it through
  // an effect event keeps the check tied to template/audience/variables.
  const runCheck = useEffectEvent((p: PresendPayload) => checkAudience(p));
  useEffect(() => {
    let cancelled = false;
    setLoadingReach(true);
    runCheck({ template, audience, variables })
      .then((c) => !cancelled && setCheck(c))
      .catch(() => {
        if (!cancelled) toast.error(t('selectAudience.errorEstimate'));
      })
      .finally(() => !cancelled && setLoadingReach(false));
    return () => {
      cancelled = true;
    };
  }, [template, audience, variables, t]);
  const estimatedReach = check?.total ?? 0;

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : audience.type === 'country' && audienceCountries(audience).length > 0
            ? t('scheduleSend.audienceCountry', {
                country: audienceCountries(audience)
                  .map((c) => t(`selectAudience.countries.${c}`))
                  .join(', '),
              })
            : t('scheduleSend.audienceField');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('scheduleSend.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="text-foreground mb-1.5 block text-sm font-medium">
          {t('scheduleSend.broadcastName')}
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Sending number — only a choice when the account has several */}
      {numbers.length > 1 && onFromNumberChange && (
        <div>
          <label className="text-foreground mb-1.5 block text-sm font-medium">
            {t('scheduleSend.sendFrom')}
          </label>
          <select
            value={fromNumberId}
            onChange={(e) => onFromNumberChange(e.target.value)}
            className="border-border bg-muted text-foreground focus:ring-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          >
            {numbers.map((n) => (
              <option key={n.id} value={n.is_default ? '' : n.id}>
                {flagForPhone(n.display_phone_number)} {numberName(n)}
                {n.display_phone_number ? ` (${n.display_phone_number})` : ''}
                {n.is_default ? ` — ${t('scheduleSend.defaultNumber')}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary Card */}
      <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
        <p className="text-foreground text-sm font-medium">
          {t('scheduleSend.summary')}
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.template')}
            </p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.audience')}
            </p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.estimatedReach')}
            </p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="text-primary h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Users className="text-primary h-3.5 w-3.5" />
                  <p className="text-foreground font-medium">
                    {estimatedReach.toLocaleString()}
                  </p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.language')}
            </p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Pre-send warnings: contacts Meta will reject, contacts we skip */}
      {check && (check.missing.length > 0 || check.optedOut > 0) && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
        >
          {check.missing.map((m) => (
            <div key={m.key} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground">
                  {t('scheduleSend.warnMissing', { count: m.count, variable: `{{${m.key}}}` })}
                </p>
                <button
                  type="button"
                  onClick={onBack}
                  className="text-primary mt-0.5 text-xs font-medium hover:underline"
                >
                  {t('scheduleSend.addFallback')}
                </button>
              </div>
            </div>
          ))}
          {check.optedOut > 0 && (
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-foreground">
                {t('scheduleSend.warnOptedOut', { count: check.optedOut })}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Test send — the real template, to one number, before the campaign */}
      {onSendTest && (
        <div className="border-border bg-card/50 space-y-2 rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="text-primary h-4 w-4" />
            <p className="text-foreground text-sm font-medium">{t('scheduleSend.testTitle')}</p>
          </div>
          <p className="text-muted-foreground text-xs">{t('scheduleSend.testHint')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder={t('scheduleSend.testPlaceholder')}
              aria-label={t('scheduleSend.testTitle')}
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
            />
            <Button
              variant="outline"
              onClick={handleSendTest}
              disabled={!testPhone.trim() || testing || isProcessing}
              className="border-border shrink-0"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t('scheduleSend.testSend')}
            </Button>
          </div>
          {test && (
            <div role="status" className="space-y-0.5 text-xs">
              {test.phase === 'failed' ? (
                <>
                  <p className="text-destructive font-medium">{test.failure.title}</p>
                  {test.failure.advice && (
                    <p className="text-muted-foreground" title={test.failure.raw}>
                      {/* Tests aren't auto-retried, so the generic advice would mislead. */}
                      {test.failure.reason === 'marketingLimit'
                        ? t('scheduleSend.testMarketingLimit')
                        : test.failure.advice}
                    </p>
                  )}
                </>
              ) : (
                <p
                  className={`flex items-start gap-1.5 ${
                    test.phase === 'delivered' || test.phase === 'read'
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  }`}
                >
                  {test.phase === 'accepted' ? (
                    <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
                  ) : test.phase === 'delivered' || test.phase === 'read' ? (
                    <Check className="mt-0.5 h-3 w-3 shrink-0" />
                  ) : null}
                  {t(`scheduleSend.test_${test.phase}`)}
                </p>
              )}
              {test.phase !== 'failed' && test.filledFrom && (
                <p className="text-muted-foreground">
                  {t('scheduleSend.testFilledFrom', { name: test.filledFrom })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <div className="border-primary/20 bg-primary/5 rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="text-primary h-4 w-4 animate-spin" />
              <p className="text-foreground text-sm font-medium">
                {t('scheduleSend.sending')}
              </p>
            </div>
            <span className="text-primary text-xs font-medium">
              {progress}%
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full rounded-full">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={
                <Button
                  disabled={!name.trim() || isProcessing}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                />
              }
            >
              <Send className="h-4 w-4" />
              {t('scheduleSend.sendNow')}
            </DialogTrigger>
            <DialogContent className="border-border bg-popover sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">
                  {t('scheduleSend.confirmTitle')}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {t.rich('scheduleSend.confirmDesc', {
                    count: estimatedReach,
                    template: template.name,
                    b: (chunks) => (
                      <span className="text-popover-foreground font-medium">
                        {chunks}
                      </span>
                    ),
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="border-border text-muted-foreground"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    onSend();
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="h-4 w-4" />
                  {t('scheduleSend.sendNow')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
