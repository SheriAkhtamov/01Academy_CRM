import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { CurrencyInput } from '@/components/ux/FormattedInputs';
import { SegmentedControl } from '@/components/ux/lead/LeadSheetControls';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  EMPTY_LEAD_FILTERS,
  LEAD_FILTER_LANGUAGES,
  countActiveLeadFilters,
  leadMatchesFilters,
  toggleFilterValue,
  type FilterableLead,
  type LeadFilterState,
  type LeadFilterTriState,
} from '@/lib/leadFilters';

export interface LeadFilterSource {
  id: number;
  name: string;
  channel?: string | null;
}

interface LeadFiltersDialogProps {
  filters: LeadFilterState;
  onApply: (filters: LeadFilterState) => void;
  sources: LeadFilterSource[];
  leads: FilterableLead[];
}

const LANGUAGE_LABEL_KEYS: Record<string, TranslationKey> = {
  ru: 'russian',
  uz: 'uzbekLang',
  en: 'english',
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-xs font-medium text-muted-foreground">{children}</Label>;
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Chips fit four to six options into the width bordered checkbox rows spent on
 * two, which keeps the whole filter set reachable without a long scroll.
 */
function ChipGroup<T extends number | string>({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: Array<{ id: T; label: string }>;
  selected: readonly T[];
  onToggle: (id: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {items.map((item) => {
          const isSelected = selected.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(item.id)}
              className={cn(
                'max-w-full truncate rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TriStateRow({
  label,
  value,
  onChange,
  anyLabel,
  yesLabel,
  noLabel,
}: {
  label: string;
  value: LeadFilterTriState;
  onChange: (value: LeadFilterTriState) => void;
  anyLabel: string;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <SegmentedControl
        ariaLabel={label}
        value={value}
        onChange={(next) => onChange(next as LeadFilterTriState)}
        options={[
          { value: 'any', label: anyLabel },
          { value: 'yes', label: yesLabel },
          { value: 'no', label: noLabel },
        ]}
      />
    </div>
  );
}

function RangeRow({
  label,
  fromValue,
  toValue,
  onFromChange,
  onToChange,
  variant = 'number',
  fromLabel,
  toLabel,
}: {
  label: string;
  fromValue: string;
  toValue: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  variant?: 'number' | 'date' | 'currency';
  fromLabel: string;
  toLabel: string;
}) {
  const renderInput = (
    value: string,
    onChange: (next: string) => void,
    boundLabel: string,
  ) => {
    const shared = {
      className: 'h-9',
      'aria-label': `${label}: ${boundLabel}`,
      placeholder: boundLabel,
    };
    if (variant === 'currency') {
      return <CurrencyInput {...shared} value={value} onValueChange={onChange} />;
    }
    return (
      <Input
        {...shared}
        type={variant}
        min={variant === 'number' ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  };

  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        {renderInput(fromValue, onFromChange, fromLabel)}
        <span aria-hidden="true" className="text-muted-foreground">—</span>
        {renderInput(toValue, onToChange, toLabel)}
      </div>
    </div>
  );
}

export function LeadFiltersDialog({ filters, onApply, sources, leads }: LeadFiltersDialogProps) {
  const { t } = useTranslation();
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

  // Only tags that leads actually carry are worth offering as a filter.
  const tagOptions = useMemo(() => {
    const byId = new Map<number, string>();
    leads.forEach((lead) => (lead.tags ?? []).forEach((tag) => byId.set(tag.id, tag.name)));
    return [...byId.entries()]
      .map(([id, name]) => ({ id, label: name }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [leads]);

  const update = <K extends keyof LeadFilterState>(key: K, value: LeadFilterState[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const triStateLabels = {
    anyLabel: t('leadFilterAny'),
    yesLabel: t('yes'),
    noLabel: t('no'),
  };

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
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5 pr-12">
          <DialogTitle>{t('leadFilters')}</DialogTitle>
          <DialogDescription>{t('leadFiltersDescription')}</DialogDescription>
        </DialogHeader>

        {/* Enter applies, so the keyboard path does not end at a mouse click. */}
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draft);
            setOpen(false);
          }}
        >
          {/* Without min-h-0 this flex item refuses to shrink below its content,
              so the lower filters get clipped instead of becoming scrollable. */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 px-5 py-4">
              <FilterSection title={t('leadFiltersChannels')}>
                {sources.length > 0 ? (
                  <ChipGroup
                    label={t('source')}
                    items={sources.map((source) => ({ id: source.id, label: source.name }))}
                    selected={draft.sourceIds}
                    onToggle={(id) => update('sourceIds', toggleFilterValue(draft.sourceIds, id))}
                  />
                ) : null}
                <ChipGroup
                  label={t('communicationLanguage')}
                  items={LEAD_FILTER_LANGUAGES.map((code) => ({
                    id: code,
                    label: t(LANGUAGE_LABEL_KEYS[code]),
                  }))}
                  selected={draft.languages}
                  onToggle={(code) => update('languages', toggleFilterValue(draft.languages, code))}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <TriStateRow
                    label={t('telephonyPhoneNumber')}
                    value={draft.hasPhone}
                    onChange={(value) => update('hasPhone', value)}
                    {...triStateLabels}
                  />
                  <TriStateRow
                    label={t('leadFilterMessenger')}
                    value={draft.hasMessenger}
                    onChange={(value) => update('hasMessenger', value)}
                    {...triStateLabels}
                  />
                </div>
              </FilterSection>

              <FilterSection title={t('leadFiltersTraits')}>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2">
                  <span className="text-sm">{t('leadFilterOnlyNew')}</span>
                  <Switch
                    checked={draft.onlyNew}
                    onCheckedChange={(checked) => update('onlyNew', checked === true)}
                    aria-label={t('leadFilterOnlyNew')}
                  />
                </div>
                {tagOptions.length > 0 ? (
                  <ChipGroup
                    label={t('leadTags')}
                    items={tagOptions}
                    selected={draft.tagIds}
                    onToggle={(id) => update('tagIds', toggleFilterValue(draft.tagIds, id))}
                  />
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <TriStateRow
                    label={t('leadFilterDemo')}
                    value={draft.demoBooked}
                    onChange={(value) => update('demoBooked', value)}
                    {...triStateLabels}
                  />
                  <TriStateRow
                    label={t('comment')}
                    value={draft.hasComment}
                    onChange={(value) => update('hasComment', value)}
                    {...triStateLabels}
                  />
                </div>
              </FilterSection>

              <FilterSection title={t('leadFiltersNumbers')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <RangeRow
                    label={t('age')}
                    fromValue={draft.ageFrom}
                    toValue={draft.ageTo}
                    onFromChange={(value) => update('ageFrom', value)}
                    onToChange={(value) => update('ageTo', value)}
                    fromLabel={t('leadFilterFrom')}
                    toLabel={t('leadFilterTo')}
                  />
                  <RangeRow
                    label={t('leadFilterAmount')}
                    variant="currency"
                    fromValue={draft.amountFrom}
                    toValue={draft.amountTo}
                    onFromChange={(value) => update('amountFrom', value)}
                    onToChange={(value) => update('amountTo', value)}
                    fromLabel={t('leadFilterFrom')}
                    toLabel={t('leadFilterTo')}
                  />
                </div>
                <RangeRow
                  label={t('leadFilterCreatedAt')}
                  variant="date"
                  fromValue={draft.createdFrom}
                  toValue={draft.createdTo}
                  onFromChange={(value) => update('createdFrom', value)}
                  onToChange={(value) => update('createdTo', value)}
                  fromLabel={t('leadFilterFrom')}
                  toLabel={t('leadFilterTo')}
                />
              </FilterSection>
            </div>
          </ScrollArea>

          <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-border px-5 py-3 sm:justify-between">
            <span className="text-sm text-muted-foreground" role="status">
              {t('leadFilterMatches').replace('{count}', String(draftMatches))}
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
