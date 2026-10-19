'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseBroadcastCsv } from '@/lib/broadcast-csv';
import { Contact, CustomField, Tag } from '@/types';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';
import {
  audienceCountries,
  PHONE_COUNTRY_FILTERS,
  type PhoneCountryFilterId,
} from '@/lib/contacts/country-filters';
import { fetchCountryContacts } from '@/lib/contacts/fetch-country-contacts';
import { toast } from 'sonner';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Globe2,
  Plus,
  FileText,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv' | 'country';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  phoneCountry?: PhoneCountryFilterId;
  phoneCountries?: PhoneCountryFilterId[];
  /** Contacts unticked in the country review list. */
  excludedContactIds?: string[];
  excludeTagIds?: string[];
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('Broadcasts.wizard');
  const canEditSettings = useCan('edit-settings');

  const OPERATOR_OPTIONS = useMemo<
    { value: CustomFieldOperator; label: string }[]
  >(
    () => [
      { value: 'is', label: t('selectAudience.operatorIs') },
      { value: 'is_not', label: t('selectAudience.operatorIsNot') },
      { value: 'contains', label: t('selectAudience.operatorContains') },
    ],
    [t]
  );

  const audienceOptions = useMemo<
    {
      type: AudienceType;
      label: string;
      description: string;
      icon: typeof Users;
    }[]
  >(
    () => [
      {
        type: 'all',
        label: t('selectAudience.method.all'),
        description: t('selectAudience.allDescLoading'),
        icon: Users,
      },
      {
        type: 'tags',
        label: t('selectAudience.method.tags'),
        description: t('selectAudience.tagDesc'),
        icon: Tags,
      },
      {
        type: 'custom_field',
        label: t('selectAudience.method.customField'),
        description: t('selectAudience.customFieldDesc'),
        icon: Filter,
      },
      {
        type: 'country',
        label: t('selectAudience.method.country'),
        description: t('selectAudience.countryDesc'),
        icon: Globe2,
      },
      {
        type: 'csv',
        label: t('selectAudience.method.csv'),
        description: t('selectAudience.csvDesc'),
        icon: Upload,
      },
    ],
    [t]
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customFieldsManagerOpen, setCustomFieldsManagerOpen] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [customFieldsLoadError, setCustomFieldsLoadError] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);

  // ---- Phone Country: several countries + a tick-list review ----------
  const selectedCountries = useMemo(() => audienceCountries(audience), [audience]);
  const [countryContacts, setCountryContacts] = useState<Contact[]>([]);
  const [loadingCountryContacts, setLoadingCountryContacts] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const excludedIds = useMemo(
    () => new Set(audience.excludedContactIds ?? []),
    [audience.excludedContactIds],
  );
  const countrySelectedCount = countryContacts.filter((c) => !excludedIds.has(c.id)).length;
  const countryKey = selectedCountries.join(',');
  const excludeTagKey = (audience.excludeTagIds ?? []).join(',');

  useEffect(() => {
    if (audience.type !== 'country' || !countryKey) {
      setCountryContacts([]);
      return;
    }
    let cancelled = false;
    setLoadingCountryContacts(true);
    fetchCountryContacts(
      createClient(),
      countryKey.split(',') as PhoneCountryFilterId[],
      excludeTagKey ? excludeTagKey.split(',') : [],
    )
      .then((rows) => {
        if (cancelled) return;
        rows.sort((a, b) => (a.name || a.phone || '').localeCompare(b.name || b.phone || ''));
        setCountryContacts(rows);
      })
      .catch((err) => {
        console.error('Failed to load country contacts:', err);
        if (!cancelled) {
          setCountryContacts([]);
          toast.error(t('selectAudience.errorEstimate'));
        }
      })
      .finally(() => !cancelled && setLoadingCountryContacts(false));
    return () => {
      cancelled = true;
    };
  }, [audience.type, countryKey, excludeTagKey, t]);

  const visibleCountryContacts = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return countryContacts;
    return countryContacts.filter(
      (c) =>
        (c.name ?? '').toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
    );
  }, [countryContacts, countrySearch]);

  function toggleCountry(country: PhoneCountryFilterId) {
    const next = selectedCountries.includes(country)
      ? selectedCountries.filter((c) => c !== country)
      : [...selectedCountries, country];
    onUpdate({ ...audience, phoneCountry: undefined, phoneCountries: next });
  }

  function setContactsTicked(ids: string[], ticked: boolean) {
    const next = new Set(excludedIds);
    for (const id of ids) {
      if (ticked) next.delete(id);
      else next.add(id);
    }
    onUpdate({ ...audience, excludedContactIds: [...next] });
  }
  const [loadingCount, setLoadingCount] = useState(false);
  // The picked file's name, shown back to the user. The parsed rows
  // themselves live on `audience.csvContacts` (owned by the wizard) so
  // they survive stepping forward and back.
  const [pickedCsvName, setPickedCsvName] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const csvCount = audience.csvContacts?.length ?? 0;
  // Only meaningful while the rows it produced are still in play —
  // picking another audience type wipes `csvContacts`.
  const csvFileName = csvCount > 0 ? pickedCsvName : null;

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  const fetchCustomFields = useCallback(async () => {
    setLoadingFields(true);
    setCustomFieldsLoadError(false);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('custom_fields')
        .select('*')
        .order('field_name');
      if (error) throw error;
      setCustomFields((data as CustomField[] | null) ?? []);
    } catch {
      setCustomFields([]);
      setCustomFieldsLoadError(true);
    } finally {
      setLoadingFields(false);
    }
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type === 'custom_field') void fetchCustomFields();
  }, [audience.type, fetchCustomFields]);

  function handleCustomFieldsManagerChange(open: boolean) {
    setCustomFieldsManagerOpen(open);
    if (!open && audience.type === 'custom_field') {
      void fetchCustomFields();
    }
  }

  const fetchEstimatedCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      const supabase = createClient();

      // Base query — produces the superset before exclude is applied.
      let baseIds: Set<string> | null = null; // null means "all contacts"

      if (audience.type === 'all') {
        // Handled below — full-table count adjusted by excludes.
      } else if (
        audience.type === 'tags' &&
        audience.tagIds &&
        audience.tagIds.length > 0
      ) {
        const { data } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.tagIds);
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (
        audience.type === 'custom_field' &&
        audience.customField?.fieldId &&
        audience.customField.value
      ) {
        const { fieldId, operator, value } = audience.customField;
        let q = supabase
          .from('contact_custom_values')
          .select('contact_id')
          .eq('custom_field_id', fieldId);
        if (operator === 'is') q = q.eq('value', value);
        else if (operator === 'is_not') q = q.neq('value', value);
        else q = q.ilike('value', `%${value}%`);
        const { data } = await q;
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (audience.type === 'country') {
        // Counted from the review list (ticked contacts) instead.
        setEstimatedCount(null);
        return;
      } else if (
        audience.type === 'csv' &&
        audience.csvContacts &&
        audience.csvContacts.length > 0
      ) {
        setEstimatedCount(audience.csvContacts.length);
        return;
      } else {
        // Partially-configured audience — wait for the user to finish.
        setEstimatedCount(null);
        return;
      }

      // Apply exclude tags
      let excludeSet: Set<string> | null = null;
      if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
        const { data: excludeRows } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.excludeTagIds);
        excludeSet = new Set((excludeRows ?? []).map((r) => r.contact_id));
      }

      if (baseIds) {
        const effective = [...baseIds].filter((id) => !excludeSet?.has(id));
        setEstimatedCount(effective.length);
      } else {
        // "All" — fetch the total, then subtract exclude set if any.
        const { count } = await supabase
          .from('contacts')
          .select('*', { count: 'exact', head: true });
        const total = count ?? 0;
        setEstimatedCount(
          excludeSet ? Math.max(0, total - excludeSet.size) : total
        );
      }
    } catch (error) {
      console.error('Failed to estimate broadcast audience:', error);
      toast.error(t('selectAudience.errorEstimate'));
      setEstimatedCount(null);
    } finally {
      setLoadingCount(false);
    }
  }, [
    t,
    audience.type,
    audience.tagIds,
    audience.customField,
    audience.csvContacts,
    audience.excludeTagIds,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  async function handleCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const result = parseBroadcastCsv(await selected.text());

    if (!result.ok) {
      toast.error(
        result.error === 'missing_phone_column'
          ? t('selectAudience.errorCsvMissingPhone')
          : t('selectAudience.errorCsvParse')
      );
      // Clear the input so re-picking the same corrected file still
      // fires `change` (the browser suppresses it for an identical value).
      e.target.value = '';
      setPickedCsvName(null);
      onUpdate({ ...audience, csvContacts: undefined });
      return;
    }

    // Rows without a leading `+` and country code were refused (issue
    // #586). Say so, or a spreadsheet export that stripped the `+` looks
    // like a mysteriously smaller audience.
    if (result.invalid > 0) {
      toast.warning(
        t('selectAudience.csvInvalidPhones', { count: result.invalid })
      );
    }

    setPickedCsvName(selected.name);
    onUpdate({ ...audience, csvContacts: result.contacts });
  }

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    (audience.type === 'country' &&
      selectedCountries.length > 0 &&
      !loadingCountryContacts &&
      countrySelectedCount > 0) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('selectAudience.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('selectAudience.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map(
          (option: {
            type: AudienceType;
            label: string;
            description: string;
            icon: typeof Users;
          }) => {
            const isSelected = audience.type === option.type;
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                onClick={() =>
                  onUpdate({
                    ...audience,
                    type: option.type,
                    // Wipe shape fields from other types to avoid stale
                    // config leaking across selections.
                    tagIds:
                      option.type === 'tags' ? audience.tagIds : undefined,
                    customField:
                      option.type === 'custom_field'
                        ? audience.customField
                        : undefined,
                    csvContacts:
                      option.type === 'csv' ? audience.csvContacts : undefined,
                    phoneCountry:
                      option.type === 'country'
                        ? audience.phoneCountry
                        : undefined,
                    phoneCountries:
                      option.type === 'country'
                        ? audience.phoneCountries
                        : undefined,
                    excludedContactIds:
                      option.type === 'country'
                        ? audience.excludedContactIds
                        : undefined,
                  })
                }
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                    : 'border-border bg-card/50 hover:border-border'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isSelected
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {option.label}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          }
        )}
      </div>

      {audience.type === 'tags' && (
        <div className="border-border bg-card/50 rounded-xl border p-4">
          <p className="text-foreground mb-3 text-sm font-medium">
            {t('selectAudience.selectTags')}
          </p>
          {loadingTags ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : tags.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.noTagsFound')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-foreground text-sm font-medium">
              {t('selectAudience.method.customField')}
            </p>
            {canEditSettings && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCustomFieldsManagerOpen(true)}
                className="border-border text-foreground shrink-0"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('selectAudience.addCustomField')}
              </Button>
            )}
          </div>
          {loadingFields ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : customFieldsLoadError ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.errorLoadFields')}
            </p>
          ) : customFields.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.noCustomFields')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                <option value="">{t('selectAudience.selectField')}</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                {OPERATOR_OPTIONS.map(
                  (op: { value: CustomFieldOperator; label: string }) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  )
                )}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder={t('selectAudience.valuePlaceholder')}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              />
            </div>
          )}
        </div>
      )}

      {audience.type === 'country' && (
        <div className="border-border bg-card/50 rounded-xl border p-4">
          <p className="text-foreground mb-3 text-sm font-medium">
            {t('selectAudience.selectCountry')}
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PHONE_COUNTRY_FILTERS) as PhoneCountryFilterId[]).map(
              (country) => {
                const isSelected = selectedCountries.includes(country);
                return (
                  <button
                    key={country}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleCountry(country)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    {t(`selectAudience.countries.${country}`)}
                  </button>
                );
              }
            )}
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            {t('selectAudience.multiCountryHint')}
          </p>

          {selectedCountries.length > 0 && (
            <div className="border-border mt-4 space-y-2 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-foreground text-sm font-medium">
                  {t('selectAudience.reviewRecipients')}
                </p>
                <span className="text-muted-foreground text-xs">
                  {t('selectAudience.selectedOfTotal', {
                    selected: countrySelectedCount,
                    total: countryContacts.length,
                  })}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {t('selectAudience.reviewRecipientsHint')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  placeholder={t('selectAudience.searchRecipients')}
                  aria-label={t('selectAudience.searchRecipients')}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={visibleCountryContacts.length === 0}
                  onClick={() => setContactsTicked(visibleCountryContacts.map((c) => c.id), true)}
                >
                  {t('selectAudience.selectAll')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={visibleCountryContacts.length === 0}
                  onClick={() => setContactsTicked(visibleCountryContacts.map((c) => c.id), false)}
                >
                  {t('selectAudience.clearAll')}
                </Button>
              </div>
              <div className="border-border max-h-80 overflow-y-auto rounded-md border">
                {loadingCountryContacts ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="text-primary h-4 w-4 animate-spin" />
                  </div>
                ) : visibleCountryContacts.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center text-xs">
                    {t('selectAudience.noCountryContacts')}
                  </p>
                ) : (
                  // ponytail: plain list, fine for a few thousand rows; virtualize if audiences grow past that
                  visibleCountryContacts.map((c) => {
                    const ticked = !excludedIds.has(c.id);
                    return (
                      <label
                        key={c.id}
                        className="hover:bg-muted/50 border-border flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={ticked}
                          onChange={(e) => setContactsTicked([c.id], e.target.checked)}
                          className="accent-primary h-4 w-4"
                        />
                        <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                          {c.name || c.phone}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs">{c.phone}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <CustomFieldsManager
        open={customFieldsManagerOpen}
        onOpenChange={handleCustomFieldsManagerChange}
      />

      {audience.type === 'csv' && (
        <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
          <div>
            <p className="text-foreground text-sm font-medium">
              {t('selectAudience.uploadCsv')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t('selectAudience.csvFormatDesc')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            className="group border-border bg-muted/40 hover:border-primary/40 hover:bg-muted/70 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors"
          >
            <div className="bg-muted text-muted-foreground group-hover:text-foreground flex h-10 w-10 items-center justify-center rounded-lg">
              {csvFileName ? (
                <FileText className="h-5 w-5" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
            </div>
            <p className="text-foreground text-sm">
              {csvFileName ?? t('selectAudience.uploadCsv')}
            </p>
            {csvCount > 0 && (
              <p className="text-primary text-xs">
                {t('selectAudience.csvContactsFound', { count: csvCount })}
              </p>
            )}
          </button>

          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvChange}
            className="hidden"
          />
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-red-400" />
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.excludeTags')}
          </p>
        </div>
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('selectAudience.noTagsFound')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-border bg-muted text-muted-foreground hover:border-border'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <p className="text-foreground mb-2 text-sm font-medium">
          {t('selectAudience.audienceSummary')}
        </p>
        {audience.type === 'country' ? (
          loadingCountryContacts ? (
            <div className="flex items-center gap-2">
              <Loader2 className="text-primary h-4 w-4 animate-spin" />
              <span className="text-muted-foreground text-xs">
                {t('selectAudience.calculating')}
              </span>
            </div>
          ) : selectedCountries.length > 0 ? (
            <div className="flex items-center gap-2">
              <Users className="text-primary h-4 w-4" />
              <span className="text-foreground text-sm">
                {countrySelectedCount.toLocaleString()}
              </span>
              <span className="text-muted-foreground text-xs">
                estimated recipients
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.selectCountry')}
            </p>
          )
        ) : loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-xs">
              {t('selectAudience.calculating')}
            </span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="text-primary h-4 w-4" />
            <span className="text-foreground text-sm">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-muted-foreground text-xs">
              estimated recipients
            </span>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Select an audience type to see the estimate.
          </p>
        )}
      </div>

      <div className="border-border flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
