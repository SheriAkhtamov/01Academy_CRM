import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CheckCheck, ClipboardList, Loader2, Plus, RefreshCw, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TaskCard } from '@/components/ux/board/TaskCard';
import { TaskDetailSheet } from '@/components/ux/board/TaskDetailSheet';
import { CreateTaskDialog } from '@/components/ux/board/CreateTaskDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { boardRequest } from '@/features/board/transport';
import { miniRequest, telegramApp } from '@/features/board/telegram';
import { boardQueryKeys } from '@/features/board/api';
import { BOARD_COLUMNS, type BoardTasksResponse, type UserMini } from '@/lib/boardTypes';
import { cn } from '@/lib/utils';

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
  if (isLoading) return <div className="mini-center"><Loader2 className="size-7 animate-spin" aria-label={t('loading')} /></div>;
  if (!user) return <div className="mini-center"><p>{t('miniTasksSessionExpired')}</p></div>;

  const owned = (tasks.data?.tasks ?? []).filter((task) => tab === 'mine' ? task.assignee?.id === user.id
    : tab === 'assigned' ? task.creator?.id === user.id : task.creator?.id === user.id || task.assignee?.id === user.id);
  const visible = owned.filter((task) => (tab === 'archive' || status === 'all' || task.status === status)
    && (!deferredSearch || `${task.title} ${task.description ?? ''} ${task.assignee?.fullName ?? ''}`.toLocaleLowerCase().includes(deferredSearch)));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
    void users.refetch();
  };
  const heading = tab === 'mine' ? t('myTasks') : tab === 'assigned' ? t('miniTasksAssigned') : t('taskArchive');
  return <div className="mini-shell">
    <header className="mini-header">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-sm text-muted-foreground">{user.fullName}</p><h1 className="text-2xl font-semibold tracking-tight">{heading}</h1></div>
        <Button variant="ghost" size="icon" aria-label={t('miniTasksRefresh')} onClick={refresh} disabled={tasks.isFetching}><RefreshCw className={cn('size-5', tasks.isFetching && 'animate-spin')} /></Button>
      </div>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted-foreground" /><Input className="h-11 pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('miniTasksSearch')} aria-label={t('miniTasksSearch')} type="search" /></div>
      {tab !== 'archive' ? <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-11" aria-label={t('status')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('allStatuses')}</SelectItem>{BOARD_COLUMNS.map((column) => <SelectItem key={column.status} value={column.status}>{t(column.labelKey)}</SelectItem>)}</SelectContent></Select> : null}
    </header>
    <main className="space-y-3 px-4 pb-6" aria-busy={tasks.isFetching}>
      {tasks.isError || users.isError ? <div role="alert" className="rounded-xl border border-destructive/30 p-4"><p>{t('miniTasksUnavailable')}</p><Button variant="outline" className="mt-3" onClick={refresh}>{t('retry')}</Button></div> : null}
      {tasks.isLoading ? <div className="mini-center"><Loader2 className="size-7 animate-spin" aria-label={t('loading')} /></div> : visible.length ? visible.map((task) => <div key={task.id} className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground"><span>{task.status === 'accepted' ? t('colAccepted') : t(BOARD_COLUMNS.find((column) => column.status === task.status)!.labelKey)}</span><span className="truncate">{task.assignee?.fullName ?? t('unassigned')}</span></div>
        <TaskCard task={task} onClick={() => setTaskId(task.id)} />
      </div>) : !tasks.isError ? <div className="mini-center"><CheckCheck className="size-10 text-muted-foreground" /><h2 className="text-lg font-medium">{t('miniTasksEmpty')}</h2><p className="text-sm text-muted-foreground">{t('miniTasksEmptyHint')}</p></div> : null}
    </main>
    <div className="mini-create"><Button className="h-12 rounded-full px-5 shadow-lg" disabled={!users.data} onClick={() => setCreating(true)}><Plus className="mr-2 size-5" />{t('createTask')}</Button></div>
    <nav className="mini-navigation" aria-label={t('miniTasksNavigation')}>
      <button type="button" aria-current={tab === 'mine' ? 'page' : undefined} onClick={() => setTab('mine')}><ClipboardList className="size-5" /><span>{t('myTasks')}</span></button>
      <button type="button" aria-current={tab === 'assigned' ? 'page' : undefined} onClick={() => setTab('assigned')}><Send className="size-5" /><span>{t('miniTasksAssigned')}</span></button>
      <button type="button" aria-current={tab === 'archive' ? 'page' : undefined} onClick={() => setTab('archive')}><Archive className="size-5" /><span>{t('taskArchive')}</span></button>
    </nav>
    <CreateTaskDialog open={creating} onOpenChange={setCreating} users={users.data ?? []} currentUser={user} canAssignUsers />
    <TaskDetailSheet open={taskId !== null} taskId={taskId} onOpenChange={(open) => { if (!open) setTaskId(null); }} users={users.data ?? []} tasksOnly />
  </div>;
}
