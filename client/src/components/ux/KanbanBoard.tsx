import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  Clock3,
  GripVertical,
  MoreHorizontal,
  Phone,
  Send,
  UserPlus,
  Wallet,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface KanbanStatus {
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

interface KanbanLead {
  id: number;
  contactName: string;
  phone?: string;
  courseName?: string;
  sourceName?: string;
  managerName?: string;
  studentAge?: number;
  expectedPaymentUzs?: number;
  offerPriceUzs?: number;
  statusCode: string;
}

interface KanbanBoardProps {
  statuses: readonly KanbanStatus[];
  leads: KanbanLead[];
  onStatusChange: (leadId: number, statusCode: string) => boolean | void | Promise<boolean | void>;
  onQuickAction?: (action: 'qualify' | 'warm' | 'payment' | 'call' | 'message', lead: KanbanLead) => void;
  onLeadClick?: (lead: KanbanLead) => void;
  isPending?: boolean;
  showPaymentAction?: boolean;
}

interface LeadCardContentProps {
  lead: KanbanLead;
  currentStatus: KanbanStatus;
  statuses: readonly KanbanStatus[];
  onMove: (leadId: number, statusCode: string) => void;
  onQuickAction?: KanbanBoardProps['onQuickAction'];
  isPending?: boolean;
  showPaymentAction: boolean;
  t: (key: TranslationKey) => string;
  onLeadClick?: KanbanBoardProps['onLeadClick'];
  dragHandle?: React.ReactNode;
}

function LeadCardContent({
  lead,
  currentStatus,
  statuses,
  onMove,
  onQuickAction,
  isPending,
  showPaymentAction,
  t,
  onLeadClick,
  dragHandle,
}: LeadCardContentProps) {
  const nextStatuses = statuses.filter((status) => status.sortOrder > currentStatus.sortOrder);
  const prevStatuses = currentStatus.code === 'paid'
    ? []
    : statuses.filter((status) => status.sortOrder < currentStatus.sortOrder);
  const canQualify = currentStatus.code === 'new_request' || currentStatus.code === 'first_contact';
  const canMoveToWarmBase = currentStatus.code !== 'paid' && currentStatus.code !== 'not_now';

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            className="block max-w-full truncate text-left text-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => onLeadClick?.(lead)}
          >
            {lead.contactName}
          </button>
          {lead.phone ? <div className="truncate text-xs text-muted-foreground">{lead.phone}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {dragHandle}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 opacity-50 transition-opacity group-hover:opacity-100"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <MoreHorizontal />
                <span className="sr-only">{t('actions')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                {nextStatuses.slice(0, 3).map((nextStatus) => (
                  <DropdownMenuItem
                    key={nextStatus.code}
                    onClick={() => onMove(lead.id, nextStatus.code)}
                    disabled={isPending}
                  >
                    <ArrowRight />
                    {t('moveTo')} {nextStatus.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              {prevStatuses.length > 0 && nextStatuses.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                {prevStatuses.slice(-2).map((prevStatus) => (
                  <DropdownMenuItem
                    key={prevStatus.code}
                    onClick={() => onMove(lead.id, prevStatus.code)}
                    disabled={isPending}
                  >
                    {t('returnTo')} {prevStatus.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => onQuickAction?.('call', lead)}>
                  <Phone /> {t('call')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onQuickAction?.('message', lead)}>
                  <Send /> {t('write')}
                </DropdownMenuItem>
                {canMoveToWarmBase ? (
                  <DropdownMenuItem
                    onClick={() => onQuickAction?.('warm', lead)}
                    disabled={isPending}
                  >
                    <Clock3 /> {t('warmBase')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {lead.courseName ? <Badge variant="secondary">{lead.courseName}</Badge> : null}
        {lead.sourceName ? <Badge variant="outline">{lead.sourceName}</Badge> : null}
        {lead.studentAge ? <Badge variant="outline">{lead.studentAge} {t('years')}</Badge> : null}
      </div>

      <div
        className="mt-3 flex flex-wrap gap-1"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {nextStatuses.slice(0, 1).map((nextStatus) => (
          <Button
            key={nextStatus.code}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onMove(lead.id, nextStatus.code)}
            disabled={isPending}
          >
            <ArrowRight data-icon="inline-start" /> {nextStatus.name}
          </Button>
        ))}
        {showPaymentAction ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onQuickAction?.('payment', lead)}
            disabled={isPending}
          >
            <Wallet data-icon="inline-start" /> {t('payment')}
          </Button>
        ) : null}
        {canQualify ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onQuickAction?.('qualify', lead)}
            disabled={isPending}
          >
            <UserPlus data-icon="inline-start" /> {t('qualify')}
          </Button>
        ) : null}
      </div>
    </>
  );
}

interface DraggableLeadCardProps extends Omit<LeadCardContentProps, 'dragHandle'> {}

function DraggableLeadCard(props: DraggableLeadCardProps) {
  const { lead, currentStatus, isPending, t, onLeadClick } = props;
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `lead-${lead.id}`,
    data: { leadId: lead.id, statusCode: currentStatus.code },
    disabled: isPending,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        'group rounded-lg border border-border/80 bg-card p-3 shadow-2xs transition-[box-shadow,border-color,opacity] duration-200 hover:border-border hover:shadow-md',
        isDragging && 'opacity-30',
      )}
      onDoubleClick={() => onLeadClick?.(lead)}
    >
      <LeadCardContent
        {...props}
        dragHandle={(
          <Button
            ref={setActivatorNodeRef}
            variant="ghost"
            size="icon"
            className="size-7 cursor-grab text-muted-foreground active:cursor-grabbing"
            aria-label={t('dragLeadHint')}
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </Button>
        )}
      />
    </div>
  );
}

interface KanbanColumnProps {
  status: KanbanStatus;
  leads: KanbanLead[];
  statuses: readonly KanbanStatus[];
  onMove: (leadId: number, statusCode: string) => void;
  onQuickAction?: KanbanBoardProps['onQuickAction'];
  isPending?: boolean;
  showPaymentAction: boolean;
  t: (key: TranslationKey) => string;
  onLeadClick?: KanbanBoardProps['onLeadClick'];
}

function KanbanColumn({
  status,
  leads,
  statuses,
  onMove,
  onQuickAction,
  isPending,
  showPaymentAction,
  t,
  onLeadClick,
}: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `status-${status.code}`,
    data: { statusCode: status.code },
    disabled: isPending,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex max-h-[calc(100vh-260px)] w-80 shrink-0 flex-col rounded-xl border border-border/70 bg-muted/40 transition-[border-color,background-color,box-shadow]',
        isOver && 'border-primary bg-primary/5 shadow-md',
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 p-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: status.color }}
          />
          <span className="truncate text-sm font-semibold text-foreground">{status.name}</span>
        </div>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-background px-1.5 text-xs font-semibold text-muted-foreground shadow-2xs">
          {leads.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 pt-0">
        {leads.map((lead) => (
          <DraggableLeadCard
            key={lead.id}
            lead={lead}
            currentStatus={status}
            statuses={statuses}
            onMove={onMove}
            onQuickAction={onQuickAction}
            isPending={isPending}
            showPaymentAction={showPaymentAction}
            t={t}
            onLeadClick={onLeadClick}
          />
        ))}
        {leads.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
              <ArrowRight className="text-muted-foreground/40" />
            </div>
            <p className="text-xs text-muted-foreground">{t('noLeadsInStage')}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function KanbanBoard({
  statuses,
  leads,
  onStatusChange,
  onQuickAction,
  onLeadClick,
  isPending,
  showPaymentAction = true,
}: KanbanBoardProps) {
  const { t } = useTranslation();
  const [boardLeads, setBoardLeads] = useState(leads);
  const [activeLeadId, setActiveLeadId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    setBoardLeads(leads);
  }, [leads]);

  const statusesByCode = useMemo(
    () => new Map(statuses.map((status) => [status.code, status])),
    [statuses],
  );

  const activeLead = activeLeadId === null
    ? null
    : boardLeads.find((lead) => lead.id === activeLeadId) ?? null;

  const moveLead = useCallback((leadId: number, statusCode: string) => {
    const lead = boardLeads.find((item) => item.id === leadId);
    if (!lead || lead.statusCode === statusCode || !statusesByCode.has(statusCode)) return;
    const previousStatusCode = lead.statusCode;

    setBoardLeads((current) => current.map((item) => (
      item.id === leadId ? { ...item, statusCode } : item
    )));

    Promise.resolve(onStatusChange(leadId, statusCode))
      .then((accepted) => {
        if (accepted === false) {
          setBoardLeads((current) => current.map((item) => (
            item.id === leadId && item.statusCode === statusCode
              ? { ...item, statusCode: previousStatusCode }
              : item
          )));
        }
      })
      .catch(() => {
        setBoardLeads((current) => current.map((item) => (
          item.id === leadId && item.statusCode === statusCode
            ? { ...item, statusCode: previousStatusCode }
            : item
        )));
      });
  }, [boardLeads, onStatusChange, statusesByCode]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveLeadId(Number(event.active.data.current?.leadId));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const leadId = Number(event.active.data.current?.leadId);
    const statusCode = String(event.over?.data.current?.statusCode ?? '');
    setActiveLeadId(null);

    if (Number.isFinite(leadId) && statusCode) {
      moveLead(leadId, statusCode);
    }
  }, [moveLead]);

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <GripVertical />
        <span>{t('dragLeadHint')}</span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveLeadId(null)}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements: {
            onDragStart: () => t('dragLeadHint'),
            onDragOver: () => t('dragLeadHint'),
            onDragEnd: ({ over }) => over ? t('dragLeadAnnouncement') : t('dragLeadHint'),
            onDragCancel: () => t('dragLeadHint'),
          },
        }}
      >
        <div className="-mx-2 min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-2">
          <div className="flex min-w-max gap-4 px-2">
            {statuses.map((status) => (
              <KanbanColumn
                key={status.code}
                status={status}
                leads={boardLeads.filter((lead) => lead.statusCode === status.code)}
                statuses={statuses}
                onMove={moveLead}
                onQuickAction={onQuickAction}
                isPending={isPending}
                showPaymentAction={showPaymentAction}
                t={t}
                onLeadClick={onLeadClick}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeLead ? (
            <div className="w-80 rounded-lg border border-primary/30 bg-card p-3 shadow-xl">
              <LeadCardContent
                lead={activeLead}
                currentStatus={statusesByCode.get(activeLead.statusCode) ?? statuses[0]}
                statuses={statuses}
                onMove={() => undefined}
                onQuickAction={undefined}
                showPaymentAction={showPaymentAction}
                t={t}
                onLeadClick={onLeadClick}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
