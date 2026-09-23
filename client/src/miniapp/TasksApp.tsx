import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowUpRight, CalendarClock, CheckCheck, ClipboardList, ListChecks, Loader2, MessageCircle, Paperclip, Plus, RefreshCw, Search, Send, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskDetailSheet } from '@/components/ux/board/TaskDetailSheet';
import { CreateTaskDialog } from '@/components/ux/board/CreateTaskDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { boardRequest } from '@/features/board/transport';
import { hapticImpact, hapticSelect, miniRequest, telegramApp } from '@/features/board/telegram';
import { boardQueryKeys } from '@/features/board/api';
import { BOARD_COLUMNS, formatBoardDateTime, isOverdue, type BoardStatus, type BoardTasksResponse, type TaskSummary, type UserMini } from '@/lib/boardTypes';
import { cn } from '@/lib/utils';
import { academyDateInputValue, academyToday } from '@/lib/localeFormat';

type TaskTab = 'mine' | 'assigned' | 'archive';
type QuickFilter = 'all' | Exclude<BoardStatus, 'accepted'>;
type TaskGroup = 'review' | 'overdue' | 'today' | 'other' | 'done';

const PULL_THRESHOLD = 72;
const PRIORITY_RANK = { urgent: 0, normal: 1, low: 2 } as const;

function isDueToday(task: TaskSummary): boolean {
  if (!task.dueAt || task.status === 'done' || task.status === 'accepted' || isOverdue(task)) return false;
  return academyDateInputValue(task.dueAt) === academyToday();
}

function taskGroup(task: TaskSummary, tab: TaskTab): TaskGroup {
  if (task.status === 'done') return tab === 'assigned' ? 'review' : 'done';
  if (isOverdue(task)) return 'overdue';
  if (isDueToday(task)) return 'today';
  return 'other';
}

function sortTasks(left: TaskSummary, right: TaskSummary): number {
  const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priority) return priority;
  const due = (left.dueAt ? new Date(left.dueAt).getTime() : Infinity)
    - (right.dueAt ? new Date(right.dueAt).getTime() : Infinity);
  if (due) return due;
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function TaskSkeletons() {
  return <div className="space-y-4" aria-hidden="true">{[0, 1, 2].map((index) => <div key={index} className="space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-28 w-full rounded-2xl" /></div>)}</div>;
}

export function TasksApp() {
  const { t, language } = useTranslation();
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TaskTab>('mine');
  const [filter, setFilter] = useState<QuickFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const [taskId, setTaskId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullActive, setPullActive] = useState(false);
  const pullStart = useRef<number | null>(null);
  const counts = useRef({ mine: 0, assigned: 0 });
  const tasks = useQuery<BoardTasksResponse>({
    queryKey: [...boardQueryKeys.all, 'mini', tab === 'archive'],
    queryFn: () => boardRequest('GET', `/api/board/tasks?archived=${tab === 'archive'}`),
    enabled: Boolean(user), refetchInterval: 30_000,
  });
  const users = useQuery<UserMini[]>({ queryKey: ['mini-users'], queryFn: () => miniRequest('GET', '/users'), enabled: Boolean(user), staleTime: 60_000 });

  useEffect(() => {
    const app = telegramApp();
    if (!app || !app.isVersionAtLeast('6.1')) return;
    const back = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (creating || taskId !== null) {
      app.BackButton.show();
      app.BackButton.onClick(back);
      if (app.isVersionAtLeast('6.2')) app.enableClosingConfirmation();
    } else {
      app.BackButton.hide();
      if (app.isVersionAtLeast('6.2')) app.disableClosingConfirmation();
    }
    return () => { app.BackButton.offClick(back); app.BackButton.hide(); };
  }, [creating, taskId]);

  if (isLoading) return <div className="mini-center" role="status" aria-label={t('loading')}><Loader2 className="size-7 animate-spin" /></div>;
  if (!user) return <div className="mini-center" role="alert"><p>{t('miniTasksSessionExpired')}</p></div>;

  const owned = (tasks.data?.tasks ?? []).filter((task) => tab === 'mine' ? task.assignee?.id === user.id
    : tab === 'assigned' ? task.creator?.id === user.id : task.creator?.id === user.id || task.assignee?.id === user.id);
  const active = tab === 'archive' ? owned : owned.filter((task) => task.status !== 'accepted');
  const visible = active.filter((task) => (filter === 'all' || task.status === filter)
    && (!deferredSearch || `${task.title} ${task.description ?? ''} ${task.assignee?.fullName ?? ''} ${task.creator?.fullName ?? ''}`.toLocaleLowerCase().includes(deferredSearch)));
  const heading = tab === 'mine' ? t('myTasks') : tab === 'assigned' ? t('miniTasksAssigned') : t('taskArchive');
  const sections = tab === 'assigned'
    ? [{ group: 'review', label: t('taskDone') }, { group: 'overdue', label: t('taskStateOverdue') }, { group: 'today', label: t('today') }, { group: 'other', label: t('miniTasksOther') }]
    : [{ group: 'overdue', label: t('taskStateOverdue') }, { group: 'today', label: t('today') }, { group: 'other', label: t('miniTasksOther') }, { group: 'done', label: t('taskDone') }];
  const filteredSections = sections.map((section) => ({ ...section, tasks: visible.filter((task) => taskGroup(task, tab) === section.group).sort(sortTasks) }))
    .filter((section) => section.tasks.length > 0);
  const statusLabel = (value: string) => {
    if (value === 'accepted') return t('colAccepted');
    const column = BOARD_COLUMNS.find((entry) => entry.status === value);
    return column ? t(column.labelKey) : value;
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
    void users.refetch();
  };
  const changeTab = (next: TaskTab) => {
    hapticSelect();
    setTab(next);
    setFilter('all');
    setSearch('');
  };
  const openTask = (id: number) => { hapticSelect(); setTaskId(id); };

  const onTouchStart = (event: React.TouchEvent) => {
    if (window.scrollY > 0 || tasks.isFetching) return;
    pullStart.current = event.touches[0].clientY;
  };
  const onTouchMove = (event: React.TouchEvent) => {
    if (pullStart.current === null || tasks.isFetching) return;
    const distance = event.touches[0].clientY - pullStart.current;
    if (distance <= 0) { setPullDistance(0); setPullActive(false); return; }
    setPullDistance(Math.min(distance * 0.4, PULL_THRESHOLD * 1.5));
    setPullActive(distance * 0.4 >= PULL_THRESHOLD);
  };
  const onTouchEnd = () => {
    if (pullStart.current === null) return;
    if (pullActive) { hapticImpact('medium'); refresh(); }
    setPullDistance(0); setPullActive(false); pullStart.current = null;
  };

  if (tab !== 'archive' && tasks.data?.tasks) {
    counts.current = {
      mine: tasks.data.tasks.filter((task) => task.assignee?.id === user.id && task.status !== 'accepted').length,
      assigned: tasks.data.tasks.filter((task) => task.creator?.id === user.id && task.status !== 'accepted').length,
    };
  }

  const renderCard = (task: TaskSummary) => {
    const person = tab === 'mine' ? task.creator : task.assignee;
    const personLabel = tab === 'mine' ? t('creatorLabel') : t('assigneeLabel');
    return <button key={task.id} type="button" className="mini-task-card" data-color={task.color ?? undefined} onClick={() => openTask(task.id)}>
      <span className="mini-task-card-top"><span className="mini-task-status">{statusLabel(task.status)}</span>{task.priority === 'urgent' ? <span className="mini-task-urgent">{t('priorityUrgent')}</span> : null}</span>
      <span className="mini-task-title">{task.title}</span>
      <span className="mini-task-meta">
        <span className={cn('mini-task-date', isOverdue(task) && 'mini-task-date-overdue')}><CalendarClock className="size-4 shrink-0" />{task.status === 'accepted' && task.acceptedAt
          ? `${t('taskAcceptedOn')} ${formatBoardDateTime(task.acceptedAt, language)}`
          : task.dueAt ? formatBoardDateTime(task.dueAt, language) : t('miniTasksNoDeadline')}</span>
        <span className="mini-task-person"><UserRound className="size-4 shrink-0" />{personLabel}: {person?.fullName ?? t('unassigned')}</span>
      </span>
      {task.checklistTotal || task.commentCount || task.attachmentCount ? <span className="mini-task-stats">
        {task.checklistTotal ? <span aria-label={`${t('checklistLabel')}: ${task.checklistDone}/${task.checklistTotal}`}><ListChecks className="size-3.5" />{task.checklistDone}/{task.checklistTotal}</span> : null}
        {task.commentCount ? <span aria-label={`${t('commentsLabel')}: ${task.commentCount}`}><MessageCircle className="size-3.5" />{task.commentCount}</span> : null}
        {task.attachmentCount ? <span aria-label={`${t('attachmentsLabel')}: ${task.attachmentCount}`}><Paperclip className="size-3.5" />{task.attachmentCount}</span> : null}
      </span> : null}
      <ArrowUpRight className="mini-task-arrow size-4" aria-hidden="true" />
    </button>;
  };

  return <div className="mini-shell" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
    <div className="mini-pull" style={{ height: pullDistance }} aria-hidden="true">{pullDistance > 0 ? <RefreshCw className={cn('size-5', tasks.isFetching && 'animate-spin', !tasks.isFetching && !pullActive && 'opacity-50')} /> : null}</div>
    <header className="mini-header">
      <div className="mini-header-top"><p className="truncate text-sm text-muted-foreground">{user.fullName}</p><Button variant="ghost" size="icon" aria-label={t('miniTasksRefresh')} onClick={refresh} disabled={tasks.isFetching}><RefreshCw className={cn('size-5', tasks.isFetching && 'animate-spin')} /></Button></div>
      <div className="mini-title-row"><div className="min-w-0"><h1>{heading}</h1><p className="mini-task-total">{t('miniTasksTasksCount')}: {active.length}</p></div><Button className="mini-new-task" disabled={!users.data || users.isLoading} aria-label={users.isLoading ? t('miniTasksPreparing') : t('createTask')} onClick={() => { hapticImpact('light'); setCreating(true); }}>{users.isLoading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}<span>{t('newTask')}</span></Button></div>
      <div className="mini-search"><Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted-foreground" /><Input className="h-11 pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('miniTasksSearch')} aria-label={t('miniTasksSearch')} type="search" /></div>
      {tab !== 'archive' ? <div className="mini-filters" role="group" aria-label={t('miniTasksFilters')}>
        {([
          ['all', t('allStatuses'), active.length],
          ...BOARD_COLUMNS.map((column) => [column.status, t(column.labelKey), active.filter((task) => task.status === column.status).length] as [QuickFilter, string, number]),
        ] as [QuickFilter, string, number][]).map(([value, label, count]) => <button key={value} type="button" className="mini-filter" aria-pressed={filter === value} onClick={() => { hapticSelect(); setFilter(value); }}>
          <span>{label}</span><span className="mini-filter-count">{count}</span>
        </button>)}
      </div> : null}
    </header>
    <main className="mini-content" aria-busy={tasks.isFetching}>
      {tasks.isError || users.isError ? <div role="alert" className="rounded-xl border border-destructive/30 p-4"><p>{t('miniTasksUnavailable')}</p><Button variant="outline" className="mt-3" onClick={refresh}>{t('retry')}</Button></div> : null}
      {tasks.isLoading ? <TaskSkeletons /> : visible.length ? tab === 'archive'
        ? <div className="mini-task-list">{visible.sort((a, b) => new Date(b.acceptedAt ?? b.updatedAt).getTime() - new Date(a.acceptedAt ?? a.updatedAt).getTime()).map(renderCard)}</div>
        : filteredSections.map((section) => <section key={section.group} className="mini-section"><h2>{section.label}<span>{section.tasks.length}</span></h2><div className="mini-task-list">{section.tasks.map(renderCard)}</div></section>)
        : !tasks.isError ? <div className="mini-center mini-empty"><CheckCheck className="size-10 text-muted-foreground" /><h2 className="text-lg font-medium">{search || filter !== 'all' ? t('miniTasksNoResults') : tab === 'archive' ? t('taskArchiveEmpty') : t('miniTasksEmpty')}</h2>{search || filter !== 'all' ? <Button variant="outline" onClick={() => { setSearch(''); setFilter('all'); }}>{t('miniTasksClearFilters')}</Button> : <p className="text-sm text-muted-foreground">{tab === 'archive' ? t('taskArchiveEmptyDescription') : t('miniTasksEmptyHint')}</p>}</div> : null}
    </main>
    <nav className="mini-navigation" aria-label={t('miniTasksNavigation')}><div className="mini-navigation-inner">
      <button type="button" aria-label={t('myTasks')} aria-current={tab === 'mine' ? 'page' : undefined} onClick={() => changeTab('mine')}>
        <span className="relative"><ClipboardList className="size-5" />{counts.current.mine > 0 ? <span className="mini-badge" aria-hidden="true">{counts.current.mine > 99 ? '99+' : counts.current.mine}</span> : null}</span><span>{t('myTasks')}</span>
      </button>
      <button type="button" aria-label={t('miniTasksAssigned')} aria-current={tab === 'assigned' ? 'page' : undefined} onClick={() => changeTab('assigned')}>
        <span className="relative"><Send className="size-5" />{counts.current.assigned > 0 ? <span className="mini-badge" aria-hidden="true">{counts.current.assigned > 99 ? '99+' : counts.current.assigned}</span> : null}</span><span>{t('miniTasksAssigned')}</span>
      </button>
      <button type="button" aria-label={t('taskArchive')} aria-current={tab === 'archive' ? 'page' : undefined} onClick={() => changeTab('archive')}><Archive className="size-5" /><span>{t('taskArchive')}</span></button>
    </div></nav>
    <CreateTaskDialog open={creating} onOpenChange={setCreating} onCreated={() => changeTab('assigned')} users={users.data ?? []} currentUser={user} canAssignUsers miniMode />
    <TaskDetailSheet open={taskId !== null} taskId={taskId} onOpenChange={(open) => { if (!open) setTaskId(null); }} users={users.data ?? []} tasksOnly />
  </div>;
}
