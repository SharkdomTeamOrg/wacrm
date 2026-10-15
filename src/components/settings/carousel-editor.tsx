'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CarouselCard, TemplateButton } from '@/types';
import { TEMPLATE_LIMITS } from '@/lib/whatsapp/template-validators';
import type { TemplateFormData } from './template-manager';

export type CardButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

const ITEM_CLS = 'text-popover-foreground focus:bg-muted focus:text-popover-foreground';
const INPUT_CLS =
  'bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs';

interface Props {
  form: TemplateFormData;
  setForm: Dispatch<SetStateAction<TemplateFormData>>;
  updateCard: (index: number, patch: Partial<CarouselCard>) => void;
  setCardButtonTypes: (types: CardButtonType[]) => void;
  addCard: () => void;
  uploadingCard: number | null;
  onPickFile: (cardIndex: number) => void;
}

/**
 * Card editor for media-card carousel templates. Media type and button
 * layout are chosen once and apply to every card (Meta requires all
 * cards to match); each card then fills in its own media, text and
 * button labels / links.
 */
export function CarouselEditor({
  form,
  setForm,
  updateCard,
  setCardButtonTypes,
  addCard,
  uploadingCard,
  onPickFile,
}: Props) {
  const t = useTranslations('Settings.templates');
  const btnLabel = (type: TemplateButton['type']) =>
    type === 'QUICK_REPLY' ? t('btnQuickReply') : type === 'URL' ? t('btnUrl') : t('btnPhone');

  function patchButton(ci: number, bi: number, patch: Partial<Record<'text' | 'url' | 'phone_number', string>>) {
    const card = form.cards[ci];
    updateCard(ci, {
      // Spread keeps the discriminant; only fields valid for the slot's
      // type are ever rendered, so only those reach the patch.
      buttons: card.buttons.map((b, i) => (i === bi ? ({ ...b, ...patch } as TemplateButton) : b)),
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-muted-foreground">{t('cardMediaType')}</Label>
          <Select
            value={form.card_header_type}
            onValueChange={(val) => {
              if (!val) return;
              const header_type = val as CarouselCard['header_type'];
              // A new media type invalidates every uploaded file.
              setForm((prev) => ({
                ...prev,
                card_header_type: header_type,
                cards: prev.cards.map((c) => ({ ...c, header_type, header_media_url: '' })),
              }));
            }}
          >
            <SelectTrigger aria-label={t('cardMediaType')} className="w-full bg-muted border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="image" className={ITEM_CLS}>
                {t('headerImage')}
              </SelectItem>
              <SelectItem value="video" className={ITEM_CLS}>
                {t('headerVideo')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">{t('cardButtonsLayout')}</Label>
          {form.card_button_types.map((type, bi) => (
            <div key={bi} className="flex items-center gap-2">
              <Select
                value={type}
                onValueChange={(val) => {
                  if (!val) return;
                  const next = [...form.card_button_types];
                  next[bi] = val as CardButtonType;
                  setCardButtonTypes(next);
                }}
              >
                <SelectTrigger
                  aria-label={`${t('cardButtonsLayout')} ${bi + 1}`}
                  className="flex-1 bg-muted border-border text-foreground h-8 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] as const).map((bt) => (
                    <SelectItem key={bt} value={bt} className={ITEM_CLS}>
                      {btnLabel(bt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={form.card_button_types.length <= 1}
                onClick={() => setCardButtonTypes(form.card_button_types.filter((_, i) => i !== bi))}
                className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 size-7"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          {form.card_button_types.length < TEMPLATE_LIMITS.carouselMaxButtonsPerCard && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCardButtonTypes([...form.card_button_types, 'URL'])}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted h-7 text-xs"
            >
              <Plus className="size-3" />
              {t('addCardButton')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground">
          {t('cards')} ({form.cards.length}/{TEMPLATE_LIMITS.carouselMaxCards})
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={form.cards.length >= TEMPLATE_LIMITS.carouselMaxCards}
          onClick={addCard}
          className="border-border bg-transparent text-muted-foreground hover:bg-muted h-7 text-xs"
        >
          <Plus className="size-3" />
          {t('addCard')}
        </Button>
      </div>

      <div className="flex snap-x gap-3 overflow-x-auto pb-2">
        {form.cards.map((card, ci) => (
          <div
            key={ci}
            className="w-64 shrink-0 snap-start space-y-2 rounded border border-border bg-muted/50 p-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{t('cardTitle', { n: ci + 1 })}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('removeCard')}
                disabled={form.cards.length <= TEMPLATE_LIMITS.carouselMinCards}
                onClick={() =>
                  setForm((prev) => ({ ...prev, cards: prev.cards.filter((_, i) => i !== ci) }))
                }
                className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 size-7"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            {card.header_media_url &&
              (form.card_header_type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.header_media_url}
                  alt={t('cardTitle', { n: ci + 1 })}
                  className="h-28 w-full rounded-md border border-border object-cover"
                />
              ) : (
                <video
                  src={card.header_media_url}
                  muted
                  className="h-28 w-full rounded-md border border-border object-cover"
                />
              ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={uploadingCard !== null}
              onClick={() => onPickFile(ci)}
            >
              {uploadingCard === ci ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {t(form.card_header_type === 'image' ? 'uploadImage' : 'uploadVideo')}
            </Button>
            <Input
              placeholder={t('mediaUrlPlaceholder', { format: form.card_header_type })}
              value={card.header_media_url ?? ''}
              onChange={(e) => updateCard(ci, { header_media_url: e.target.value })}
              className={INPUT_CLS}
            />
            <Textarea
              placeholder={t('cardBodyPlaceholder')}
              value={card.body_text}
              maxLength={TEMPLATE_LIMITS.carouselCardBodyMaxLength}
              rows={3}
              onChange={(e) => updateCard(ci, { body_text: e.target.value })}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground resize-none text-xs"
            />

            {card.buttons.map((btn, bi) => (
              <div key={bi} className="space-y-1">
                <Input
                  placeholder={`${t('btnLabelPlaceholder')} (${btnLabel(btn.type)})`}
                  value={btn.text}
                  maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                  onChange={(e) => patchButton(ci, bi, { text: e.target.value })}
                  className={INPUT_CLS}
                />
                {btn.type === 'URL' && (
                  <Input
                    placeholder={t('cardUrlPlaceholder')}
                    value={btn.url}
                    onChange={(e) => patchButton(ci, bi, { url: e.target.value })}
                    className={INPUT_CLS}
                  />
                )}
                {btn.type === 'PHONE_NUMBER' && (
                  <Input
                    placeholder={t('phonePlaceholder')}
                    value={btn.phone_number}
                    onChange={(e) => patchButton(ci, bi, { phone_number: e.target.value })}
                    className={INPUT_CLS}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
