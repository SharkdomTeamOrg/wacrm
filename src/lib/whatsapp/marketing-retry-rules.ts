// Pure rules for the 131049 auto-retry (migration 050), shared by the
// server job and the inbox UI — no server imports here.

/** Meta: "not delivered to maintain healthy ecosystem engagement". */
export const MARKETING_LIMIT_ERROR = 131049
/** Meta's guidance: wait at least 24 hours before resending. */
export const RETRY_DELAY_MS = 24 * 60 * 60 * 1000

export interface RetryFields {
  content_type: string
  template_name?: string | null
  template_send?: unknown
  error_code?: number | null
  retry_status?: string | null
  retry_of?: string | null
}

/** A failed template that may be retried — once, and never a retry itself. */
export function isRetryable(m: RetryFields): boolean {
  return (
    m.content_type === 'template' &&
    !!m.template_name &&
    !!m.template_send &&
    m.error_code === MARKETING_LIMIT_ERROR &&
    !m.retry_of &&
    (m.retry_status == null || m.retry_status === 'cancelled')
  )
}
