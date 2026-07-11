import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ArrowRight,
  MoreHorizontal,
  Phone,
  Send,
  Archive,
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
import { leadMessageTarget, primaryVisibleLeadPhone } from '@/lib/leadContact';
import {
  finishOptimisticChange,
  incomingValueChangedSinceStart,
  reconcileOptimisticItems,
  type OptimisticChange,
} from '@/lib/optimisticReconciliation';
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
  phone?: string | null;
  messenger?: string | null;
  courseName?: string;
  sourceName?: string;
  sourceChannel?: string | null;
  managerId?: number | null;
  managerName?: string | null;
  comment?: string | null;
  studentAge?: number;
  expectedPaymentUzs?: number;
  offerPriceUzs?: number;
  statusCode: string;
}

interface KanbanBoardProps {
  statuses: readonly KanbanStatus[];
  leads: KanbanLead[];
  onStatusChange: (leadId: number, statusCode: string) => boolean | void | Promise<boolean | void>;
  onQuickAction?: (action: 'qualify' | 'payment' | 'call' | 'message', lead: KanbanLead) => void;
  onArchiveLead?: (lead: KanbanLead) => void;
  onLeadClick?: (lead: KanbanLead) => void;
  isPending?: boolean;
  showPaymentAction?: boolean;
  showManager?: boolean;
}

const reconcileKanbanLeads = (
  incoming: KanbanLead[],
  pending: ReadonlyMap<number, OptimisticChange<string>>,
) => reconcileOptimisticItems(
  incoming,
  pending,
  (lead) => lead.id,
  (lead) => lead.statusCode,
  (lead, statusCode) => ({ ...lead, statusCode }),
);

interface LeadCardContentProps {
  lead: KanbanLead;
  currentStatus: KanbanStatus;
  onQuickAction?: KanbanBoardProps['onQuickAction'];
  onArchiveLead?: KanbanBoardProps['onArchiveLead'];
  isPending?: boolean;
  showPaymentAction: boolean;
  showManager: boolean;
  t: (key: TranslationKey) => string;
}

function LeadCardContent({
  lead,
  currentStatus,
  onQuickAction,
  onArchiveLead,
  isPending,
  showPaymentAction,
  showManager,
  t,
}: LeadCardContentProps) {
  const canQualify = currentStatus.code === 'new_request' || currentStatus.code === 'first_contact';
  const visiblePhone = primaryVisibleLeadPhone(lead);
  const canCall = Boolean(visiblePhone);
  const canMessage = Boolean(leadMessageTarget(lead));
  const canArchive = currentStatus.code !== 'paid';
  const stopCardInteraction = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
            {lead.contactName}
          </p>
          {visiblePhone ? <div className="truncate text-xs text-muted-foreground">{visiblePhone}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 opacity-50 transition-opacity group-hover:opacity-100"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal />
                <span className="sr-only">{t('actions')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48"
              onPointerDown={stopCardInteraction}
              onMouseDown={stopCardInteraction}
              onTouchStart={stopCardInteraction}
              onClick={stopCardInteraction}
            >
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => onQuickAction?.('call', lead)} disabled={!canCall}>
                  <Phone /> {t('call')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onQuickAction?.('message', lead)} disabled={!canMessage}>
                  <Send /> {t('write')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {onArchiveLead && canArchive ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => onArchiveLead(lead)} disabled={isPending}>
                      <Archive /> {t('sendToArchive')}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {lead.courseName ? <Badge variant="secondary">{lead.courseName}</Badge> : null}
        {lead.sourceName ? <Badge variant="outline">{lead.sourceName}</Badge> : null}
        {lead.studentAge ? <Badge variant="outline">{lead.studentAge} {t('years')}</Badge> : null}
        {showManager && lead.managerName ? <Badge variant="outline">{t('managerLabel')} {lead.managerName}</Badge> : null}
      </div>

      <div
        className="mt-3 flex flex-wrap gap-1"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
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

interface DraggableLeadCardProps extends LeadCardContentProps {
  onLeadClick?: KanbanBoardProps['onLeadClick'];
}

function DraggableLeadCard(props: DraggableLeadCardProps) {
  const { lead, currentStatus, isPending, t, onLeadClick } = props;
  const comment = lead.comment?.trim();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `lead-${lead.id}`,
    data: { leadId: lead.id, statusCode: currentStatus.code },
    disabled: isPending,
  });

  const card = (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        'group cursor-grab rounded-lg border border-border/80 bg-card p-3 shadow-2xs outline-none transition-[box-shadow,border-color,opacity] duration-200 hover:border-border hover:shadow-md active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isDragging && 'opacity-30',
      )}
      aria-label={`${lead.contactName}. ${t('openLead')}`}
      {...attributes}
      {...listeners}
      onClick={() => onLeadClick?.(lead)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onLeadClick?.(lead);
        listeners?.onKeyDown?.(event);
      }}
    >
      <LeadCardContent {...props} />
    </div>
  );

  if (!comment) return card;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-80 whitespace-pre-wrap break-words leading-relaxed"
      >
        {comment}
      </TooltipContent>
    </Tooltip>
  );
}

interface KanbanColumnProps {
  status: KanbanStatus;
  leads: KanbanLead[];
  onQuickAction?: KanbanBoardProps['onQuickAction'];
  onArchiveLead?: KanbanBoardProps['onArchiveLead'];
  isPending?: boolean;
  showPaymentAction: boolean;
  showManager: boolean;
  t: (key: TranslationKey) => string;
  onLeadClick?: KanbanBoardProps['onLeadClick'];
}

function KanbanColumn({
  status,
  leads,
  onQuickAction,
  onArchiveLead,
  isPending,
  showPaymentAction,
  showManager,
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
        'flex h-[calc(100dvh-15rem)] min-h-[26rem] max-h-[72rem] w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-muted/40 transition-[border-color,background-color,box-shadow]',
        isOver && 'border-primary bg-primary/5 shadow-md',
      )}
    >
      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/95 p-4 backdrop-blur-sm">
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

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {leads.map((lead) => (
          <DraggableLeadCard
            key={lead.id}
            lead={lead}
            currentStatus={status}
            onQuickAction={onQuickAction}
            onArchiveLead={onArchiveLead}
            isPending={isPending}
            showPaymentAction={showPaymentAction}
            showManager={showManager}
            t={t}
            onLeadClick={onLeadClick}
          />
        ))}
        {leads.length === 0 ? (
          <div className="flex min-h-56 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/45 px-5 py-8 text-center">
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
  onArchiveLead,
  onLeadClick,
  isPending,
  showPaymentAction = true,
  showManager = false,
}: KanbanBoardProps) {
  const { t } = useTranslation();
  const [boardLeads, setBoardLeads] = useState(leads);
  const [activeLeadId, setActiveLeadId] = useState<number | null>(null);
  const latestLeadsRef = useRef(leads);
  const pendingMovesRef = useRef(new Map<number, OptimisticChange<string>>());
  const nextMoveTokenRef = useRef(0);
  latestLeadsRef.current = leads;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Tab],
      },
    }),
  );

  useEffect(() => {
    setBoardLeads(reconcileKanbanLeads(leads, pendingMovesRef.current));
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
    const baselineStatusCode = latestLeadsRef.current.find((item) => item.id === leadId)?.statusCode
      ?? lead.statusCode;
    const token = ++nextMoveTokenRef.current;
    pendingMovesRef.current.set(leadId, {
      token,
      value: statusCode,
      baselineValue: baselineStatusCode,
    });

    setBoardLeads((current) => current.map((item) => (
      item.id === leadId ? { ...item, statusCode } : item
    )));

    const finishMove = (accepted: boolean) => {
      const change = finishOptimisticChange(pendingMovesRef.current, leadId, token);
      if (!change) return;

      const latestLead = latestLeadsRef.current.find((item) => item.id === leadId);
      if (!accepted || incomingValueChangedSinceStart(latestLead, change, (item) => item.statusCode)) {
        setBoardLeads(reconcileKanbanLeads(latestLeadsRef.current, pendingMovesRef.current));
      }
    };

    Promise.resolve()
      .then(() => onStatusChange(leadId, statusCode))
      .then((accepted) => {
        finishMove(accepted !== false);
      })
      .catch(() => {
        finishMove(false);
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
    <div className="flex min-w-0 max-w-full flex-1 flex-col gap-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveLeadId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="-mx-2 min-w-0 max-w-full flex-1 overflow-x-auto overscroll-x-contain pb-2">
          <div className="flex min-h-full min-w-max items-stretch gap-4 px-2">
            {statuses.map((status) => (
              <KanbanColumn
                key={status.code}
                status={status}
                leads={boardLeads.filter((lead) => lead.statusCode === status.code)}
                onQuickAction={onQuickAction}
                onArchiveLead={onArchiveLead}
                isPending={isPending}
                showPaymentAction={showPaymentAction}
                showManager={showManager}
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
                onQuickAction={undefined}
                onArchiveLead={undefined}
                showPaymentAction={showPaymentAction}
                showManager={showManager}
                t={t}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
