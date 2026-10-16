"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CarouselPreview } from "@/components/interactive/carousel-preview";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChevronRight,
  LayoutTemplate,
  Loader2,
  Upload,
} from "lucide-react";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import { MEDIA_HEADER_SPECS, isMediaHeaderKind } from "@/lib/whatsapp/media-header-types";
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import { toast } from "sonner";
import { useWhatsAppNumbers } from "@/hooks/use-whatsapp-numbers";
import { flagForPhone, numberName } from "@/lib/whatsapp/number-label";
import { useTranslations } from "next-intl";

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  /** Media link for an image/video/document header with no saved link. */
  headerMediaUrl?: string;
  buttonParams?: Record<number, string>;
  /** Number to send from (only when the picker offers a choice). */
  whatsappConfigId?: string | null;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
  /**
   * Offer a "Send from" number choice (accounts with 2+ numbers). Only for
   * sends that may start a thread — inside a thread the number is fixed.
   */
  chooseNumber?: boolean;
  /** Preselected number; the account default when omitted. */
  initialNumberId?: string | null;
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Templates may need values for: body variables, a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  needsHeaderMedia: boolean;
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === "text" && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === "URL" && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  // Meta needs the media on every send. Templates synced from Meta only
  // carry a creation-time sample handle, not a reusable link, so the
  // agent has to supply one here or the send fails.
  const needsHeaderMedia =
    isMediaHeaderKind(template.header_type) && !template.header_media_url;
  return { bodyVars, headerVarCount, needsHeaderMedia, urlButtonSlots };
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
  chooseNumber = false,
  initialNumberId = null,
}: TemplatePickerProps) {
  const t = useTranslations("Inbox.templatePicker");
  const numbers = useWhatsAppNumbers();
  const showNumberChoice = chooseNumber && numbers.length > 1;
  // null = not touched yet → the preselected / default number.
  const [fromNumberId, setFromNumberId] = useState<string | null>(null);
  const effectiveNumberId =
    fromNumberId ??
    (numbers.some((n) => n.id === initialNumberId) ? initialNumberId : null) ??
    numbers.find((n) => n.is_default)?.id ??
    null;

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState<string>("");
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
        return;
      }

      // Scope by RLS (message_templates_select → is_account_member), NOT by
      // user_id. Templates are account-owned, so filtering on the caller's
      // user_id hid templates that a teammate created — leaving them unable
      // to send approved templates in a shared account.
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch templates:", error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function resetSelection() {
    setSelected(null);
    setParams([]);
    setHeaderText("");
    setButtonParams({});
    setHeaderMediaUrl("");
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      resetSelection();
      setFromNumberId(null);
    }
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.headerVarCount === 0 &&
      !slots.needsHeaderMedia &&
      slots.urlButtonSlots.length === 0;
    if (noInputsNeeded) {
      onSelect(template, {
        body: [],
        ...(showNumberChoice ? { whatsappConfigId: effectiveNumberId } : {}),
      });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setParams(new Array(slots.bodyVars.length).fill(""));
    setHeaderText("");
    setButtonParams({});
    setHeaderMediaUrl("");
  }

  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: params };
    if (showNumberChoice) values.whatsappConfigId = effectiveNumberId;
    if (headerText.trim()) values.headerText = headerText.trim();
    if (headerMediaUrl.trim()) values.headerMediaUrl = headerMediaUrl.trim();
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()]),
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected],
  );
  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    (!slots.needsHeaderMedia || /^https?:\/\/\S+$/.test(headerMediaUrl.trim())) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? "").trim().length > 0,
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            {selected ? selected.name : t("sendTemplate")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected
              ? t("fillPlaceholders")
              : t("pickTemplate")}
          </DialogDescription>
        </DialogHeader>

        {showNumberChoice && (
          <div className="flex items-center gap-2">
            <Label htmlFor="template-send-from" className="shrink-0 text-xs text-muted-foreground">
              {t("sendFrom")}
            </Label>
            <select
              id="template-send-from"
              value={effectiveNumberId ?? ""}
              onChange={(e) => setFromNumberId(e.target.value)}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {flagForPhone(n.display_phone_number)} {numberName(n)}
                  {n.display_phone_number ? ` (${n.display_phone_number})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                <p className="text-sm text-popover-foreground">{t("noApprovedTemplates")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("noApprovedTemplatesHint")}
                </p>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className="w-full rounded-md border border-border bg-background/50 p-3 text-left transition-colors hover:border-primary/40 hover:bg-popover"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-popover-foreground">
                          {t.name}
                        </p>
                        <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary">
                          {t.category}
                        </Badge>
                        {t.language && (
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {t.language}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {t.body_text}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-1 text-xs text-muted-foreground">{t("preview")}</p>
              {!selected.carousel_cards?.length && (
                <p className="whitespace-pre-wrap text-sm text-popover-foreground">
                  {renderBodyPreview(selected.body_text, params)}
                </p>
              )}
              {!!selected.carousel_cards?.length && (
                <CarouselPreview
                  className="mt-2"
                  body={renderBodyPreview(selected.body_text, params)}
                  cards={selected.carousel_cards}
                />
              )}
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {slots?.needsHeaderMedia && isMediaHeaderKind(selected.header_type) && (
              <div className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {t("headerMediaLabel", { kind: selected.header_type })}
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={headerMediaUrl}
                    onChange={(e) => setHeaderMediaUrl(e.target.value)}
                    placeholder="https://..."
                    className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept={MEDIA_HEADER_SPECS[selected.header_type].mimeTypes.join(",")}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setUploading(true);
                      try {
                        const { publicUrl } = await uploadAccountMedia("chat-media", file);
                        setHeaderMediaUrl(publicUrl);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : String(err));
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    aria-label={t("headerMediaUpload")}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">{t("headerMediaHint")}</p>
                {selected.header_type === "image" && headerMediaUrl.trim() && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={headerMediaUrl.trim()} alt="" className="max-h-28 rounded-md border border-border object-contain" />
                )}
              </div>
            )}
            {slots && slots.headerVarCount > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`Header {{1}}`}
                </Label>
                <Input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder={t("headerValuePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            )}
            {slots?.bodyVars.map((v, i) => (
              <div key={v} className="space-y-1">
                <Label className="text-xs text-popover-foreground">{`Body {{${v}}}`}</Label>
                <Input
                  value={params[i] ?? ""}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={t("bodyValuePlaceholder", { val: `{{${v}}}` })}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            ))}
            {slots?.urlButtonSlots.map((slot) => (
              <div key={slot.index} className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`URL button "${slot.text}" — value for `}{`{{1}}`}
                </Label>
                <Input
                  value={buttonParams[slot.index] ?? ""}
                  onChange={(e) =>
                    setButtonParams((prev) => ({
                      ...prev,
                      [slot.index]: e.target.value,
                    }))
                  }
                  placeholder={t("urlSuffixValuePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-[10px] text-muted-foreground break-all">
                  {t("finalUrl", { url: slot.url.replace(/\{\{1\}\}/g, buttonParams[slot.index] || "{{1}}") })}
                </p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("back")}
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t("send")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
