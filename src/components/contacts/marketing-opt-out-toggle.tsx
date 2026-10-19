'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { createClient } from '@/lib/supabase/client';
import type { Contact } from '@/types';

/**
 * "Marketing messages" on/off for one contact (migration 051). Off means
 * broadcasts and Marketing templates from automations skip them; normal
 * replies still go out. Keeps its own state so either panel can host it.
 */
export function MarketingOptOutToggle({ contact }: { contact: Contact }) {
  const t = useTranslations('Contacts.optOut');
  const [optedOutAt, setOptedOutAt] = useState(contact.marketing_opt_out_at ?? null);
  const [source, setSource] = useState(contact.marketing_opt_out_source ?? null);
  const [saving, setSaving] = useState(false);
  // Re-sync when the host panel switches to another contact.
  const [shownId, setShownId] = useState(contact.id);
  if (shownId !== contact.id) {
    setShownId(contact.id);
    setOptedOutAt(contact.marketing_opt_out_at ?? null);
    setSource(contact.marketing_opt_out_source ?? null);
  }

  const subscribed = !optedOutAt;

  async function onChange(next: boolean) {
    setSaving(true);
    const patch = next
      ? { marketing_opt_out_at: null, marketing_opt_out_source: null }
      : { marketing_opt_out_at: new Date().toISOString(), marketing_opt_out_source: 'manual' as const };
    const { error } = await createClient().from('contacts').update(patch).eq('id', contact.id);
    setSaving(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    setOptedOutAt(patch.marketing_opt_out_at);
    setSource(patch.marketing_opt_out_source);
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg px-3 py-2">
      <div className="min-w-0 text-left">
        <p className="text-sm text-foreground">{t('label')}</p>
        <p className={`text-xs ${subscribed ? 'text-muted-foreground' : 'text-destructive'}`}>
          {subscribed
            ? t('subscribed')
            : t('optedOut', {
                source: source ?? 'manual',
                date: new Date(optedOutAt).toLocaleDateString(),
              })}
        </p>
      </div>
      <Switch checked={subscribed} onCheckedChange={onChange} disabled={saving} aria-label={t('label')} />
    </div>
  );
}
