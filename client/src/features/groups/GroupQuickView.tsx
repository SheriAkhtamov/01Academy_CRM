import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Archive, ArchiveRestore, CalendarClock, CalendarRange, ChevronDown, ChevronUp, Edit3, GraduationCap, Trash2, UsersRound } from 'lucide-react';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { GroupStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import { cn } from '@/lib/utils';
import type { Room } from '@/features/academy-resources/api';
import { GroupSeatMeter } from './GroupSeatMeter';
import {
  formatGroupDateLong,
  formatSlotTime,
  groupNameParts,
  groupScheduleSlots,
  groupSeats,
  groupTimeline,
  summarizeSchedule,
} from './presentation';
import { useGroupLabels } from './useGroupLabels';
import type { Group } from './types';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

interface QuickViewActions {
  onEdit: (group: Group) => void;
  onArchive: (group: Group) => void;
  onRestore: (group: Group) => void;
  onDelete: (group: Group) => void;
  busy: boolean;
}

interface GroupQuickViewProps extends QuickViewActions {
  group: Group | null;
  rooms: Room[];
  todayKey: string;
  position: { index: number; total: number } | null;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
}

const isTypingTarget = (target: EventTarget) => (
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
);

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function QuickViewHeader({ group, todayKey, position, onPrevious, onNext }: Pick<GroupQuickViewProps,
  'todayKey' | 'position' | 'onPrevious' | 'onNext'> & { group: Group }) {
  const { t, language } = useTranslation();
  const { startLabel } = useGroupLabels();
  const { title, code } = groupNameParts(group.name);
  const start = startLabel(group, todayKey);
  return (
    <SheetHeader className="compact-modal-header space-y-2 text-left">
      <div className="flex min-h-8 items-center gap-1 pr-10">
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t('groupPreviousInList')}
          aria-keyshortcuts="ArrowUp" disabled={!onPrevious} onClick={() => onPrevious?.()}>
          <ChevronUp />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t('groupNextInList')}
          aria-keyshortcuts="ArrowDown" disabled={!onNext} onClick={() => onNext?.()}>
          <ChevronDown />
        </Button>
        {position ? (
          <span className="ml-1 text-xs tabular-nums text-muted-foreground">
            {t('groupPositionInList').replace('{index}', String(position.index)).replace('{total}', String(position.total))}
          </span>
        ) : null}
      </div>
      <SheetTitle className="break-words text-lg">{title}</SheetTitle>
      {code ? <p className="font-mono text-xs text-muted-foreground">{code}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <GroupStatusBadge status={group.status} />
        {start ? <span className="text-sm font-medium text-primary">{start}</span> : null}
        {group.isArchived && group.archivedAt ? (
          <span className="text-sm text-muted-foreground">
            {t('groupArchivedOn').replace('{date}', formatAcademyDate(group.archivedAt, language))}
          </span>
        ) : null}
      </div>
    </SheetHeader>
  );
}

function QuickViewBody({ group, rooms, todayKey }: { group: Group; rooms: Room[]; todayKey: string }) {
  const { t, language } = useTranslation();
  const { lessonPlanLabel } = useGroupLabels();
  const fullDayNames = [t('monday'), t('tuesday'), t('wednesday'), t('thursday'), t('friday'), t('saturday'), t('sunday')];
  const shortDayNames = [t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'), t('fridayShort'), t('saturdayShort'), t('sundayShort')];
  const seats = groupSeats(group);
  const timeline = groupTimeline(group, todayKey);
  const slots = groupScheduleSlots(group);
  const room = rooms.find((item) => item.id === group.roomId);
  const period = timeline.startKey || timeline.endKey
    ? `${formatGroupDateLong(timeline.startKey, language) || '…'} → ${formatGroupDateLong(timeline.endKey, language) || '…'}`
    : '—';

  return (
    <div className="compact-modal-body min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain">
      <CompactModalSection title={t('groupCapacity')} icon={UsersRound} tone="sky" collapsible={false} contentClassName="space-y-3"
        actions={<span className="pr-3 text-sm font-semibold tabular-nums">{seats.occupied}/{seats.max}</span>}>
        <GroupSeatMeter seats={seats} size="lg" />
        <ul className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <li>{t('groupSeatsStudying')}<span className="mt-1 block text-base font-semibold tabular-nums text-foreground">{seats.current}</span></li>
          <li>{t('reservedSeats')}<span className="mt-1 block text-base font-semibold tabular-nums text-foreground">{seats.reserved}</span></li>
          <li>{t('groupSeatsFree')}<span className={cn('mt-1 block text-base font-semibold tabular-nums',
            seats.sellable && seats.free === 0 ? 'text-rose-700 dark:text-rose-300' : 'text-foreground')}>{seats.free}</span></li>
        </ul>
      </CompactModalSection>

      <CompactModalSection title={t('groupEditorPlaceSection')} icon={GraduationCap} tone="teal" defaultOpen
        summary={[group.courseName, group.schoolName, group.roomName].filter(Boolean).join(' · ')}>
        <dl className="divide-y divide-border/60">
          <Detail label={t('course')}>{group.courseName ?? '—'}</Detail>
          <Detail label={t('school')}>{group.schoolName ?? '—'}</Detail>
          <Detail label={t('room')}>
            {group.roomName ?? '—'}
            {room?.capacity ? <span className="text-muted-foreground"> · {t('groupRoomCapacity').replace('{count}', String(room.capacity))}</span> : null}
          </Detail>
          <Detail label={t('teacher')}>
            {group.teacherName ? <EmployeeIdentity userId={group.teacherUserId} name={group.teacherName} /> : <span className="font-medium text-amber-700 dark:text-amber-300">{t('notAssigned')}</span>}
          </Detail>
        </dl>
      </CompactModalSection>

      <CompactModalSection title={t('schedule')} icon={CalendarClock} tone="violet"
        summary={summarizeSchedule(slots, shortDayNames).map((entry) => `${entry.days} ${entry.time}`).join(' · ') || t('groupsWithoutSchedule')}>
        {slots.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {slots.map((slot) => (
              <li key={`${slot.dayOfWeek}-${slot.startMinutes}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="font-medium text-foreground">{fullDayNames[slot.dayOfWeek - 1]}</span>
                <span className="tabular-nums text-muted-foreground">{formatSlotTime(slot)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t('groupsWithoutSchedule')}</p>}
      </CompactModalSection>

      <CompactModalSection title={t('groupEditorDatesSection')} icon={CalendarRange} tone="amber"
        summary={period}>
        <dl className="divide-y divide-border/60">
          <Detail label={t('groupDates')}>{period}</Detail>
          <Detail label={t('groupLearningPlan')}>{lessonPlanLabel(group)}</Detail>
        </dl>
      </CompactModalSection>
    </div>
  );
}

function QuickViewActionsBar({ group, onEdit, onArchive, onRestore, onDelete, busy }: QuickViewActions & { group: Group }) {
  const { t } = useTranslation();
  return (
    <div className="compact-modal-footer flex flex-wrap gap-2">
      <Button type="button" onClick={() => onEdit(group)}>
        <Edit3 data-icon="inline-start" />
        {t('editGroup')}
      </Button>
      {group.isArchived ? (
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onRestore(group)}>
            {busy ? <OrbitSpinner className="" data-icon="inline-start" /> : <ArchiveRestore data-icon="inline-start" />}
            {t('restoreGroupFromArchive')}
          </Button>
          <Button type="button" variant="ghost" disabled={busy}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(group)}>
            <Trash2 data-icon="inline-start" />
            {t('deleteGroupPermanently')}
          </Button>
        </>
      ) : (
        <Button type="button" variant="outline" disabled={busy} onClick={() => onArchive(group)}>
          {busy ? <OrbitSpinner className="" data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
          {t('archiveGroup')}
        </Button>
      )}
    </div>
  );
}

/**
 * Most visits to a group are to look, not to change it: seats, days, start.
 * The row opens this read-only drawer; editing is one deliberate step further,
 * so a glance can no longer leave a half-edited form behind.
 */
export function GroupQuickView({
  group, rooms, todayKey, position, onPrevious, onNext, onClose, ...actions
}: GroupQuickViewProps) {
  // The drawer slides out after `group` is cleared; it keeps showing the last
  // group meanwhile instead of collapsing into an empty panel mid-animation.
  const lastGroup = useRef<Group | null>(null);
  if (group) lastGroup.current = group;
  const shown = group ?? lastGroup.current;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
    if (event.key === 'ArrowUp' && onPrevious) {
      event.preventDefault();
      onPrevious();
    } else if (event.key === 'ArrowDown' && onNext) {
      event.preventDefault();
      onNext();
    }
  };

  return (
    <Sheet open={Boolean(group)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent aria-describedby={undefined} className="compact-modal flex flex-col gap-0 p-0 sm:max-w-lg" onKeyDown={handleKeyDown}>
        {shown ? <>
          <QuickViewHeader group={shown} todayKey={todayKey} position={position} onPrevious={onPrevious} onNext={onNext} />
          <QuickViewBody key={shown.id} group={shown} rooms={rooms} todayKey={todayKey} />
          <QuickViewActionsBar group={shown} {...actions} />
        </> : null}
      </SheetContent>
    </Sheet>
  );
}
