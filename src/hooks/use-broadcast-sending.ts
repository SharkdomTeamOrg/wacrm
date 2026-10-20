'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { BATCH_SEND_ATTEMPTS, batchRetryDelayMs } from '@/lib/broadcast-retry';
import { normalizeKey } from '@/lib/contacts/dedupe';
import { Contact, MessageTemplate } from '@/types';
import { toast } from 'sonner';
import {
  audienceCountries,
  type PhoneCountryFilterId,
} from '@/lib/contacts/country-filters';
import { fetchCountryContacts } from '@/lib/contacts/fetch-country-contacts';
import { isMarketingTemplate } from '@/lib/contacts/marketing-opt-out';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'country';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Legacy single-country audience (drafts saved before multi-select). */
  phoneCountry?: PhoneCountryFilterId;
  /** Countries targeted by a 'country' audience. */
  phoneCountries?: PhoneCountryFilterId[];
  /** Contacts unticked in the country review list — never sent to. */
  excludedContactIds?: string[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  // `fallback` fills the variable when the contact's value is blank —
  // Meta rejects an empty parameter (131008).
  | { type: 'field'; value: string; fallback?: string }
  | { type: 'custom_field'; value: string; fallback?: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /**
   * Media URL for an IMAGE/VIDEO/DOCUMENT header. Required at send
   * time for media-header templates — Meta rejects the send without
   * it. Passed through as `messageParams.headerMediaUrl`; the builder
   * falls back to the template's stored URL only when this is empty.
   */
  headerMediaUrl?: string;
  /** Sending number (migration 044); null = the account default. */
  whatsappConfigId?: string | null;
}

/** What step 4 shows before sending — same audience the send resolves. */
export interface PresendCheck {
  total: number;
  /** Opted out of marketing — skipped when the template is Marketing. */
  optedOut: number;
  /** Per variable with no fallback: contacts whose value is blank. */
  missing: { key: string; count: number }[];
}

export type PresendPayload = Pick<BroadcastPayload, 'template' | 'audience' | 'variables'>;

/**
 * Pure counting half of the pre-send check. Opted-out contacts are left
 * out of the missing-value counts since they won't be sent anyway.
 */
export function presendCheck(
  contacts: Contact[],
  variables: Record<string, VariableMapping>,
  customIndex: CustomValueIndex,
  marketing: boolean
): PresendCheck {
  const sendable = marketing ? contacts.filter((c) => !c.marketing_opt_out_at) : contacts;
  const missing = Object.keys(variables)
    .filter((key) => {
      const v = variables[key];
      return v.type !== 'static' && v.value && !v.fallback?.trim();
    })
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => ({
      key,
      count: sendable.filter(
        (c) => !resolveVariables({ [key]: variables[key] }, c, customIndex.get(c.id))[0]?.trim()
      ).length,
    }))
    .filter((m) => m.count > 0);
  return { total: contacts.length, optedOut: contacts.length - sendable.length, missing };
}

export type TestSendPayload = Pick<
  BroadcastPayload,
  'template' | 'variables' | 'headerMediaUrl' | 'whatsappConfigId'
>;

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  /** Count reach + would-fail/skipped contacts without sending or writing. */
  checkAudience: (payload: PresendPayload) => Promise<PresendCheck>;
  /** Send the template once to `phone`; resolves to an error message or null. */
  sendTestMessage: (payload: TestSendPayload, phone: string) => Promise<string | null>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 *
 * Note this shape when touching `RATE_LIMITS.broadcast`: a campaign is
 * many calls to `/api/whatsapp/broadcast`, not one. A 1 000-recipient
 * send is ~100 calls over several minutes, and a bucket sized for
 * "one call per campaign" throttles most of it away (issue #472).
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
  inbox_error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/** Send-time media header override, shared by real and test sends. */
function headerMessageParams(
  template: MessageTemplate,
  headerMediaUrl: string | undefined
): { headerMediaUrl: string } | undefined {
  const t = template.header_type;
  const url = headerMediaUrl?.trim();
  return (t === 'image' || t === 'video' || t === 'document') && url
    ? { headerMediaUrl: url }
    : undefined;
}

function orFallback(value: string | undefined, fallback: string | undefined): string {
  return value?.trim() ? value : (fallback?.trim() ?? '');
}

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return orFallback(fieldMap[v.value], v.fallback);
    }

    // custom_field
    return orFallback(customValues?.get(v.value), v.fallback);
  });
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
async function fetchCustomValueIndex(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[]
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
  // values. Page through to stay safe.
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);

    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // `dryRun` skips creating CSV contacts — the pre-send check must not write.
  async function resolveAudience(
    audience: AudienceConfig,
    { dryRun = false } = {}
  ): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      const { data, error } = await supabase.from('contacts').select('*');
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const { data: contactTags, error: tagError } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tagIds);

      if (tagError)
        throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      if (contactTags && contactTags.length > 0) {
        const uniqueContactIds = [
          ...new Set(contactTags.map((ct) => ct.contact_id)),
        ];
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .in('id', uniqueContactIds);
        if (error)
          throw new Error(`Failed to fetch contacts: ${error.message}`);
        contacts = data ?? [];
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(
        supabase,
        audience.customField
      );
    } else if (audience.type === 'country') {
      // Same helper the review list uses, so the ticked list is exactly
      // the set resolved here; unticked contacts are then dropped.
      const excluded = new Set(audience.excludedContactIds ?? []);
      contacts = (
        await fetchCountryContacts(
          supabase,
          audienceCountries(audience),
          audience.excludeTagIds ?? []
        )
      ).filter((c) => !excluded.has(c.id));
    } else if (audience.type === 'csv' && audience.csvContacts) {
      // ponytail: dry run treats CSV rows as new contacts, so opt-outs of
      // existing ones aren't counted until send; look them up if it matters.
      contacts = dryRun
        ? audience.csvContacts.map((c) => ({ id: '', phone: c.phone, name: c.name }) as Contact)
        : await upsertCsvContacts(supabase, audience.csvContacts);
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (
      audience.type !== 'country' &&
      audience.excludeTagIds &&
      audience.excludeTagIds.length > 0
    ) {
      const { data: excludeRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.excludeTagIds);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   *
   * Matching is on the normalized number throughout, so it agrees with
   * the account-wide unique index rather than colliding with it.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[]
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    // De-duplicate within the CSV on the NORMALIZED number — the same
    // key the DB's UNIQUE (account_id, phone_normalized) index uses
    // (migration 022). Keyed on the raw string instead, "+1 555-0100"
    // and "15550100" survived as two rows and the insert below died on
    // a 23505, failing the whole broadcast.
    const uniqueByKey = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      const key = normalizeKey(row.phone);
      if (key && !uniqueByKey.has(key)) uniqueByKey.set(key, row);
    }
    const keys = [...uniqueByKey.keys()];

    // Single round-trip lookup of the contacts already in this ACCOUNT.
    // Scoping to `user_id` missed rows a teammate created on a shared
    // account, so those numbers looked new and their inserts collided
    // with the account-wide unique index.
    const { data: existing, error: lookupErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .in('phone_normalized', keys);
    if (lookupErr) {
      throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
    }

    const byKey = new Map<string, Contact>();
    for (const c of (existing ?? []) as Contact[]) {
      const key = normalizeKey(c.phone ?? '');
      if (key) byKey.set(key, c);
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = keys
      .filter((k) => !byKey.has(k))
      .map((k) => uniqueByKey.get(k)!)
      .map((row) => ({
        user_id: user.id,
        account_id: accountId,
        phone: row.phone,
        name: row.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        const key = normalizeKey(c.phone ?? '');
        if (key) byKey.set(key, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return keys
      .map((k) => byKey.get(k))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);

    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains')
      query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', contactIds);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  async function createAndSendBroadcast(
    payload: BroadcastPayload
  ): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      // broadcasts.user_id is NOT NULL + guarded by RLS
      // (auth.uid() = user_id). Without this, the INSERT below was
      // silently failing with 23502 / 42501 — the wizard would
      // no-op with no feedback.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error('You are not signed in.');
      }
      if (!accountId) {
        throw new Error('Your profile is not linked to an account.');
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          whatsapp_config_id: payload.whatsappConfigId ?? null,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            phoneCountries: audienceCountries(payload.audience),
            excludedContactIds: payload.audience.excludedContactIds,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          status: 'sending',
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`
        );
      }

      // ── Step 3: Insert recipient rows ─────────────────────────────
      // Custom values are fetched BEFORE the insert so each row can
      // carry its resolved template params. Those params are what makes
      // the campaign resumable server-side (issue #472): the send loop
      // below runs in this browser tab, and if the tab goes away the
      // only record of what {{1}} should be for each contact is this
      // column. Resolving once here also means the resume sends exactly
      // what this pass would have.
      setProgress(20);
      const customValueIndex = await fetchCustomValueIndex(
        supabase,
        contacts.map((c) => c.id)
      );
      const paramsByContact = new Map(
        contacts.map((contact) => [
          contact.id,
          resolveVariables(
            payload.variables,
            contact,
            customValueIndex.get(contact.id)
          ),
        ])
      );
      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
        template_params: paramsByContact.get(contact.id) ?? [],
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop.
          await supabase
            .from('broadcasts')
            .update({
              status: 'failed',
              failed_count: contacts.length,
            })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`
          );
        }
      }

      // ── Step 4: Fetch recipients back (joined contact) ────────────
      setProgress(30);
      const { data: recipients, error: recipientsFetchError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcast.id);

      if (recipientsFetchError || !recipients) {
        throw new Error('Failed to fetch broadcast recipients');
      }

      let failedCount = 0;
      const totalRecipients = recipients.length;
      let inboxSyncFailures = 0;

      // Media-header templates (image/video/document) require a media
      // URL on every send. Collected in the personalize step and applied
      // to all recipients; falls back to the template's stored URL on the
      // server when omitted.
      const messageParams = headerMessageParams(payload.template, payload.headerMediaUrl);

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r) => r.contact?.phone)
          .map((r) => ({
            phone: r.contact!.phone as string,
            contact_id: r.contact!.id,
            // Read back off the row rather than re-resolved, so this
            // pass and any later resume send identical params.
            params: Array.isArray(r.template_params) ? r.template_params : [],
            ...(messageParams ? { messageParams } : {}),
          }));

        if (apiRecipients.length === 0) continue;

        try {
          // Send the batch, waiting out a 429 rather than writing the
          // whole batch off as failed. Only 429 is replayed — see
          // batchRetryDelayMs for why nothing else can be.
          let data: { error?: string; results?: BroadcastApiResult[] } = {};
          for (let attempt = 1; ; attempt++) {
            const res = await fetch('/api/whatsapp/broadcast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipients: apiRecipients,
                template_name: payload.template.name,
                template_language: payload.template.language ?? 'en_US',
                whatsapp_config_id: payload.whatsappConfigId ?? null,
              }),
            });

            data = await res.json();
            if (res.ok) break;

            const retryIn =
              attempt < BATCH_SEND_ATTEMPTS
                ? batchRetryDelayMs(res.status, res.headers.get('Retry-After'))
                : null;
            if (retryIn === null) {
              throw new Error(data.error || 'Broadcast API request failed');
            }
            await sleep(retryIn);
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          for (const recipient of batch) {
            const phone = recipient.contact?.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              await supabase
                .from('broadcast_recipients')
                .update({
                  status: 'failed',
                  error_message: 'No phone number on contact',
                })
                .eq('id', recipient.id);
              continue;
            }

            if (result.status === 'sent') {
              await supabase
                .from('broadcast_recipients')
                .update({
                  status: 'sent',
                  sent_at: new Date().toISOString(),
                  whatsapp_message_id: result.whatsapp_message_id ?? null,
                  error_message: result.inbox_error ?? null,
                })
                .eq('id', recipient.id);
              if (result.inbox_error) inboxSyncFailures++;
            } else {
              failedCount++;
              await supabase
                .from('broadcast_recipients')
                .update({
                  status: 'failed',
                  error_message: result.error ?? 'Unknown error',
                })
                .eq('id', recipient.id);
            }
          }
        } catch (err) {
          for (const recipient of batch) {
            failedCount++;
            await supabase
              .from('broadcast_recipients')
              .update({
                status: 'failed',
                error_message:
                  err instanceof Error ? err.message : 'Unknown error',
              })
              .eq('id', recipient.id);
          }
        }

        const progressPct =
          30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      // ── Step 5: Finalize status ───────────────────────────────────
      // Aggregate counts are maintained by the DB trigger (migration
      // 003); we only flip the final status here.
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      await supabase
        .from('broadcasts')
        .update({ status: finalStatus })
        .eq('id', broadcast.id);

      if (inboxSyncFailures > 0) {
        toast.error(
          `${inboxSyncFailures} message${inboxSyncFailures === 1 ? '' : 's'} sent successfully but could not be added to the Inbox. Check the recipient error details.`
        );
      }

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  /**
   * One real send of the template to a test phone, through the same
   * route as the campaign. Variables resolve against the contact with
   * that number when there is one, else a blank contact — so missing
   * values and fallbacks show up exactly as recipients would see them.
   * No broadcast row is created; no contact means no inbox entry.
   */
  async function sendTestMessage(payload: TestSendPayload, phone: string): Promise<string | null> {
    const digits = phone.replace(/\D/g, '');
    if (!digits) return 'Enter a phone number with country code';
    const supabase = createClient();
    const { data: match } = await supabase
      .from('contacts')
      .select('*')
      .eq('phone_normalized', digits)
      .maybeSingle();
    const contact = (match as Contact | null) ?? ({ id: '', phone: `+${digits}` } as Contact);
    const customValues = match
      ? (await fetchCustomValueIndex(supabase, [match.id])).get(match.id)
      : undefined;
    const messageParams = headerMessageParams(payload.template, payload.headerMediaUrl);

    const res = await fetch('/api/whatsapp/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipients: [
          {
            phone: `+${digits}`,
            params: resolveVariables(payload.variables, contact, customValues),
            ...(messageParams ? { messageParams } : {}),
          },
        ],
        template_name: payload.template.name,
        template_language: payload.template.language ?? 'en_US',
        whatsapp_config_id: payload.whatsappConfigId ?? null,
      }),
    });
    const data: { error?: string; results?: BroadcastApiResult[] } = await res
      .json()
      .catch(() => ({}));
    if (!res.ok) return data.error || `Test send failed (HTTP ${res.status})`;
    const result = data.results?.[0];
    return result?.status === 'sent' ? null : result?.error || 'Test send failed';
  }

  async function checkAudience(payload: PresendPayload): Promise<PresendCheck> {
    const contacts = await resolveAudience(payload.audience, { dryRun: true });
    const needsCustom = Object.values(payload.variables).some(
      (v) => v.type === 'custom_field' && !v.fallback?.trim()
    );
    const customIndex = needsCustom
      ? await fetchCustomValueIndex(
          createClient(),
          contacts.map((c) => c.id).filter(Boolean)
        )
      : new Map();
    return presendCheck(
      contacts,
      payload.variables,
      customIndex,
      isMarketingTemplate(payload.template)
    );
  }

  return { createAndSendBroadcast, checkAudience, sendTestMessage, isProcessing, progress };
}
