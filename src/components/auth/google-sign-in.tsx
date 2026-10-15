"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Google sign-in is opt-in per deployment: it needs the Google provider
 * enabled in Supabase (Authentication → Providers → Google, with a Google
 * Cloud OAuth client). Until NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true the
 * button isn't rendered, so nobody hits a "provider not enabled" error.
 */
export const GOOGLE_AUTH_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

export function GoogleSignInButton({
  next,
  label,
  dividerLabel,
}: {
  /** Same-origin path to land on after sign-in (validated by /auth/callback). */
  next: string;
  label: string;
  dividerLabel: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!GOOGLE_AUTH_ENABLED) return null;

  async function signIn() {
    setLoading(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      // Same return path as the emailed links: /auth/callback exchanges
      // the PKCE code for a session, then forwards to `next`.
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // On success the browser is already navigating to Google.
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {dividerLabel}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={signIn}
        disabled={loading}
        className="h-10 w-full border-border text-foreground hover:bg-muted"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6c-.3 1.4-1.1 2.6-2.3 3.4v2.8h3.7c2.1-2 3.2-4.9 3.2-8.3z" />
          <path fill="#34A853" d="M12 23c3.1 0 5.6-1 7.5-2.8l-3.7-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H1.9v2.9C3.7 20.5 7.6 23 12 23z" />
          <path fill="#FBBC05" d="M5.7 13.9c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.6H1.9C1.1 8.2.7 10 .7 11.8s.4 3.6 1.2 5.2l3.8-3.1z" />
          <path fill="#EA4335" d="M12 5.1c1.6 0 3.1.6 4.3 1.7l3.2-3.2C17.6 1.8 15 .7 12 .7 7.6.7 3.7 3.2 1.9 6.6l3.8 2.9C6.6 7 9.1 5.1 12 5.1z" />
        </svg>
        {label}
      </Button>
      {error && <p className="text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}
