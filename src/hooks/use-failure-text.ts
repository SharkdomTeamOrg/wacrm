'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { failureReason, type FailureReason } from '@/lib/whatsapp/message-failures';

export interface FailureText {
  reason: FailureReason;
  /** Short, plain title ("24-hour window closed"). */
  title: string;
  /** What to do — or WhatsApp's own text when we don't recognise the error. */
  advice: string;
  /** WhatsApp's raw message, for the tooltip. */
  raw: string;
}

/** Turns a failed send (raw error + optional Meta code) into words a person can act on. */
export function useFailureText() {
  const t = useTranslations('MessageErrors');
  return useCallback(
    (rawError: string | null | undefined, code?: number | null): FailureText => {
      const raw = (rawError ?? '').replace(/^Meta API error:\s*/, '');
      const reason = failureReason(raw, code);
      return {
        reason,
        title: t(`reasons.${reason}.title`),
        advice: reason === 'other' ? raw : t(`reasons.${reason}.advice`),
        raw,
      };
    },
    [t],
  );
}
