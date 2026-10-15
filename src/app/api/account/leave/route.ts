import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

/**
 * POST /api/account/leave — the caller leaves their shared account and
 * moves into a fresh personal one (migration 045). Any member except
 * the owner; the RPC enforces that.
 */
export async function POST() {
  try {
    const ctx = await requireRole("viewer");
    const { data, error } = await ctx.supabase.rpc("leave_account");
    if (error) {
      const status = error.code === "22023" ? 400 : error.code === "42501" ? 403 : 500;
      if (status === 500) console.error("[POST /api/account/leave] RPC error:", error);
      return NextResponse.json(
        { error: status === 500 ? "Failed to leave the account" : error.message },
        { status },
      );
    }
    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
