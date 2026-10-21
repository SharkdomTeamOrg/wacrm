import { getWhatsAppConfig } from '@/lib/whatsapp/config-resolve'
import type { WhatsAppConfig as WhatsAppConfigRow } from '@/types'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { resolveTemplateRow } from '@/lib/whatsapp/template-body'
import { persistBroadcastMessage } from '@/lib/whatsapp/persist-broadcast-message'
import { isMarketingTemplate, OPTED_OUT_ERROR } from '@/lib/contacts/marketing-opt-out'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
  inbox_error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  contact_id?: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
}

export async function POST(request: Request) {
  try {
    // Requires the 'agent' role — `canSendMessages` in lib/auth/roles is
    // explicit that running broadcasts is a write operation and that
    // viewers are read-only.
    //
    // Sending and persisting broadcast messages both require the 'agent'
    // role. RLS alone is insufficient because Meta delivery cannot be
    // rolled back if the later database write is denied.
    const { supabase, accountId, userId } = await requireRole('agent')

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      // Sending number (migration 044); the account default when omitted.
      whatsapp_config_id,
      // Step 4 "Send a test": recorded in the inbox (so delivery can be
      // tracked) but never auto-retried.
      test,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const config = await getWhatsAppConfig<WhatsAppConfigRow>(
      supabase,
      accountId,
      { configId: whatsapp_config_id }
    )

    if (!config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Load the template row once so sendTemplateMessage can build
    // header + button components on each iteration. Loading inside
    // the loop would N+1 against Supabase for every recipient.
    // Guard against a malformed local row crashing every send in
    // the loop with the same opaque TypeError — fail loudly once.
    const resolvedTemplate = await resolveTemplateRow(
      supabase,
      accountId,
      template_name,
      template_language
    )
    if (resolvedTemplate.malformed) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 }
      )
    }
    const templateRow = resolvedTemplate.row

    const contactIds = [
      ...new Set(
        recipients
          .map((recipient) => recipient.contact_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ]
    const contactsById = new Set<string>()
    const optedOut = new Set<string>()
    if (contactIds.length > 0) {
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('id, marketing_opt_out_at')
        .eq('account_id', accountId)
        .in('id', contactIds)
      if (contactsError) {
        console.error(
          '[broadcast] Failed to resolve recipient contacts:',
          contactsError.message
        )
        return NextResponse.json(
          { error: 'Failed to resolve broadcast contacts' },
          { status: 500 }
        )
      }
      for (const contact of contacts ?? []) {
        contactsById.add(contact.id)
        if (contact.marketing_opt_out_at) optedOut.add(contact.id)
      }
    }
    // Opted-out contacts never get a Marketing template (migration 051).
    if (!isMarketingTemplate(templateRow)) optedOut.clear()

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      if (recipient.contact_id && !contactsById.has(recipient.contact_id)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Contact not found in this account',
        })
        failedCount++
        continue
      }

      if (recipient.contact_id && optedOut.has(recipient.contact_id)) {
        results.push({ phone: recipient.phone, status: 'failed', error: OPTED_OUT_ERROR })
        failedCount++
        continue
      }

      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: resolvedTemplate.language,
            template: templateRow ?? undefined,
            messageParams: recipient.messageParams,
            params: recipient.params ?? [],
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
          // retry with next variant
        }
      }

      if (sentMessageId) {
        let inboxError: string | undefined
        if (recipient.contact_id) {
          try {
            await persistBroadcastMessage(supabase, {
              accountId,
              userId,
              contactId: recipient.contact_id,
              whatsappConfigId: config.id,
              templateName: template_name,
              templateRow,
              templateParams: recipient.params ?? [],
              templateLanguage: resolvedTemplate.language,
              messageParams: recipient.messageParams,
              whatsappMessageId: sentMessageId,
              autoRetry: test !== true,
            })
          } catch (error) {
            inboxError =
              error instanceof Error
                ? error.message
                : 'Unknown inbox persistence error'
            console.error(
              `[broadcast] Message was sent to ${recipient.phone} but inbox persistence failed:`,
              inboxError
            )
          }
        }

        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
          ...(inboxError ? { inbox_error: inboxError } : {}),
        })
        sentCount++
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp broadcast POST:', error)
    return toErrorResponse(error)
  }
}
