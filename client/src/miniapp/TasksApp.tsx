import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CheckCheck, ClipboardList, Loader2, Plus, RefreshCw, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskCard } from '@/components/ux/board/TaskCard';
import { TaskDetailSheet } from '@/components/ux/board/TaskDetailSheet';
import { CreateTaskDialog } from '@/components/ux/board/CreateTaskDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { boardRequest } from '@/features/board/transport';
import { hapticImpact, hapticNotify, hapticSelect, miniRequest, telegramApp } from '@/features/board/telegram';
import { boardQueryKeys } from '@/features/board/api';
import { BOARD_COLUMNS, type BoardTasksResponse, type UserMini } from '@/lib/boardTypes';
import { cn } from '@/lib/utils';

const PULL_THRESHOLD = 72;

function TaskSkeletons() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function TasksApp() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'mine' | 'assigned' | 'archive'>('mine');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const [status, setStatus] = useState('all');
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
    // Let Radix close the topmost modal. CreateTaskDialog can still ask about unsaved files.
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
  const visible = owned.filter((task) => (tab === 'archive' || status === 'all' || task.status === status)
    && (!deferredSearch || `${task.title} ${task.description ?? ''} ${task.assignee?.fullName ?? ''}`.toLocaleLowerCase().includes(deferredSearch)));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
    void users.refetch();
  };
  const heading = tab === 'mine' ? t('myTasks') : tab === 'assigned' ? t('miniTasksAssigned') : t('taskArchive');
  // An unknown status must not crash the list — show the raw value as a fallback.
  const statusLabel = (value: string) => {
    if (value === 'accepted') return t('colAccepted');
    const column = BOARD_COLUMNS.find((entry) => entry.status === value);
    return column ? t(column.labelKey) : value;
  };

  // Pull-to-refresh on the scrolled-to-top list; native Telegram refresh stays
  // available through the header button and background polling.
  const onTouchStart = (event: React.TouchEvent) => {
    if (window.scrollY > 0 || tasks.isFetching) return;
    const touch = event.touches[0];
    pullStart.current = touch.clientY;
  };
  const onTouchMove = (event: React.TouchEvent) => {
    if (pullStart.current === null || tasks.isFetching) return;
    const distance = event.touches[0].clientY - pullStart.current;
    if (distance <= 0) { setPullDistance(0); setPullActive(false); return; }
    // Slacken the drag so the indicator feels elastic, not rigid.
    setPullDistance(Math.min(distance * 0.4, PULL_THRESHOLD * 1.5));
    setPullActive(distance * 0.4 >= PULL_THRESHOLD);
  };
  const onTouchEnd = () => {
    if (pullStart.current === null) return;
    if (pullActive) { hapticImpact('medium'); refresh(); }
    setPullDistance(0); setPullActive(false); pullStart.current = null;
  };

  if (tab !== 'archive' && tasks.data?.tasks && user) {
    counts.current = {
      mine: tasks.data.tasks.filter((task) => task.assignee?.id === user.id && task.status !== 'accepted').length,
      assigned: tasks.data.tasks.filter((task) => task.creator?.id === user.id && task.status !== 'accepted').length,
    };
  }

  return <div className="mini-shell" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
    <div className="mini-pull" style={{ height: pullDistance }} aria-hidden="true">
      {pullDistance > 0 ? (
        <RefreshCw className={cn('size-5', tasks.isFetching && 'animate-spin', !tasks.isFetching && !pullActive && 'opacity-50')} />
      ) : null}
    </div>
    <header className="mini-header">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-sm text-muted-foreground">{user.fullName}</p><h1 className="text-2xl font-semibold tracking-tight">{heading}</h1></div>
        <Button variant="ghost" size="icon" aria-label={t('miniTasksRefresh')} onClick={refresh} disabled={tasks.isFetching}><RefreshCw className={cn('size-5', tasks.isFetching && 'animate-spin')} /></Button>
      </div>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted-foreground" /><Input className="h-11 pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('miniTasksSearch')} aria-label={t('miniTasksSearch')} type="search" /></div>
      {tab !== 'archive' ? <Select value={status} onValueChange={(value) => { hapticSelect(); setStatus(value); }}><SelectTrigger className="h-11" aria-label={t('status')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('allStatuses')}</SelectItem>{BOARD_COLUMNS.map((column) => <SelectItem key={column.status} value={column.status}>{t(column.labelKey)}</SelectItem>)}</SelectContent></Select> : null}
    </header>
    <main className="space-y-3 px-4 pb-6" aria-busy={tasks.isFetching}>
      {tasks.isError || users.isError ? <div role="alert" className="rounded-xl border border-destructive/30 p-4"><p>{t('miniTasksUnavailable')}</p><Button variant="outline" className="mt-3" onClick={refresh}>{t('retry')}</Button></div> : null}
      {tasks.isLoading ? <TaskSkeletons /> : visible.length ? visible.map((task) => <div key={task.id} className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground"><span>{statusLabel(task.status)}</span><span className="truncate">{task.assignee?.fullName ?? t('unassigned')}</span></div>
        <TaskCard task={task} onClick={() => { hapticSelect(); setTaskId(task.id); }} />
      </div>) : !tasks.isError ? <div className="mini-center"><CheckCheck className="size-10 text-muted-foreground" /><h2 className="text-lg font-medium">{t('miniTasksEmpty')}</h2><p className="text-sm text-muted-foreground">{t('miniTasksEmptyHint')}</p></div> : null}
    </main>
    <div className="mini-create"><Button className="size-12 rounded-full p-0 shadow-lg transition-transform active:scale-95" disabled={!users.data || users.isLoading} aria-label={users.isLoading ? t('miniTasksPreparing') : t('createTask')} onClick={() => { hapticImpact('light'); setCreating(true); }}>{users.isLoading ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-6" />}</Button></div>
    <nav className="mini-navigation bg-background border-t border-border" aria-label={t('miniTasksNavigation')}>
      <div className="mini-navigation-inner">
        <button type="button" aria-label={t('myTasks')} aria-current={tab === 'mine' ? 'page' : undefined} onClick={() => { hapticSelect(); setTab('mine'); }}>
          <div className="relative">
            <ClipboardList className="size-5" />
            {counts.current.mine > 0 ? (
              <span className="mini-badge" aria-hidden="true">{counts.current.mine > 99 ? '99+' : counts.current.mine}</span>
            ) : null}
          </div>
          <span>{t('myTasks')}</span>
        </button>
        <button type="button" aria-label={t('miniTasksAssigned')} aria-current={tab === 'assigned' ? 'page' : undefined} onClick={() => { hapticSelect(); setTab('assigned'); }}>
          <div className="relative">
            <Send className="size-5" />
            {counts.current.assigned > 0 ? (
              <span className="mini-badge" aria-hidden="true">{counts.current.assigned > 99 ? '99+' : counts.current.assigned}</span>
            ) : null}
          </div>
          <span>{t('miniTasksAssigned')}</span>
        </button>
        <button type="button" aria-label={t('taskArchive')} aria-current={tab === 'archive' ? 'page' : undefined} onClick={() => { hapticSelect(); setTab('archive'); }}>
          <div className="relative">
            <Archive className="size-5" />
            {tab === 'archive' && (tasks.data?.tasks?.length ?? 0) > 0 ? (
              <span className="mini-badge" aria-hidden="true">{(tasks.data?.tasks?.length ?? 0) > 99 ? '99+' : tasks.data?.tasks?.length}</span>
            ) : null}
          </div>
          <span>{t('taskArchive')}</span>
        </button>
      </div>
    </nav>
    <CreateTaskDialog open={creating} onOpenChange={setCreating} users={users.data ?? []} currentUser={user} canAssignUsers />
    <TaskDetailSheet open={taskId !== null} taskId={taskId} onOpenChange={(open) => { if (!open) setTaskId(null); }} users={users.data ?? []} tasksOnly />
  </div>;
}
