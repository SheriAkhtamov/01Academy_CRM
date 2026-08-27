import { useEffect, useMemo, useState } from 'react';
import {
  GraduationCap,
  MessageCircle,
  MessageSquare,
  Phone,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FilterField,
  FilterMultiSelect,
  FilterPresetButton,
  FilterRangeField,
  FilterSection,
  FilterSwitchRow,
  FilterTriStateRow,
  type FilterOption,
} from '@/components/ux/lead/LeadFilterControls';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { formatCurrencyInput } from '@/lib/inputFormatters';
import { formatAcademyDate } from '@/lib/localeFormat';
import { reportingRangeForPreset } from '@/lib/reportingDateRange';
import {
  EMPTY_LEAD_FILTERS,
  LEAD_FILTER_LANGUAGES,
  countActiveLeadFilters,
  leadMatchesFilters,
  type FilterableLead,
  type LeadFilterState,
  type LeadFilterTriState,
} from '@/lib/leadFilters';

export interface LeadFilterSource {
  id: number;
  name: string;
  channel?: string | null;
}

export interface LeadFilterManager {
  id: number;
  fullName: string;
}

interface LeadFiltersDialogProps {
  filters: LeadFilterState;
  onApply: (filters: LeadFilterState) => void;
  sources: LeadFilterSource[];
  managers: LeadFilterManager[];
  leads: FilterableLead[];
}

const LANGUAGE_LABEL_KEYS: Record<string, TranslationKey> = {
  ru: 'russian',
  uz: 'uzbekLang',
  en: 'english',
};

/** The manager list carries one option that is not a manager. */
const UNASSIGNED = 'unassigned';
type ManagerOptionId = number | typeof UNASSIGNED;

const DATE_PRESETS = [
  { preset: 'today', labelKey: 'today' },
  { preset: 'last7', labelKey: 'reportingLast7Days' },
  { preset: 'last30', labelKey: 'reportingLast30Days' },
] as const satisfies ReadonlyArray<{
  preset: 'today' | 'last7' | 'last30';
  labelKey: TranslationKey;
}>;

/** One condition the draft is asking for, in the words the user chose it by. */
interface ActiveCondition {
  key: string;
  label: string;
  clear: Partial<LeadFilterState>;
}

const bumpCount = <K,>(counts: Map<K, number>, key: K) => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const leadLanguage = (lead: FilterableLead) => String(lead.language ?? '').trim().toLowerCase();

export function LeadFiltersDialog({ filters, onApply, sources, managers, leads }: LeadFiltersDialogProps) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);

  // Reopening must start from what is actually applied, not from an abandoned draft.
  useEffect(() => {
    if (open) setDraft(filters);
  }, [filters, open]);

  const activeCount = countActiveLeadFilters(filters);
  const draftCount = countActiveLeadFilters(draft);
  const draftMatches = useMemo(
    () => leads.reduce((count, lead) => count + (leadMatchesFilters(lead, draft) ? 1 : 0), 0),
    [draft, leads],
  );

  /*
    Each option carries how many leads sit behind it, so a filter that would
    empty the board can be recognised before it is applied. The counts describe
    the whole board rather than the current draft: a number that moved every
    time another filter was touched would be read as a bug, not as a hint.
  */
  const counts = useMemo(() => {
    const bySource = new Map<number, number>();
    const byManager = new Map<ManagerOptionId, number>();
    const byTag = new Map<number, number>();
    const byLanguage = new Map<string, number>();

    leads.forEach((lead) => {
      if (lead.sourceId !== null && lead.sourceId !== undefined) bumpCount(bySource, Number(lead.sourceId));
      bumpCount(
        byManager,
        lead.managerId === null || lead.managerId === undefined ? UNASSIGNED : Number(lead.managerId),
      );
      const code = leadLanguage(lead);
      if (code !== '') bumpCount(byLanguage, code);
      // `id` belongs to the lead/tag assignment and is different for every lead.
      // `tagId` identifies the shared catalog entry and is the stable filter key.
      new Set((lead.tags ?? []).map((tag) => tag.tagId)).forEach((tagId) => bumpCount(byTag, tagId));
    });

    return { bySource, byManager, byTag, byLanguage };
  }, [leads]);

  const sourceOptions = useMemo<Array<FilterOption<number>>>(
    () => sources.map((source) => ({
      id: source.id,
      label: source.name,
      count: counts.bySource.get(source.id) ?? 0,
    })),
    [counts, sources],
  );

  const managerOptions = useMemo<Array<FilterOption<ManagerOptionId>>>(
    () => [
      { id: UNASSIGNED, label: t('notAssigned'), count: counts.byManager.get(UNASSIGNED) ?? 0 },
      ...[...managers]
        .sort((left, right) => left.fullName.localeCompare(right.fullName))
        .map((manager) => ({
          id: manager.id,
          label: manager.fullName,
          count: counts.byManager.get(manager.id) ?? 0,
        })),
    ],
    [counts, managers, t],
  );

  const languageOptions = useMemo<Array<FilterOption<string>>>(
    () => LEAD_FILTER_LANGUAGES.map((code) => ({
      id: code,
      label: t(LANGUAGE_LABEL_KEYS[code]),
      count: counts.byLanguage.get(code) ?? 0,
    })),
    [counts, t],
  );

  // Only tags that leads actually carry are worth offering as a filter.
  const tagOptions = useMemo<Array<FilterOption<number>>>(() => {
    const byId = new Map<number, string>();
    leads.forEach((lead) => (lead.tags ?? []).forEach((tag) => byId.set(tag.tagId, tag.name)));
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label, count: counts.byTag.get(id) ?? 0 }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [counts, leads]);

  const update = <K extends keyof LeadFilterState>(key: K, value: LeadFilterState[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const triStateOptions = [
    { value: 'any', label: t('leadFilterAny') },
    { value: 'yes', label: t('yes') },
    { value: 'no', label: t('no') },
  ];

  const selectedManagerIds: ManagerOptionId[] = [
    ...(draft.includeUnassignedManager ? [UNASSIGNED as ManagerOptionId] : []),
    ...draft.managerIds,
  ];

  const applyManagerSelection = (next: ManagerOptionId[]) => {
    setDraft((current) => ({
      ...current,
      includeUnassignedManager: next.includes(UNASSIGNED),
      managerIds: next.filter((id): id is number => id !== UNASSIGNED),
    }));
  };

  const summarize = (options: Array<FilterOption<never>> | Array<{ label: string }>) => {
    const labels = options.map((option) => option.label);
    if (labels.length <= 1) return labels.join('');
    return `${labels[0]} +${labels.length - 1}`;
  };

  const describeRange = (from: string, to: string, format: (value: string) => string) => {
    if (from && to) return `${format(from)} — ${format(to)}`;
    if (from) return `${t('leadFilterFrom')} ${format(from)}`;
    return `${t('leadFilterTo')} ${format(to)}`;
  };

  const triStateWord = (value: LeadFilterTriState) => (value === 'yes' ? t('yes') : t('no'));

  /*
    A count on the trigger button says three conditions are on but not which
    ones, which is the single most common complaint about filter panels. Every
    condition is spelled out here instead, and each one can be lifted on its own
    without hunting for the control that set it.
  */
  const describeConditions = (): ActiveCondition[] => {
    const conditions: ActiveCondition[] = [];
    const push = (key: string, prefix: string, value: string, clear: Partial<LeadFilterState>) => {
      conditions.push({ key, label: `${prefix}: ${value}`, clear });
    };

    if (draft.sourceIds.length > 0) {
      push(
        'sourceIds',
        t('source'),
        summarize(sourceOptions.filter((option) => draft.sourceIds.includes(option.id))),
        { sourceIds: [] },
      );
    }
    if (draft.managerIds.length > 0 || draft.includeUnassignedManager) {
      push(
        'managerIds',
        t('responsibleManager'),
        summarize(managerOptions.filter((option) => selectedManagerIds.includes(option.id))),
        { managerIds: [], includeUnassignedManager: false },
      );
    }
    if (draft.languages.length > 0) {
      push(
        'languages',
        t('communicationLanguage'),
        summarize(languageOptions.filter((option) => draft.languages.includes(option.id))),
        { languages: [] },
      );
    }
    if (draft.hasPhone !== 'any') {
      push('hasPhone', t('telephonyPhoneNumber'), triStateWord(draft.hasPhone), { hasPhone: 'any' });
    }
    if (draft.hasMessenger !== 'any') {
      push('hasMessenger', t('leadFilterMessenger'), triStateWord(draft.hasMessenger), { hasMessenger: 'any' });
    }
    if (draft.onlyNew) {
      conditions.push({ key: 'onlyNew', label: t('leadFilterOnlyNew'), clear: { onlyNew: false } });
    }
    if (draft.tagIds.length > 0) {
      push(
        'tagIds',
        t('leadTags'),
        summarize(tagOptions.filter((option) => draft.tagIds.includes(option.id))),
        { tagIds: [] },
      );
    }
    if (draft.demoBooked !== 'any') {
      push('demoBooked', t('leadFilterDemo'), triStateWord(draft.demoBooked), { demoBooked: 'any' });
    }
    if (draft.hasComment !== 'any') {
      push('hasComment', t('comment'), triStateWord(draft.hasComment), { hasComment: 'any' });
    }
    if (draft.ageFrom || draft.ageTo) {
      push('age', t('age'), describeRange(draft.ageFrom, draft.ageTo, (value) => value), {
        ageFrom: '',
        ageTo: '',
      });
    }
    if (draft.amountFrom || draft.amountTo) {
      push(
        'amount',
        t('leadFilterAmount'),
        describeRange(draft.amountFrom, draft.amountTo, formatCurrencyInput),
        { amountFrom: '', amountTo: '' },
      );
    }
    if (draft.createdFrom || draft.createdTo) {
      push(
        'created',
        t('leadFilterCreatedAt'),
        describeRange(draft.createdFrom, draft.createdTo, (value) => formatAcademyDate(value, language)),
        { createdFrom: '', createdTo: '' },
      );
    }

    return conditions;
  };

  const activeConditions = describeConditions();

  const activeDatePreset = DATE_PRESETS.find((entry) => {
    const range = reportingRangeForPreset(entry.preset);
    return draft.createdFrom === range.from && draft.createdTo === range.to;
  })?.preset;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant={activeCount > 0 ? 'default' : 'outline'}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal data-icon="inline-start" />
        {t('leadFilters')}
        {activeCount > 0 ? (
          <Badge variant="secondary" className="ml-1.5 px-1.5">{activeCount}</Badge>
        ) : null}
      </Button>
      {/*
        DialogContent is a grid: Tailwind emits `.grid` after `.flex`, so a
        `flex` class here loses and every flex-1 child silently stops working.
        The rows are declared instead, and `minmax(0, 1fr)` is what lets the
        middle row shrink so its scroll area actually scrolls.
      */}
      <DialogContent className="grid max-h-[85dvh] max-w-3xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-border/60 bg-muted/30 px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            {t('leadFilters')}
          </DialogTitle>
          <DialogDescription>{t('leadFiltersDescription')}</DialogDescription>
        </DialogHeader>

        {/* Enter applies, so the keyboard path does not end at a mouse click. */}
        <form
          className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draft);
            setOpen(false);
          }}
        >
          <ScrollArea className="min-h-0">
            {activeConditions.length > 0 ? (
              <div
                className="sticky top-0 z-30 flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-background/95 px-4 py-2.5 backdrop-blur"
                role="group"
                aria-label={t('leadFilterActiveConditions')}
              >
                {activeConditions.map((condition) => (
                  <span
                    key={condition.key}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/5 py-0.5 pl-2.5 pr-1 text-xs text-foreground"
                  >
                    <span className="truncate">{condition.label}</span>
                    <button
                      type="button"
                      aria-label={t('leadFilterRemoveCondition').replace('{label}', condition.label)}
                      onClick={() => setDraft((current) => ({ ...current, ...condition.clear }))}
                      className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="space-y-5 p-4">
              <FilterSection title={t('leadFiltersChannels')}>
                <div className="grid grid-cols-1 items-end gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {sources.length > 0 ? (
                    <FilterField id="lead-filter-source" label={t('source')}>
                      <FilterMultiSelect
                        id="lead-filter-source"
                        placeholder={t('leadFilterAny')}
                        options={sourceOptions}
                        selected={draft.sourceIds}
                        onChange={(next) => update('sourceIds', next)}
                        searchPlaceholder={t('leadFilterSearchOptions')}
                        emptyText={t('noSearchResults')}
                      />
                    </FilterField>
                  ) : null}
                  <FilterField id="lead-filter-manager" label={t('responsibleManager')}>
                    <FilterMultiSelect
                      id="lead-filter-manager"
                      placeholder={t('leadFilterAny')}
                      options={managerOptions}
                      selected={selectedManagerIds}
                      onChange={applyManagerSelection}
                      searchPlaceholder={t('searchEmployees')}
                      emptyText={t('noSearchResults')}
                    />
                  </FilterField>
                  <FilterField id="lead-filter-language" label={t('communicationLanguage')}>
                    <FilterMultiSelect
                      id="lead-filter-language"
                      placeholder={t('leadFilterAny')}
                      options={languageOptions}
                      selected={draft.languages}
                      onChange={(next) => update('languages', next)}
                      searchPlaceholder={t('leadFilterSearchOptions')}
                      emptyText={t('noSearchResults')}
                    />
                  </FilterField>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <FilterTriStateRow
                    icon={Phone}
                    label={t('telephonyPhoneNumber')}
                    value={draft.hasPhone}
                    onChange={(value) => update('hasPhone', value as LeadFilterTriState)}
                    options={triStateOptions}
                  />
                  <FilterTriStateRow
                    icon={MessageCircle}
                    label={t('leadFilterMessenger')}
                    value={draft.hasMessenger}
                    onChange={(value) => update('hasMessenger', value as LeadFilterTriState)}
                    options={triStateOptions}
                  />
                </div>
              </FilterSection>

              <FilterSection title={t('leadFiltersTraits')}>
                <FilterSwitchRow
                  icon={Sparkles}
                  label={t('leadFilterOnlyNew')}
                  checked={draft.onlyNew}
                  onCheckedChange={(checked) => update('onlyNew', checked === true)}
                />
                <div className="grid grid-cols-1 items-end gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {tagOptions.length > 0 ? (
                    <FilterField id="lead-filter-tags" label={t('leadTags')}>
                      <FilterMultiSelect
                        id="lead-filter-tags"
                        placeholder={t('leadFilterAny')}
                        options={tagOptions}
                        selected={draft.tagIds}
                        onChange={(next) => update('tagIds', next)}
                        searchPlaceholder={t('leadFilterSearchOptions')}
                        emptyText={t('noSearchResults')}
                      />
                    </FilterField>
                  ) : null}
                  <FilterTriStateRow
                    icon={GraduationCap}
                    label={t('leadFilterDemo')}
                    value={draft.demoBooked}
                    onChange={(value) => update('demoBooked', value as LeadFilterTriState)}
                    options={triStateOptions}
                  />
                  <FilterTriStateRow
                    icon={MessageSquare}
                    label={t('comment')}
                    value={draft.hasComment}
                    onChange={(value) => update('hasComment', value as LeadFilterTriState)}
                    options={triStateOptions}
                  />
                </div>
              </FilterSection>

              <FilterSection title={t('leadFiltersNumbers')}>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  <FilterRangeField
                    id="lead-filter-age"
                    label={t('age')}
                    fromValue={draft.ageFrom}
                    toValue={draft.ageTo}
                    onFromChange={(value) => update('ageFrom', value)}
                    onToChange={(value) => update('ageTo', value)}
                    fromLabel={t('leadFilterFrom')}
                    toLabel={t('leadFilterTo')}
                  />
                  <FilterRangeField
                    id="lead-filter-amount"
                    label={t('leadFilterAmount')}
                    variant="currency"
                    fromValue={draft.amountFrom}
                    toValue={draft.amountTo}
                    onFromChange={(value) => update('amountFrom', value)}
                    onToChange={(value) => update('amountTo', value)}
                    fromLabel={t('leadFilterFrom')}
                    toLabel={t('leadFilterTo')}
                  />
                  <FilterRangeField
                    id="lead-filter-created"
                    label={t('leadFilterCreatedAt')}
                    variant="date"
                    fromValue={draft.createdFrom}
                    toValue={draft.createdTo}
                    onFromChange={(value) => update('createdFrom', value)}
                    onToChange={(value) => update('createdTo', value)}
                    fromLabel={t('leadFilterFrom')}
                    toLabel={t('leadFilterTo')}
                    footer={(
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {DATE_PRESETS.map((entry) => (
                          <FilterPresetButton
                            key={entry.preset}
                            label={t(entry.labelKey)}
                            active={activeDatePreset === entry.preset}
                            onClick={() => {
                              const range = reportingRangeForPreset(entry.preset);
                              setDraft((current) => (
                                activeDatePreset === entry.preset
                                  ? { ...current, createdFrom: '', createdTo: '' }
                                  : { ...current, createdFrom: range.from, createdTo: range.to }
                              ));
                            }}
                          />
                        ))}
                      </div>
                    )}
                  />
                </div>
              </FilterSection>
            </div>
          </ScrollArea>

          <DialogFooter className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/60 bg-muted/30 px-4 py-3 sm:flex-nowrap sm:px-5 sm:justify-between">
            <span className="text-sm text-muted-foreground" role="status">
              {t('leadFilterMatches')
                .replace('{count}', String(draftMatches))
                .replace('{total}', String(leads.length))}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDraft(EMPTY_LEAD_FILTERS)}
                disabled={draftCount === 0}
              >
                {t('reset')}
              </Button>
              <Button type="submit" size="sm">{t('leadFilterApply')}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
