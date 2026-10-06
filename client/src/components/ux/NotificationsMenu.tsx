import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { AlertCircle, Bell, CheckCheck, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import ConfirmDialog from '@/components/ConfirmDialog';
import { UnreadCountBadge } from '@/components/ux/UnreadCountBadge';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { notificationQueryKeys, notificationsApi } from '@/features/notifications/api';
import { notificationDestination } from '@/lib/notificationDestination';
import { requestNavigation } from '@/lib/navigationGuard';
import type { NotificationDto, NotificationPage } from '@shared/contracts/notifications';

type Pages = InfiniteData<NotificationPage, number>;
export function NotificationsMenu() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NotificationDto | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [clearError, setClearError] = useState('');
  const unread = useQuery({ queryKey: notificationQueryKeys.unread, queryFn: notificationsApi.unread, refetchInterval: 30_000, refetchOnWindowFocus: true });
  const query = useInfiniteQuery({
    queryKey: notificationQueryKeys.pages, initialPageParam: 0,
    queryFn: ({ pageParam }) => notificationsApi.page(pageParam),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: open, refetchInterval: open ? 30_000 : false, refetchOnWindowFocus: true,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const count = unread.data?.count ?? 0;
  const label = t('unreadNotificationCount').replace('{count}', String(count));
  const invalidate = () => client.invalidateQueries({ queryKey: notificationQueryKeys.all });
  const snapshot = async () => {
    await client.cancelQueries({ queryKey: notificationQueryKeys.all });
    return { pages: client.getQueryData<Pages>(notificationQueryKeys.pages), unread: client.getQueryData<{ count: number }>(notificationQueryKeys.unread) };
  };
  const restore = (previous: Awaited<ReturnType<typeof snapshot>> | undefined) => {
    if (previous?.pages) client.setQueryData(notificationQueryKeys.pages, previous.pages);
    if (previous?.unread) client.setQueryData(notificationQueryKeys.unread, previous.unread);
  };
  const updatePages = (update: (item: NotificationDto) => NotificationDto) => client.setQueryData<Pages>(notificationQueryKeys.pages,
    (current) => current ? { ...current, pages: current.pages.map((page) => ({ ...page, items: page.items.map(update) })) } : current);
  const read = useMutation({
    mutationFn: (item: NotificationDto) => notificationsApi.markRead(item.id),
    onMutate: async (item) => {
      const previous = await snapshot();
      updatePages((entry) => entry.id === item.id ? { ...entry, isRead: true } : entry);
      if (!item.isRead) client.setQueryData<{ count: number }>(notificationQueryKeys.unread, (current) => current ? { count: Math.max(0, current.count - 1) } : current);
      return previous;
    },
    onError: (error: Error, _item, previous) => { restore(previous); toast({ title: t('updateFailed'), description: error.message, variant: 'destructive' }); },
    onSettled: invalidate,
  });
  const readAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onMutate: async () => {
      const previous = await snapshot();
      updatePages((entry) => ({ ...entry, isRead: true }));
      client.setQueryData(notificationQueryKeys.unread, { count: 0 });
      return previous;
    },
    onError: (error: Error, _value, previous) => { restore(previous); toast({ title: t('updateFailed'), description: error.message, variant: 'destructive' }); },
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: notificationsApi.remove,
    onSuccess: () => { setDeleteTarget(null); void invalidate(); },
    onError: (error: Error) => setDeleteError(error.message),
  });
  const readPending = read.isPending || readAll.isPending;
  const clear = useMutation({
    mutationFn: notificationsApi.clear,
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: notificationQueryKeys.all });
      client.setQueryData<Pages>(notificationQueryKeys.pages, { pageParams: [0], pages: [{ items: [], total: 0, nextOffset: null }] });
      client.setQueryData(notificationQueryKeys.unread, { count: 0 });
      setClearOpen(false);
      void invalidate();
    },
    onError: (error: Error) => setClearError(error.message),
  });
  return <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full" aria-label={count > 0 ? label : t('notifications')}>
          <Bell className="size-5" />
          {unread.isError ? <AlertCircle aria-hidden="true" className="absolute right-0 top-0 size-3 text-destructive" /> : <UnreadCountBadge count={count} label={label} announce className="pointer-events-none absolute -right-0.5 -top-0.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))]">
        <div className="flex items-center justify-between gap-2 pr-2">
          <DropdownMenuLabel>{t('notifications')}</DropdownMenuLabel>
          <Button type="button" variant="ghost" className="h-7 px-2 text-xs" aria-label={t('clearNotifications')}
            disabled={query.isLoading || query.isError || items.length === 0 || readPending || remove.isPending || clear.isPending}
            onClick={() => { setOpen(false); setClearError(''); setClearOpen(true); }}>{t('clearNotificationsAction')}</Button>
        </div>
        {count > 0 ? <DropdownMenuItem disabled={readPending} onSelect={(event) => { event.preventDefault(); readAll.mutate(); }}><CheckCheck className="mr-2 size-4" />{t('markAllRead')}</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        {query.isLoading ? <div role="status" aria-label={t('loading')} className="space-y-3 p-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-full" /></div> : null}
        {query.isError || unread.isError ? <div role="alert" className="px-3 py-2 text-sm text-destructive">{t('failedToLoadData')}</div> : null}
        {query.isError || unread.isError ? <DropdownMenuItem onSelect={(event) => {
          event.preventDefault();
          if (query.isFetchNextPageError) void query.fetchNextPage(); else void query.refetch();
          if (unread.isError) void unread.refetch();
        }}>{t('retry')}</DropdownMenuItem> : null}
        {!query.isLoading && !query.isError && items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{t('noNotifications')}</p> : null}
        <div className="max-h-[60dvh] overflow-y-auto">
          {items.map((item) => {
            const destination = notificationDestination(item, user);
            return <div key={item.id} className={`flex items-start gap-1 pr-1 ${item.isRead ? 'opacity-60' : ''}`}>
              <DropdownMenuItem disabled={readPending && !item.isRead} className="min-w-0 flex-1 flex-col items-start gap-1 p-3" onSelect={(event) => {
                event.preventDefault();
                if (destination) requestNavigation(() => { setLocation(destination); setOpen(false); if (!item.isRead) read.mutate(item); });
                else if (!item.isRead) read.mutate(item);
              }}>
                <span className="text-sm font-medium text-foreground">{item.title}</span>
                {item.message ? <span className="text-xs leading-relaxed text-muted-foreground">{item.message}</span> : null}
                {destination ? <span className="flex items-center gap-1 text-xs text-primary"><ExternalLink className="size-3" />{t('openRelatedRecord')}</span> : null}
              </DropdownMenuItem>
              <DropdownMenuItem className="mt-3 size-8 shrink-0 justify-center rounded-full p-0" aria-label={t('delete')} onSelect={() => { setDeleteError(''); setDeleteTarget(item); }}><X className="size-3" /></DropdownMenuItem>
            </div>;
          })}
          {query.hasNextPage ? <DropdownMenuItem disabled={query.isFetchingNextPage} onSelect={(event) => { event.preventDefault(); void query.fetchNextPage(); }}>
            {query.isFetchingNextPage ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}{t('loadOlderNotifications')}
          </DropdownMenuItem> : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(next) => { if (!next) setDeleteTarget(null); }} title={t('deleteNotificationTitle')}
      description={`${deleteTarget?.title || ''}. ${t('deleteNotificationConfirm')}`} confirmLabel={t('delete')} variant="destructive" keepOpenOnConfirm
      isPending={remove.isPending} error={deleteError} onConfirm={() => { if (deleteTarget) { setDeleteError(''); remove.mutate(deleteTarget.id); } }} />
    <ConfirmDialog open={clearOpen} onOpenChange={(next) => { if (!clear.isPending) setClearOpen(next); }} title={t('clearNotifications')}
      description={t('clearNotificationsConfirm')} confirmLabel={t('clearNotificationsAction')} variant="destructive" keepOpenOnConfirm
      isPending={clear.isPending} error={clearError} onConfirm={() => { setClearError(''); clear.mutate(); }} />
  </>;
}
