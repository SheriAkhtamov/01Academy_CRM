import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Edit3, Loader2, Trash2 } from 'lucide-react';
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
} from './presentation';
import { useGroupLabels } from './useGroupLabels';
import type { Group } from './types';

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
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 py-2">
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
    <SheetHeader className="space-y-2 border-b border-border px-6 pb-4 pt-5 text-left">
      <div className="flex min-h-9 items-center gap-1 pr-10">
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t('groupPreviousInList')}
          aria-keyshortcuts="ArrowUp" disabled={!onPrevious} onClick={() => onPrevious?.()}>
          <ChevronUp />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t('groupNextInList')}
          aria-keyshortcuts="ArrowDown" disabled={!onNext} onClick={() => onNext?.()}>
          <ChevronDown />
        </Button>
        {position ? (
          <span className="ml-1 text-xs tabular-nums text-muted-foreground">
            {t('groupPositionInList').replace('{index}', String(position.index)).replace('{total}', String(position.total))}
          </span>
        ) : null}
      </div>
      <SheetTitle className="break-words text-xl">{title}</SheetTitle>
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
  const seats = groupSeats(group);
  const timeline = groupTimeline(group, todayKey);
  const slots = groupScheduleSlots(group);
  const room = rooms.find((item) => item.id === group.roomId);
  const period = timeline.startKey || timeline.endKey
    ? `${formatGroupDateLong(timeline.startKey, language) || '…'} → ${formatGroupDateLong(timeline.endKey, language) || '…'}`
    : '—';

  return (
    <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-5">
      <section aria-labelledby="group-quick-seats" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="group-quick-seats" className="text-sm font-semibold text-foreground">{t('groupCapacity')}</h3>
          <span className="text-sm font-semibold tabular-nums text-foreground">{seats.occupied}/{seats.max}</span>
        </div>
        <GroupSeatMeter seats={seats} size="lg" />
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <li>{t('groupSeatsStudying')}: <span className="font-medium tabular-nums text-foreground">{seats.current}</span></li>
          <li>{t('reservedSeats')}: <span className="font-medium tabular-nums text-foreground">{seats.reserved}</span></li>
          <li>{t('groupSeatsFree')}: <span className={cn('font-medium tabular-nums',
            seats.sellable && seats.free === 0 ? 'text-rose-700 dark:text-rose-300' : 'text-foreground')}>{seats.free}</span></li>
        </ul>
      </section>

      <section aria-labelledby="group-quick-schedule" className="space-y-2">
        <h3 id="group-quick-schedule" className="text-sm font-semibold text-foreground">{t('schedule')}</h3>
        {slots.length > 0 ? (
          <ul className="divide-y divide-border/60 rounded-lg border border-border">
            {slots.map((slot) => (
              <li key={`${slot.dayOfWeek}-${slot.startMinutes}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-foreground">{fullDayNames[slot.dayOfWeek - 1]}</span>
                <span className="tabular-nums text-muted-foreground">{formatSlotTime(slot)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t('groupsWithoutSchedule')}</p>}
      </section>

      <dl className="divide-y divide-border/60">
        <Detail label={t('groupDates')}>{period}</Detail>
        <Detail label={t('groupLearningPlan')}>{lessonPlanLabel(group)}</Detail>
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
    </div>
  );
}

function QuickViewActionsBar({ group, onEdit, onArchive, onRestore, onDelete, busy }: QuickViewActions & { group: Group }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
      <Button type="button" onClick={() => onEdit(group)}>
        <Edit3 data-icon="inline-start" />
        {t('editGroup')}
      </Button>
      {group.isArchived ? (
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onRestore(group)}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ArchiveRestore data-icon="inline-start" />}
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
          {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
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
      <SheetContent aria-describedby={undefined} className="flex flex-col gap-0 p-0 sm:max-w-md" onKeyDown={handleKeyDown}>
        {shown ? <>
          <QuickViewHeader group={shown} todayKey={todayKey} position={position} onPrevious={onPrevious} onNext={onNext} />
          <QuickViewBody group={shown} rooms={rooms} todayKey={todayKey} />
          <QuickViewActionsBar group={shown} {...actions} />
        </> : null}
      </SheetContent>
    </Sheet>
  );
}
