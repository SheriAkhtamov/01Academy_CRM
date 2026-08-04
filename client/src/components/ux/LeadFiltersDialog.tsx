import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { SegmentedControl } from '@/components/ux/lead/LeadSheetControls';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
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

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function TriStateRow({
  label,
  value,
  onChange,
  yesLabel,
  noLabel,
  anyLabel,
}: {
  label: string;
  value: LeadFilterTriState;
  onChange: (value: LeadFilterTriState) => void;
  yesLabel: string;
  noLabel: string;
  anyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-normal text-foreground">{label}</Label>
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
  type = 'number',
  fromLabel,
  toLabel,
}: {
  label: string;
  fromValue: string;
  toValue: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  type?: 'number' | 'date';
  fromLabel: string;
  toLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-normal text-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type={type}
          value={fromValue}
          aria-label={`${label}: ${fromLabel}`}
          placeholder={fromLabel}
          onChange={(event) => onFromChange(event.target.value)}
        />
        <span aria-hidden="true" className="text-muted-foreground">—</span>
        <Input
          type={type}
          value={toValue}
          aria-label={`${label}: ${toLabel}`}
          placeholder={toLabel}
          onChange={(event) => onToChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function CheckboxGrid<T extends number | string>({
  items,
  selected,
  onToggle,
}: {
  items: Array<{ id: T; label: string }>;
  selected: readonly T[];
  onToggle: (id: T) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <label
          key={item.id}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-border/70 bg-card px-3 py-2 text-sm transition-colors hover:border-border"
        >
          <Checkbox
            checked={selected.includes(item.id)}
            onCheckedChange={() => onToggle(item.id)}
          />
          <span className="truncate">{item.label}</span>
        </label>
      ))}
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
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 pb-5 pt-6 pr-12">
          <DialogTitle>{t('leadFilters')}</DialogTitle>
          <DialogDescription>{t('leadFiltersDescription')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-6 px-6 py-5">
            <FilterSection title={t('leadFiltersChannels')}>
              {sources.length > 0 ? (
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal text-foreground">{t('source')}</Label>
                  <CheckboxGrid
                    items={sources.map((source) => ({ id: source.id, label: source.name }))}
                    selected={draft.sourceIds}
                    onToggle={(id) => update('sourceIds', toggleFilterValue(draft.sourceIds, id))}
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label className="text-sm font-normal text-foreground">{t('communicationLanguage')}</Label>
                <CheckboxGrid
                  items={LEAD_FILTER_LANGUAGES.map((code) => ({
                    id: code,
                    label: t(LANGUAGE_LABEL_KEYS[code]),
                  }))}
                  selected={draft.languages}
                  onToggle={(code) => update('languages', toggleFilterValue(draft.languages, code))}
                />
              </div>
              <TriStateRow
                label={t('telephonyPhoneNumber')}
                value={draft.hasPhone}
                onChange={(value) => update('hasPhone', value)}
                anyLabel={t('leadFilterAny')}
                yesLabel={t('yes')}
                noLabel={t('no')}
              />
              <TriStateRow
                label={t('leadFilterMessenger')}
                value={draft.hasMessenger}
                onChange={(value) => update('hasMessenger', value)}
                anyLabel={t('leadFilterAny')}
                yesLabel={t('yes')}
                noLabel={t('no')}
              />
            </FilterSection>

            <FilterSection title={t('leadFiltersTraits')}>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2.5">
                <span className="text-sm">{t('leadFilterOnlyNew')}</span>
                <Switch
                  checked={draft.onlyNew}
                  onCheckedChange={(checked) => update('onlyNew', checked === true)}
                  aria-label={t('leadFilterOnlyNew')}
                />
              </label>
              {tagOptions.length > 0 ? (
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal text-foreground">{t('leadTags')}</Label>
                  <CheckboxGrid
                    items={tagOptions}
                    selected={draft.tagIds}
                    onToggle={(id) => update('tagIds', toggleFilterValue(draft.tagIds, id))}
                  />
                </div>
              ) : null}
              <TriStateRow
                label={t('leadFilterDemo')}
                value={draft.demoBooked}
                onChange={(value) => update('demoBooked', value)}
                anyLabel={t('leadFilterAny')}
                yesLabel={t('yes')}
                noLabel={t('no')}
              />
              <TriStateRow
                label={t('comment')}
                value={draft.hasComment}
                onChange={(value) => update('hasComment', value)}
                anyLabel={t('leadFilterAny')}
                yesLabel={t('yes')}
                noLabel={t('no')}
              />
            </FilterSection>

            <FilterSection title={t('leadFiltersNumbers')}>
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
                fromValue={draft.amountFrom}
                toValue={draft.amountTo}
                onFromChange={(value) => update('amountFrom', value)}
                onToChange={(value) => update('amountTo', value)}
                fromLabel={t('leadFilterFrom')}
                toLabel={t('leadFilterTo')}
              />
              <RangeRow
                label={t('leadFilterCreatedAt')}
                type="date"
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

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-border px-6 pb-6 pt-4 sm:justify-between">
          <span className="text-sm text-muted-foreground" role="status">
            {t('leadFilterMatches').replace('{count}', String(draftMatches))}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDraft(EMPTY_LEAD_FILTERS)}
              disabled={countActiveLeadFilters(draft) === 0}
            >
              {t('reset')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              {t('leadFilterApply')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
