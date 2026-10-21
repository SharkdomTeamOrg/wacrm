"use client";

import { useRef, useState } from "react";
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  ImageIcon,
  Phone,
  Reply,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { waSegments } from "@/lib/whatsapp/wa-format";
import type { CarouselCard, TemplateButton } from "@/types";

/** Text with WhatsApp's *bold* / _italic_ / ~strike~ / ```mono``` applied. */
function WaText({ text }: { text: string }) {
  return (
    <>
      {waSegments(text).map((s, i) => (
        <span
          key={i}
          className={cn(
            s.bold && "font-semibold",
            s.italic && "italic",
            s.strike && "line-through",
            s.mono && "font-mono text-[12px]",
          )}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}

export interface PreviewHeader {
  format: "text" | "image" | "video" | "document";
  text?: string;
  mediaUrl?: string;
}

/** Replace {{N}} with the matching sample value, leaving unknown ones as-is. */
export function fillSamples(text: string, samples: string[] | undefined): string {
  return text.replace(/\{\{(\d+)\}\}/g, (m, n) => samples?.[Number(n) - 1]?.trim() || m);
}

const CARD_W = 220;
const GAP = 8;

/**
 * WhatsApp-style phone mock of a template — standard (header, body,
 * footer, buttons) or a media-card carousel — used live in the template
 * editor and in send previews. Interactive the way the customer's phone
 * is: swipe or use the arrows/dots, URL buttons open the real link (so
 * admins can check it), phone buttons dial, and quick replies drop the
 * customer's reply into the chat. Text is formatted like WhatsApp does.
 */
export function CarouselPreview({
  body,
  cards = [],
  header,
  footer,
  buttons = [],
  businessName,
  className,
}: {
  body: string;
  cards?: CarouselCard[];
  header?: PreviewHeader;
  footer?: string;
  buttons?: TemplateButton[];
  businessName?: string;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [replies, setReplies] = useState<string[]>([]);
  // Server and client clocks differ — the time <p>s suppress that warning.
  const [time] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  );

  const goTo = (i: number) => {
    const target = Math.max(0, Math.min(cards.length - 1, i));
    rowRef.current?.scrollTo({ left: target * (CARD_W + GAP), behavior: "smooth" });
  };

  const buttonEl = (b: TemplateButton, key: number) => {
    const cls =
      "flex w-full items-center justify-center gap-1.5 border-t border-black/10 py-1.5 text-xs font-medium text-[#53bdeb] hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5";
    const label = <span className="truncate">{b.text || "Button"}</span>;
    if (b.type === "URL" && /^https?:\/\//.test(b.url ?? "")) {
      return (
        <a key={key} href={b.url} target="_blank" rel="noopener noreferrer" className={cls} title={b.url}>
          <ExternalLink className="h-3 w-3" />
          {label}
        </a>
      );
    }
    if (b.type === "PHONE_NUMBER" && b.phone_number) {
      return (
        <a key={key} href={`tel:${b.phone_number}`} className={cls} title={b.phone_number}>
          <Phone className="h-3 w-3" />
          {label}
        </a>
      );
    }
    return (
      <button
        key={key}
        type="button"
        className={cls}
        onClick={() => b.text && setReplies((r) => [...r, b.text].slice(-3))}
      >
        {b.type === "URL" ? <ExternalLink className="h-3 w-3" /> : <Reply className="h-3 w-3" />}
        {label}
      </button>
    );
  };

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[300px] overflow-hidden rounded-[2rem] border-[6px] border-neutral-800 bg-neutral-800 shadow-xl",
        className,
      )}
    >
      {/* Chat header */}
      <div className="flex items-center gap-2 bg-[#202c33] px-3 py-2 text-white">
        <ChevronLeft className="h-4 w-4 opacity-70" />
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#00a884] text-xs font-semibold">
          {(businessName || "B").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-tight">{businessName || "Your business"}</p>
          <p className="text-[10px] leading-tight opacity-60">Business account</p>
        </div>
      </div>

      {/* Chat body */}
      <div className="space-y-2 bg-[#efeae2] px-2 py-3 dark:bg-[#0b141a]">
        <div className="max-w-[85%] overflow-hidden rounded-lg rounded-tl-none bg-white shadow-sm dark:bg-[#202c33]">
          {header?.format === "image" || header?.format === "video" ? (
            <div className="p-1 pb-0">
              {header.mediaUrl ? (
                header.format === "video" ? (
                  <video src={header.mediaUrl} muted controls className="aspect-[1.91/1] w-full rounded bg-black object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={header.mediaUrl} alt="" className="aspect-[1.91/1] w-full rounded bg-neutral-200 object-cover" />
                )
              ) : (
                <div className="flex aspect-[1.91/1] w-full items-center justify-center rounded bg-neutral-200 dark:bg-neutral-700">
                  <ImageIcon className="h-6 w-6 text-neutral-400" />
                </div>
              )}
            </div>
          ) : header?.format === "document" ? (
            <div className="m-1 mb-0 flex items-center gap-2 rounded bg-neutral-100 px-2 py-2 text-xs text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">Document</span>
            </div>
          ) : null}
          <div className="px-2.5 py-1.5">
            {header?.format === "text" && header.text && (
              <p className="mb-1 break-words text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                {header.text}
              </p>
            )}
            <p className="whitespace-pre-wrap break-words text-[13px] text-neutral-900 dark:text-neutral-100">
              {body ? <WaText text={body} /> : <span className="opacity-50">Message body…</span>}
            </p>
            {footer && <p className="mt-1 break-words text-[11px] text-neutral-500">{footer}</p>}
            <p suppressHydrationWarning className="mt-0.5 text-right text-[10px] text-neutral-500">{time}</p>
          </div>
          {buttons.map(buttonEl)}
        </div>

        {cards.length > 0 && (
        <div className="relative">
          <div
            ref={rowRef}
            onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / (CARD_W + GAP)))}
            className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ gap: GAP }}
          >
            {cards.map((card, i) => (
              <div
                key={i}
                style={{ width: CARD_W }}
                className="shrink-0 snap-start overflow-hidden rounded-lg bg-white shadow-sm dark:bg-[#202c33]"
              >
                {card.header_media_url ? (
                  card.header_type === "video" ? (
                    <video src={card.header_media_url} muted controls className="aspect-[1.91/1] w-full bg-black object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.header_media_url} alt="" className="aspect-[1.91/1] w-full bg-neutral-200 object-cover" />
                  )
                ) : (
                  <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-neutral-200 dark:bg-neutral-700">
                    <ImageIcon className="h-6 w-6 text-neutral-400" />
                  </div>
                )}
                <p className="min-h-10 whitespace-pre-wrap break-words px-2.5 py-2 text-xs text-neutral-900 dark:text-neutral-100">
                  {card.body_text ? <WaText text={card.body_text} /> : <span className="opacity-50">Card text…</span>}
                </p>
                {card.buttons.map(buttonEl)}
              </div>
            ))}
          </div>

          {cards.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous card"
                onClick={() => goTo(active - 1)}
                disabled={active === 0}
                className="absolute left-1 top-[22%] rounded-full bg-black/50 p-1 text-white disabled:opacity-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Next card"
                onClick={() => goTo(active + 1)}
                disabled={active >= cards.length - 1}
                className="absolute right-1 top-[22%] rounded-full bg-black/50 p-1 text-white disabled:opacity-0"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        )}

        {cards.length > 1 && (
          <div className="flex justify-center gap-1">
            {cards.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Card ${i + 1}`}
                onClick={() => goTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === active ? "w-4 bg-[#00a884]" : "w-1.5 bg-neutral-400",
                )}
              />
            ))}
          </div>
        )}

        {replies.map((r, i) => (
          <div
            key={i}
            className="ml-auto w-fit max-w-[75%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 shadow-sm dark:bg-[#005c4b]"
          >
            <p className="text-[13px] text-neutral-900 dark:text-neutral-100">{r}</p>
            <p suppressHydrationWarning className="flex items-center justify-end gap-0.5 text-[10px] text-neutral-500">
              {time}
              <CheckCheck className="h-3 w-3 text-[#53bdeb]" />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
