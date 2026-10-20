// Why a WhatsApp send failed, as a reason key the UI translates into a
// plain title + what to do. Used by the broadcast report (grouped) and
// the inbox (one bubble / one toast). Pure.
//
// Recipient error_message comes in two shapes:
//   - "[131049] Title: details"  — async failure from the status webhook
//   - "(#131026) Meta message…"  — sync error from the send call
//   - plain text                  — local checks ("Invalid phone number format")

/** Reasons the UI explains; anything else falls into 'other'. */
export const FAILURE_REASONS = [
  'marketingLimit', // 131049 — Meta's per-user marketing cap
  'userStoppedMarketing', // 131050 — person turned off marketing from you
  'undeliverable', // 131026 — not on WhatsApp / can't receive
  'experiment', // 130472 — Meta marketing experiment holdout
  'missingVariable', // 131008 — a template variable was empty (e.g. no name)
  'templateProblem', // 132xxx / 131009 — template params/approval/paused/disabled
  'outsideWindow', // 131047 — 24h customer-service window closed
  'mediaProblem', // 131051 / 131052 / 131053 — file type, download or upload
  'policyBlock', // 368 / 131048 / 130497 — spam, policy or country restriction
  'metaTemporary', // 1 / 2 / 131000 / 131016 / 133004 — Meta-side hiccup
  'network', // our request never completed (offline, timeout)
  'rateLimit', // 130429 / 131056 / 80007 — sending too fast
  'invalidNumber', // local validation / 131030 / 1013
  'authExpired', // 190 — token expired or revoked
  'accountIssue', // 131031 / 131042 / 131045 — account locked, payment, cert
  'other',
] as const

export type FailureReason = (typeof FAILURE_REASONS)[number]

/** Meta error code found in either stored shape, if any. */
export function failureCode(errorMessage: string | null | undefined): number | null {
  const m = (errorMessage ?? '').match(/\[(\d{2,6})\]|\(#(\d{2,6})\)/)
  return m ? Number(m[1] ?? m[2]) : null
}

/**
 * `code` wins when the caller has it structured (messages.error_code, the
 * send route's meta_code); otherwise it's parsed out of the text.
 */
export function failureReason(
  errorMessage: string | null | undefined,
  knownCode?: number | null,
): FailureReason {
  const code = knownCode ?? failureCode(errorMessage)
  const text = (errorMessage ?? '').toLowerCase()
  if (code === 131049) return 'marketingLimit'
  if (code === 131050 || /opted out of marketing/.test(text)) return 'userStoppedMarketing'
  if (code === 131008) return 'missingVariable'
  if (code === 131026) return 'undeliverable'
  if (code === 130472) return 'experiment'
  if (code === 131009 || (code !== null && code >= 132000 && code < 133000)) return 'templateProblem'
  if (code === 131047) return 'outsideWindow'
  if (code === 131051 || code === 131052 || code === 131053) return 'mediaProblem'
  if (code === 368 || code === 131048 || code === 130497) return 'policyBlock'
  if (code === 1 || code === 2 || code === 131000 || code === 131016 || code === 133004) {
    return 'metaTemporary'
  }
  if (code === 130429 || code === 131056 || code === 80007) return 'rateLimit'
  if (code === 190 || /access token|oauth/.test(text)) return 'authExpired'
  if (code === 131031 || code === 131042 || code === 131045 || code === 133010) return 'accountIssue'
  if (code === 131030 || code === 1013 || /invalid phone|phone number format/.test(text)) {
    return 'invalidNumber'
  }
  if (code === null && /failed to fetch|networkerror|network error|load failed|timed? ?out/.test(text)) {
    return 'network'
  }
  return 'other'
}

export interface FailureGroup {
  reason: FailureReason
  count: number
  /** Distinct Meta codes seen in this group (for the "other" bucket). */
  codes: number[]
}

/** Groups, largest first; ties keep FAILURE_REASONS order. */
export function groupFailures(
  recipients: readonly { status: string; error_message?: string | null }[],
): FailureGroup[] {
  const map = new Map<FailureReason, FailureGroup>()
  for (const r of recipients) {
    if (r.status !== 'failed') continue
    const reason = failureReason(r.error_message)
    const g = map.get(reason) ?? { reason, count: 0, codes: [] }
    g.count++
    const code = failureCode(r.error_message)
    if (code !== null && !g.codes.includes(code)) g.codes.push(code)
    map.set(reason, g)
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || FAILURE_REASONS.indexOf(a.reason) - FAILURE_REASONS.indexOf(b.reason),
  )
}

/**
 * Failures where resending right away can't help — and for 131049 Meta
 * says to wait ≥24h (wacrm's auto-retry handles it), so an immediate
 * resend fails again and risks a double send once the auto-retry runs.
 * "Retry failed" on a broadcast skips these.
 */
const NO_IMMEDIATE_RETRY: ReadonlySet<FailureReason> = new Set([
  'marketingLimit',
  'userStoppedMarketing',
  'experiment',
])

export function skipOnImmediateRetry(errorMessage: string | null | undefined): boolean {
  return NO_IMMEDIATE_RETRY.has(failureReason(errorMessage))
}
