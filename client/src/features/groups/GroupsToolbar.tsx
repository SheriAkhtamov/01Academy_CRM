import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import type { RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Plus, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { ArchiveSelect } from '@/features/academy-resources/ResourceSettingsTables';

export type GroupFacetKey = 'course' | 'school' | 'teacher' | 'status';
/**
 * Sales gets a one-click current/archive toggle with counts. The academy
 * settings keep the dropdown every other resource tab there uses.
 */
export type GroupScopeControl = 'toggle' | 'select';

/** The physical key the create shortcut listens to; see useGroupsShortcuts. */
export const CREATE_GROUP_KEY_LABEL = 'N';

export interface GroupFacet {
  key: GroupFacetKey;
  label: string;
  icon: LucideIcon;
  value: string;
  allLabel: string;
  allCount: number;
  options: Array<{ value: string; label: string; count: number; employeeUserId?: number | null }>;
}

interface GroupsToolbarProps {
  title?: string;
  scopeControl?: GroupScopeControl;
  isArchive: boolean;
  scopeCounts: { current: number; archive: number };
  onScopeChange: (archive: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  facets: GroupFacet[];
  onFacetChange: (key: GroupFacetKey, value: string) => void;
  foundCount: number;
  hasFilters: boolean;
  onReset: () => void;
  onCreate: () => void;
}

/* Every control in the strip is 44px tall on a phone — a finger's worth — and
   compact from `sm` up, where a pointer is the likelier input. */
const SEGMENTED_GROUP_CLASS = 'inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5';

const segmentClass = (pressed: boolean) => cn(
  'h-auto min-h-10 gap-2 px-3 sm:min-h-8',
  pressed
    ? 'bg-background text-foreground shadow-sm hover:bg-background'
    : 'text-muted-foreground hover:bg-transparent hover:text-foreground',
);

function Count({ value }: { value: number }) {
  return <span className="tabular-nums text-xs text-muted-foreground">{value}</span>;
}

function FacetSelect({ facet, onChange }: { facet: GroupFacet; onChange: (value: string) => void }) {
  const Icon = facet.icon;
  const active = facet.value !== 'all';
  const selected = facet.options.find((option) => option.value === facet.value);
  return (
    <Select value={facet.value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={facet.label}
        className={cn(
          'h-11 w-auto max-w-[15rem] shrink-0 gap-2 rounded-full px-3 sm:h-9',
          active && 'border-primary/50 bg-primary/5 font-medium text-foreground',
        )}
      >
        <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
        {/* Unfiltered, the chip names its filter; filtered, it shows the choice. */}
        <SelectValue>{active && selected ? facet.key === 'teacher' ? <EmployeeIdentity userId={selected.employeeUserId} name={selected.label} avatarClassName="size-6" /> : selected.label : facet.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" trailing={<span aria-hidden="true">{facet.allCount}</span>}>{facet.allLabel}</SelectItem>
        {facet.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            textValue={option.label}
            trailing={<span aria-hidden="true" className={cn('tabular-nums', option.count === 0 && 'opacity-50')}>{option.count}</span>}
          >
            {facet.key === 'teacher' ? <EmployeeIdentity userId={option.employeeUserId} name={option.label} avatarClassName="size-6" /> : option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One compact strip instead of a form: every filter keeps its options, but as
 * a chip without a label above it, so the list starts a screen higher. The
 * numbers say how many groups a choice leaves before it is made.
 */
export function GroupsToolbar({
  title, scopeControl = 'toggle', isArchive, scopeCounts, onScopeChange, search, onSearchChange, searchRef,
  facets, onFacetChange, foundCount, hasFilters, onReset, onCreate,
}: GroupsToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {title ? <h2 className="mr-2 text-lg font-semibold text-foreground">{title}</h2> : null}
        {scopeControl === 'select' ? (
          <ArchiveSelect archived={isArchive} label={t('groupListView')} onChange={onScopeChange} />
        ) : (
          <div role="group" aria-label={t('groupListView')} className={SEGMENTED_GROUP_CLASS}>
            {[false, true].map((archive) => (
              <Button
                key={String(archive)}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={isArchive === archive}
                className={segmentClass(isArchive === archive)}
                onClick={() => onScopeChange(archive)}
              >
                {archive ? t('taskArchive') : t('groupCurrentShort')}
                <Count value={archive ? scopeCounts.archive : scopeCounts.current} />
              </Button>
            ))}
          </div>
        )}
        <Button type="button" className="ml-auto h-11 w-11 px-0 sm:h-10 sm:w-auto sm:px-4" aria-label={t('addGroup')}
          aria-keyshortcuts={CREATE_GROUP_KEY_LABEL} onClick={onCreate}>
          <Plus data-icon="inline-start" />
          <span className="hidden sm:inline">{t('addGroup')}</span>
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={searchRef}
          id="groups-search"
          type="search"
          aria-label={t('groupsSearchLabel')}
          aria-keyshortcuts="/"
          className="pl-10 pr-12 [&::-webkit-search-cancel-button]:hidden"
          value={search}
          placeholder={t('groupsSearchPlaceholder')}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search) {
              event.preventDefault();
              onSearchChange('');
            }
          }}
        />
        {search ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
            aria-label={t('clearSearch')}
            onClick={() => {
              onSearchChange('');
              searchRef.current?.focus();
            }}
          >
            <X />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {/* A phone scrolls the chips sideways rather than stacking rows of them. */}
        <div className="-mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-0.5 sm:flex-wrap sm:overflow-visible">
          {facets.map((facet) => (
            <FacetSelect key={facet.key} facet={facet} onChange={(value) => onFacetChange(facet.key, value)} />
          ))}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 lg:ml-auto">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('groupsFound').replace('{count}', String(foundCount))}
          </p>
          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={onReset}>
              <RotateCcw data-icon="inline-start" />
              {t('resetFilters')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
