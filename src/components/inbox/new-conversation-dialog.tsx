"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TemplatePicker, type TemplateSendValues } from "./template-picker";
import { sendTemplateToContact } from "@/lib/inbox/send-template-to-contact";
import type { MessageTemplate } from "@/types";

interface ContactRow {
  id: string;
  name: string | null;
  phone: string | null;
}

/**
 * Inbox → New message: pick a contact, then a template (WhatsApp only
 * allows templates to start a conversation). The "Send from" choice is
 * preset to the number whose inbox is open, so the thread appears there.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  numberId,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inbox number currently shown (`?number=`), preselected as sender. */
  numberId: string | null;
  onSent: (conversationId: string | null) => void;
}) {
  const t = useTranslations("Inbox.newConversation");
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [contact, setContact] = useState<ContactRow | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      // RLS scopes contacts to the caller's account.
      let q = createClient().from("contacts").select("id, name, phone").order("name").limit(30);
      const term = query.trim().replace(/[%_,()]/g, "");
      if (term) q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
      const { data } = await q;
      if (!cancelled) {
        setContacts((data as ContactRow[]) ?? []);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query]);

  function close() {
    setContact(null);
    setQuery("");
    onOpenChange(false);
  }

  async function send(template: MessageTemplate, values: TemplateSendValues) {
    if (!contact) return;
    try {
      const { conversationId } = await sendTemplateToContact(contact.id, template, values);
      toast.success(t("sent", { name: contact.name || contact.phone || "" }));
      close();
      onSent(conversationId);
    } catch (err) {
      toast.error(t("failed", { reason: err instanceof Error ? err.message : "network error" }));
    }
  }

  return (
    <>
      <Dialog open={open && !contact} onOpenChange={(o) => !o && close()}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="border-border bg-muted pl-9 text-sm text-foreground"
            />
          </div>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : contacts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noContacts")}</p>
            ) : (
              contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setContact(c)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-muted"
                >
                  <span className="truncate text-sm text-foreground">{c.name || c.phone}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.phone}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        open={open && !!contact}
        onOpenChange={(o) => !o && close()}
        onSelect={send}
        chooseNumber
        initialNumberId={numberId}
      />
    </>
  );
}
