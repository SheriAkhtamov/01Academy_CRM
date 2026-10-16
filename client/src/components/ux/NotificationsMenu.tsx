import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { notificationQueryKeys, notificationsApi } from '@/features/notifications/api';
import { notificationDestination } from '@/lib/notificationDestination';
import { requestNavigation } from '@/lib/navigationGuard';
import type { NotificationDto, NotificationPage } from '@shared/contracts/notifications';
import { NotificationsMenuView, type NotificationsMenuViewItem } from './NotificationsMenuView';

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
  const present = (item: NotificationDto): NotificationsMenuViewItem => ({
    id: item.id,
    title: item.title,
    message: item.message,
    isRead: Boolean(item.isRead),
    hasDestination: Boolean(notificationDestination(item, user)),
  });
  return (
    <NotificationsMenuView
      open={open}
      onOpenChange={setOpen}
      items={items.map(present)}
      unreadCount={count}
      unreadError={unread.isError}
      loading={query.isLoading}
      listError={query.isError}
      hasNextPage={Boolean(query.hasNextPage)}
      fetchingNextPage={query.isFetchingNextPage}
      readPending={readPending}
      readAllPending={readAll.isPending}
      onReadAll={() => readAll.mutate()}
      onItemSelect={(id) => {
        const item = items.find((entry) => entry.id === id);
        if (!item) return;
        const destination = notificationDestination(item, user);
        if (destination) requestNavigation(() => {
          setLocation(destination);
          setOpen(false);
          if (!item.isRead) read.mutate(item);
        });
        else if (!item.isRead) read.mutate(item);
      }}
      onRetry={() => {
        if (query.isFetchNextPageError) void query.fetchNextPage();
        else void query.refetch();
        if (unread.isError) void unread.refetch();
      }}
      onLoadMore={() => { void query.fetchNextPage(); }}
      remove={{
        target: deleteTarget ? present(deleteTarget) : null,
        pending: remove.isPending,
        error: deleteError,
        onTargetChange: (item) => {
          setDeleteError('');
          setDeleteTarget(item ? items.find((entry) => entry.id === item.id) ?? null : null);
        },
        onConfirm: () => {
          if (deleteTarget) { setDeleteError(''); remove.mutate(deleteTarget.id); }
        },
      }}
      clear={{
        open: clearOpen,
        pending: clear.isPending,
        error: clearError,
        onOpenChange: (next) => { setClearError(''); setClearOpen(next); },
        onConfirm: () => { setClearError(''); clear.mutate(); },
      }}
    />
  );
}
