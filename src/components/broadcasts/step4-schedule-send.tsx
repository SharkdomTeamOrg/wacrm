'use client';

import { useEffect, useState } from 'react';
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
import { ArrowLeft, Send, Loader2, Users, Save, FlaskConical, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useWhatsAppNumbers } from '@/hooks/use-whatsapp-numbers';
import { flagForPhone, numberName } from '@/lib/whatsapp/number-label';
import {
  audienceCountries,
  type PhoneCountryFilterId,
} from '@/lib/contacts/country-filters';
import { fetchCountryContacts } from '@/lib/contacts/fetch-country-contacts';
import { toast } from 'sonner';

const TEST_PHONE_KEY = 'wacrm.broadcastTestPhone';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
  phoneCountry?: PhoneCountryFilterId;
  phoneCountries?: PhoneCountryFilterId[];
  excludedContactIds?: string[];
  excludeTagIds?: string[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  /** Send the template once to a phone; resolves to an error or null. */
  onSendTest?: (phone: string) => Promise<string | null>;
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
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
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
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSendTest() {
    if (!onSendTest) return;
    setTesting(true);
    setTestResult(null);
    try {
      localStorage.setItem(TEST_PHONE_KEY, testPhone.trim());
    } catch {}
    try {
      const error = await onSendTest(testPhone.trim());
      setTestResult(
        error ? { ok: false, text: error } : { ok: true, text: t('scheduleSend.testSent') }
      );
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (
          audience.type === 'tags' &&
          audience.tagIds &&
          audience.tagIds.length > 0
        ) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set(
            (contactTags ?? []).map((ct) => ct.contact_id)
          );
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else if (audience.type === 'country') {
          // Same resolution the sender uses: selected countries minus
          // excluded tags minus contacts unticked in the review list.
          try {
            const excluded = new Set(audience.excludedContactIds ?? []);
            const rows = await fetchCountryContacts(
              supabase,
              audienceCountries(audience),
              audience.excludeTagIds ?? [],
            );
            setEstimatedReach(rows.filter((c) => !excluded.has(c.id)).length);
          } catch {
            toast.error(t('selectAudience.errorEstimate'));
            setEstimatedReach(0);
          }
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience, t]);

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
          {testResult && (
            <p
              role="status"
              className={`flex items-start gap-1.5 text-xs ${testResult.ok ? 'text-primary' : 'text-destructive'}`}
            >
              {testResult.ok && <Check className="mt-0.5 h-3 w-3 shrink-0" />}
              {testResult.text}
            </p>
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
