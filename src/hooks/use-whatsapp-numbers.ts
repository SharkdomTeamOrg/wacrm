"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { NumberLike } from "@/lib/whatsapp/number-label";

export type WhatsAppNumber = NumberLike & { id: string; is_default: boolean };

/**
 * The account's connected WhatsApp numbers (migration 044), default first.
 * RLS scopes the rows to the caller's account; only display columns are
 * read — never the encrypted tokens.
 */
export function useWhatsAppNumbers(): WhatsAppNumber[] {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  useEffect(() => {
    let cancelled = false;
    void createClient()
      .from("whatsapp_config")
      .select("id, label, verified_name, display_phone_number, phone_number_id, is_default")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setNumbers(data as WhatsAppNumber[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return numbers;
}
