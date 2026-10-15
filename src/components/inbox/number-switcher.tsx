"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useWhatsAppNumbers } from "@/hooks/use-whatsapp-numbers";
import { flagForPhone, numberName } from "@/lib/whatsapp/number-label";

/**
 * Sidebar picker for which WhatsApp number's inbox to show (`?number=<id>`
 * on /inbox). Hidden for accounts with a single number. Must sit inside a
 * <Suspense> — it reads search params from the layout.
 */
export function InboxNumberSwitcher() {
  const t = useTranslations("Sidebar");
  const numbers = useWhatsAppNumbers();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (numbers.length < 2) return null;

  const current = pathname.startsWith("/inbox") ? (params.get("number") ?? "") : "";

  return (
    <select
      aria-label={t("inboxNumber")}
      value={current}
      onChange={(e) =>
        router.push(e.target.value ? `/inbox?number=${e.target.value}` : "/inbox")
      }
      className="mt-1 ml-7 w-[calc(100%-1.75rem)] rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    >
      <option value="">🌐 {t("allNumbers")}</option>
      {numbers.map((n) => (
        <option key={n.id} value={n.id}>
          {flagForPhone(n.display_phone_number)} {numberName(n)}
        </option>
      ))}
    </select>
  );
}
