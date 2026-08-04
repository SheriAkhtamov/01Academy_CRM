import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useAccounts } from '@/hooks/useAccounts';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { getInitials, formatUserModule } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Bell, MessageCircle, X, Settings, Menu, Search, CheckCheck, UserPlus, Loader2, Check } from 'lucide-react';
import ChatSheet from './ux/ChatSheet';
import ConfirmDialog from './ConfirmDialog';
import SettingsModal from './modals/SettingsModal';
import AddAccountModal from './modals/AddAccountModal';
import { CommandPalette } from './ux/CommandPalette';
import { ThemeToggle } from './ux/ThemeToggle';
import { ModuleIdentity } from './ux/ModuleIdentity';
import { UnreadCountBadge } from './ux/UnreadCountBadge';
import {
  conversationQueryOptions,
  totalUnreadMessages,
} from '@/features/messages/api';
import type { ConversationUserDto } from '@shared/contracts/messages';
import type { SavedAccountEntry } from '@shared/auth';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuToggle?: () => void;
}

const VISIBLE_NOTIFICATIONS = 6;

export default function Header({
  title,
  subtitle,
  onMenuToggle,
}: HeaderProps) {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const { accounts, switchToAccount, removeAccount, isSwitching, isRemoving } = useAccounts();
  const { toast } = useToast();
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<number | null>(null);
  const [accountToRemove, setAccountToRemove] = useState<SavedAccountEntry | null>(null);
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ['/api/notifications'],
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: conversations = [] } = useQuery<ConversationUserDto[]>({
    ...conversationQueryOptions,
  });

  const unreadNotificationCount = notifications.filter((n: any) => !n.isRead).length;
  const unreadNotificationsLabel = t('unreadNotificationCount')
    .replace('{count}', String(unreadNotificationCount));
  const hiddenNotificationCount = Math.max(0, notifications.length - VISIBLE_NOTIFICATIONS);
  const unreadMessageCount = totalUnreadMessages(conversations);
  const unreadMessagesLabel = t('unreadMessageCount')
    .replace('{count}', String(unreadMessageCount));

  // The badge is what the user watches, so move it the moment they act instead of
  // waiting for a refetch round-trip; a failed request rolls the count back.
  const cancelNotificationRefetch = async () => {
    await queryClient.cancelQueries({ queryKey: ['/api/notifications'] });
    return { previous: queryClient.getQueryData<any[]>(['/api/notifications']) };
  };

  const restoreNotifications = (context: { previous?: any[] } | undefined) => {
    if (context?.previous) {
      queryClient.setQueryData(['/api/notifications'], context.previous);
    }
  };

  const markReadMutation = useMutation({
    mutationFn: (notificationId: number) =>
      apiRequest('PUT', `/api/notifications/${notificationId}/read`),
    onMutate: async (notificationId) => {
      const context = await cancelNotificationRefetch();
      queryClient.setQueryData<any[]>(['/api/notifications'], (current = []) => current.map(
        (item) => (item.id === notificationId ? { ...item, isRead: true } : item),
      ));
      return context;
    },
    onError: (_error, _notificationId, context) => restoreNotifications(context),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiRequest('PUT', '/api/notifications/read-all'),
    onMutate: async () => {
      const context = await cancelNotificationRefetch();
      queryClient.setQueryData<any[]>(['/api/notifications'], (current = []) => current.map(
        (item) => (item.isRead ? item : { ...item, isRead: true }),
      ));
      return context;
    },
    onError: (error: Error, _variables, context) => {
      restoreNotifications(context);
      toast({ title: t('updateFailed'), description: error.message, variant: 'destructive' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (notificationId: number) =>
      apiRequest('DELETE', `/api/notifications/${notificationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      setNotificationToDelete(null);
    },
  });

  const handleDeleteNotification = (notificationId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setNotificationToDelete(notificationId);
  };

  const handleMarkRead = (notificationId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    markReadMutation.mutate(notificationId);
  };

  const handleConfirmRemoveAccount = async () => {
    const account = accountToRemove;
    if (!account) return;

    try {
      await removeAccount(account);
      toast({ title: t('accountRemoved') });
      setAccountToRemove(null);
    } catch (err: any) {
      toast({
        title: t('error'),
        description: err?.message || t('removeAccountFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 px-4 py-3 backdrop-blur-xl md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:flex-nowrap">
          {onMenuToggle && (
            <button
              onClick={onMenuToggle}
              className="-ml-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
              aria-label={t('openNavigation')}
            >
              <Menu className="size-5" />
            </button>
          )}
          <div className="order-2 min-w-0 w-full md:order-none md:flex-1">
            <ModuleIdentity title={title} subtitle={subtitle} />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="flex md:hidden rounded-full"
              onClick={() => setCommandOpen(true)}
              aria-label={t('search')}
            >
              <Search className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="hidden items-center gap-2 rounded-full px-3 text-muted-foreground hover:bg-accent hover:text-foreground md:flex"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="h-4 w-4" />
              <span className="text-sm">{t('search')}</span>
              <kbd className="hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative rounded-full"
                  aria-label={unreadNotificationCount > 0 ? unreadNotificationsLabel : t('notifications')}
                >
                  <Bell className="h-5 w-5" />
                  <UnreadCountBadge
                    count={unreadNotificationCount}
                    label={unreadNotificationsLabel}
                    announce
                    className="pointer-events-none absolute -right-0.5 -top-0.5"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>{t('notifications')}</span>
                  {unreadNotificationCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => markAllReadMutation.mutate()}
                      disabled={markAllReadMutation.isPending}
                    >
                      <CheckCheck className="h-3 w-3 mr-1" />
                      {t('markAllRead')}
                    </Button>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    {t('noNotifications')}
                  </div>
                ) : (
                  notifications.slice(0, VISIBLE_NOTIFICATIONS).map((notification: any) => (
                    <DropdownMenuItem
                      key={notification.id}
                      className={`flex justify-between items-start p-3 gap-2 ${notification.isRead ? 'opacity-60' : ''}`}
                      onClick={() => !notification.isRead && markReadMutation.mutate(notification.id)}
                    >
                      <div className="flex-1 pr-2">
                        <div className="font-medium text-foreground text-sm">{notification.title}</div>
                        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{notification.message}</div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-accent rounded-full"
                            onClick={(e) => handleMarkRead(notification.id, e)}
                            disabled={markReadMutation.isPending}
                            title={t('markAsRead')}
                            aria-label={t('markAsRead')}
                          >
                            <CheckCheck className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 hover:bg-accent rounded-full shrink-0"
                          onClick={(e) => handleDeleteNotification(notification.id, e)}
                          disabled={deleteNotificationMutation.isPending}
                          aria-label={t('delete')}
                        >
                          <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        </Button>
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
                {hiddenNotificationCount > 0 && (
                  <p className="border-t border-border/60 px-3 py-2 text-center text-xs text-muted-foreground">
                    {t('moreNotificationsHidden').replace('{count}', String(hiddenNotificationCount))}
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="relative">
              <Button
                onClick={() => setShowChat(true)}
                className="btn-modern"
                aria-label={unreadMessageCount > 0 ? unreadMessagesLabel : t('messages')}
              >
                <MessageCircle className="h-5 w-5 mr-2" />
                {t('messages')}
              </Button>
              <UnreadCountBadge
                count={unreadMessageCount}
                label={unreadMessagesLabel}
                announce
                className="pointer-events-none absolute -right-1.5 -top-2"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label={t('currentAccount')}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                       style={{ background: 'linear-gradient(135deg, var(--brand-gradient-from), var(--brand-gradient-to))', boxShadow: 'var(--shadow-primary)' }}>
                    {getInitials(user?.fullName || '')}
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {/* Current account */}
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">{t('currentAccount')}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                      style={{ background: 'linear-gradient(135deg, var(--brand-gradient-from), var(--brand-gradient-to))' }}
                    >
                      {getInitials(user?.fullName || '')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{user?.fullName}</p>
                      <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                    </div>
                    <Check className="h-4 w-4 text-primary shrink-0" />
                  </div>
                </div>

                <DropdownMenuSeparator />

                {/* Saved accounts */}
                {accounts.length > 0 && (
                  <>
                    <DropdownMenuLabel className="text-xs">{t('savedAccounts')}</DropdownMenuLabel>
                    {accounts.map((account) => (
                      <DropdownMenuItem
                        key={account.id}
                        disabled={isSwitching}
                        onClick={async () => {
                          try {
                            await switchToAccount(account);
                            toast({ title: t('accountSwitched') });
                            window.location.assign('/');
                          } catch (err: any) {
                            toast({ title: t('error'), description: err?.message, variant: 'destructive' });
                          }
                        }}
                        className="group"
                      >
                        <div className="flex items-center gap-2 w-full">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-semibold shrink-0"
                            style={{ background: 'linear-gradient(135deg, var(--brand-gradient-from), var(--brand-gradient-to))' }}
                          >
                            {getInitials(account.accountUser.fullName)}
                          </div>
                          <span className="text-sm truncate flex-1">{account.accountUser.fullName}</span>
                          {isSwitching ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setAccountToRemove(account);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                              aria-label={t('removeAccount')}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}

                {/* Add account */}
                <DropdownMenuItem onClick={() => setShowAddAccount(true)}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  {t('addAccount')}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => setShowSettings(true)}>
                  <Settings className="h-4 w-4 mr-2" />
                  {t('settings')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout}>
                  {t('logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <ChatSheet
        open={showChat}
        onOpenChange={setShowChat}
      />

      <SettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
      />

      <AddAccountModal
        open={showAddAccount}
        onOpenChange={setShowAddAccount}
      />

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />

      <ConfirmDialog
        open={notificationToDelete !== null}
        onOpenChange={(open) => { if (!open && !deleteNotificationMutation.isPending) setNotificationToDelete(null); }}
        title={t('deleteNotificationTitle')}
        description={t('deleteNotificationConfirm')}
        confirmLabel={t('delete')}
        variant="destructive"
        isPending={deleteNotificationMutation.isPending}
        keepOpenOnConfirm
        onConfirm={() => {
          if (notificationToDelete !== null) deleteNotificationMutation.mutate(notificationToDelete);
        }}
      />

      <ConfirmDialog
        open={accountToRemove !== null}
        onOpenChange={(open) => { if (!open && !isRemoving) setAccountToRemove(null); }}
        title={t('removeAccountTitle')}
        description={accountToRemove
          ? `${t('removeAccountConfirm')} (${accountToRemove.accountUser.fullName})`
          : ''}
        confirmLabel={t('delete')}
        variant="destructive"
        isPending={isRemoving}
        keepOpenOnConfirm
        onConfirm={() => void handleConfirmRemoveAccount()}
      />
    </>
  );
}
