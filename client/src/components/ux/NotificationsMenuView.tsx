import { AlertCircle, Bell, ExternalLink, X } from 'lucide-react';
import type { Ref } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { UnreadCountBadge } from './UnreadCountBadge';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';
import { LoadingRegion } from '@/components/ui/loading-region';

export interface NotificationsMenuViewItem {
  id: number;
  title: string;
  message?: string | null;
  isRead: boolean;
  hasDestination: boolean;
}

export interface NotificationsMenuViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly NotificationsMenuViewItem[];
  unreadCount: number;
  unreadError: boolean;
  loading: boolean;
  listError: boolean;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  readPending: boolean;
  readAllPending: boolean;
  onReadAll: () => void;
  onItemSelect: (id: number) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  triggerRef?: Ref<HTMLButtonElement>;
  onConfirmationCloseAutoFocus?: (event: Event) => void;
  remove: {
    target: NotificationsMenuViewItem | null;
    pending: boolean;
    error: string;
    onTargetChange: (item: NotificationsMenuViewItem | null) => void;
    onConfirm: () => void;
  };
  clear: {
    open: boolean;
    pending: boolean;
    error: string;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  };
}

/** The CRM notification dropdown, independent of an account realm or API. */
export function NotificationsMenuView({
  open, onOpenChange, items, unreadCount, unreadError, loading, listError,
  hasNextPage, fetchingNextPage, readPending, readAllPending,
  onReadAll, onItemSelect, onRetry, onLoadMore, remove, clear,
  triggerRef, onConfirmationCloseAutoFocus,
}: NotificationsMenuViewProps) {
  const { t } = useTranslation();
  const label = t('unreadNotificationCount').replace('{count}', String(unreadCount));
  return <>
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="icon" className="relative rounded-full" aria-label={unreadCount > 0 ? label : t('notifications')}>
          <Bell className="size-5" />
          {unreadError ? <AlertCircle aria-hidden="true" className="absolute right-0 top-0 size-3 text-destructive" /> : <UnreadCountBadge count={unreadCount} label={label} announce className="pointer-events-none absolute -right-0.5 -top-0.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))]">
        <div className="flex flex-wrap items-center justify-between gap-2 pr-2">
          <DropdownMenuLabel className="min-w-0">{t('notifications')}</DropdownMenuLabel>
          <div className="flex shrink-0 items-center gap-1">
            {unreadCount > 0 || readAllPending ? <DropdownMenuItem asChild
              disabled={readPending || remove.pending || clear.pending}
              onSelect={(event) => { event.preventDefault(); onReadAll(); }}>
              <Button type="button" variant="ghost" className="h-7 px-2 text-xs" aria-label={t('markAllRead')}
                disabled={readPending || remove.pending || clear.pending}>{t('markAllReadAction')}</Button>
            </DropdownMenuItem> : null}
            <DropdownMenuItem asChild
              disabled={loading || listError || items.length === 0 || readPending || remove.pending || clear.pending}
              onSelect={() => { onOpenChange(false); clear.onOpenChange(true); }}>
              <Button type="button" variant="ghost" className="h-7 px-2 text-xs" aria-label={t('clearNotifications')}
                disabled={loading || listError || items.length === 0 || readPending || remove.pending || clear.pending}>{t('clearNotificationsAction')}</Button>
            </DropdownMenuItem>
          </div>
        </div>
        <DropdownMenuSeparator />
        {loading ? <LoadingRegion role="status" aria-label={t('loading')} className="space-y-3 p-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-full" /></LoadingRegion> : null}
        {listError || unreadError ? <div role="alert" className="px-3 py-2 text-sm text-destructive">{t('failedToLoadData')}</div> : null}
        {listError || unreadError ? <DropdownMenuItem onSelect={(event) => {
          event.preventDefault();
          onRetry();
        }}>{t('retry')}</DropdownMenuItem> : null}
        {!loading && !listError && items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{t('noNotifications')}</p> : null}
        <div className="max-h-[60dvh] overflow-y-auto">
          {items.map((item) => {
            return <div key={item.id} className={`flex items-start gap-1 pr-1 ${item.isRead ? 'opacity-60' : ''}`}>
              <DropdownMenuItem disabled={readPending && !item.isRead} className="min-w-0 flex-1 flex-col items-start gap-1 p-3" onSelect={(event) => {
                event.preventDefault();
                onItemSelect(item.id);
              }}>
                <span className="text-sm font-medium text-foreground">{item.title}</span>
                {item.message ? <span className="text-xs leading-relaxed text-muted-foreground">{item.message}</span> : null}
                {item.hasDestination ? <span className="flex items-center gap-1 text-xs text-primary"><ExternalLink className="size-3" />{t('openRelatedRecord')}</span> : null}
              </DropdownMenuItem>
              <DropdownMenuItem className="mt-3 size-8 shrink-0 justify-center rounded-full p-0" aria-label={t('delete')} onSelect={() => { remove.onTargetChange(item); }}><X className="size-3" /></DropdownMenuItem>
            </div>;
          })}
          {hasNextPage ? <DropdownMenuItem disabled={fetchingNextPage} onSelect={(event) => { event.preventDefault(); onLoadMore(); }}>
            {fetchingNextPage ? <OrbitSpinner className="mr-2 size-4" /> : null}{t('loadOlderNotifications')}
          </DropdownMenuItem> : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    <ConfirmDialog open={Boolean(remove.target)} onOpenChange={(next) => { if (!next) remove.onTargetChange(null); }} title={t('deleteNotificationTitle')}
      description={`${remove.target?.title || ''}. ${t('deleteNotificationConfirm')}`} confirmLabel={t('delete')} variant="destructive" keepOpenOnConfirm
      isPending={remove.pending} error={remove.error} onConfirm={remove.onConfirm} onCloseAutoFocus={onConfirmationCloseAutoFocus} />
    <ConfirmDialog open={clear.open} onOpenChange={(next) => { if (!clear.pending) clear.onOpenChange(next); }} title={t('clearNotifications')}
      description={t('clearNotificationsConfirm')} confirmLabel={t('clearNotificationsAction')} variant="destructive" keepOpenOnConfirm
      isPending={clear.pending} error={clear.error} onConfirm={clear.onConfirm} onCloseAutoFocus={onConfirmationCloseAutoFocus} />
  </>;
}
