import { Search, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import {
  EMPTY_PIPELINE_FILTERS,
  PIPELINE_FILTER_ALL,
  PIPELINE_FILTER_UNASSIGNED,
  hasActivePipelineFilters,
  type PipelineFilterState,
  type PipelineSort,
} from '@/lib/pipelineFilters';

interface PipelineToolbarProps {
  filters: PipelineFilterState;
  onChange: (filters: PipelineFilterState) => void;
  managers: Array<{ id: number; fullName: string }>;
  sources: Array<{ id: number; name: string }>;
  showManagerFilter: boolean;
  visibleCount: number;
  totalCount: number;
}

const SORT_OPTIONS = [
  { value: 'newest', labelKey: 'pipelineSortNewest' },
  { value: 'oldest', labelKey: 'pipelineSortOldest' },
  { value: 'amount', labelKey: 'pipelineSortAmount' },
  { value: 'name', labelKey: 'pipelineSortName' },
] as const satisfies ReadonlyArray<{ value: PipelineSort; labelKey: TranslationKey }>;

export function PipelineToolbar({
  filters,
  onChange,
  managers,
  sources,
  showManagerFilter,
  visibleCount,
  totalCount,
}: PipelineToolbarProps) {
  const { t } = useTranslation();
  const isFiltered = hasActivePipelineFilters(filters);
  const update = (patch: Partial<PipelineFilterState>) => onChange({ ...filters, ...patch });

  return (
    <div
      role="search"
      aria-label={t('leadFilters')}
      className="mb-3 flex shrink-0 flex-wrap items-center gap-2"
    >
      <div className="relative min-w-56 flex-1 sm:max-w-80">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => update({ query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filters.query) {
              event.preventDefault();
              update({ query: '' });
            }
          }}
          placeholder={t('pipelineSearchPlaceholder')}
          aria-label={t('search')}
          className="pl-9 pr-9"
        />
        {filters.query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('clearSearch')}
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
            onClick={() => update({ query: '' })}
          >
            <X />
          </Button>
        ) : null}
      </div>

      {showManagerFilter ? (
        <Select value={filters.managerId} onValueChange={(value) => update({ managerId: value })}>
          <SelectTrigger className="w-auto min-w-40" aria-label={t('manager')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={PIPELINE_FILTER_ALL}>{t('allManagers')}</SelectItem>
              <SelectItem value={PIPELINE_FILTER_UNASSIGNED}>{t('notAssigned')}</SelectItem>
              {managers.map((manager) => (
                <SelectItem key={manager.id} value={String(manager.id)}>{manager.fullName}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      {sources.length > 0 ? (
        <Select value={filters.sourceId} onValueChange={(value) => update({ sourceId: value })}>
          <SelectTrigger className="w-auto min-w-36" aria-label={t('source')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={PIPELINE_FILTER_ALL}>{t('allSources')}</SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      <Select value={filters.sort} onValueChange={(value) => update({ sort: value as PipelineSort })}>
        <SelectTrigger className="w-auto min-w-40" aria-label={t('pipelineSortLabel')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{t(option.labelKey)}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {isFiltered ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...EMPTY_PIPELINE_FILTERS, sort: filters.sort })}
        >
          <RotateCcw data-icon="inline-start" />
          {t('resetFilters')}
        </Button>
      ) : null}

      <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
        {isFiltered
          ? t('pipelineVisibleLeads')
            .replace('{shown}', String(visibleCount))
            .replace('{total}', String(totalCount))
          : t('pipelineTotalLeads').replace('{total}', String(totalCount))}
      </p>
    </div>
  );
}
