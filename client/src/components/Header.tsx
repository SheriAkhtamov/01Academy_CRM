import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useAccounts } from '@/hooks/useAccounts';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { getInitials, formatUserWorkspace } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Bell, MessageCircle, X, Settings, Menu, Search, CheckCheck, UserPlus, ArrowLeftRight, Loader2, Check } from 'lucide-react';
import ChatSheet from './ux/ChatSheet';
import SettingsModal from './modals/SettingsModal';
import AddAccountModal from './modals/AddAccountModal';
import { CommandPalette } from './ux/CommandPalette';
import { ThemeToggle } from './ux/ThemeToggle';
import { WorkspaceIdentity } from './ux/WorkspaceIdentity';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuToggle?: () => void;
}

export default function Header({
  title,
  subtitle,
  onMenuToggle,
}: HeaderProps) {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const { accounts, switchToAccount, removeAccount, isSwitching } = useAccounts();
  const { toast } = useToast();
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAccountList, setShowAccountList] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ['/api/notifications'],
  });

  const unreadCount = notifications.filter((n: any) => !n.isRead).length;

  const markReadMutation = useMutation({
    mutationFn: (notificationId: number) =>
      apiRequest('PUT', `/api/notifications/${notificationId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiRequest('PUT', '/api/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (notificationId: number) =>
      apiRequest('DELETE', `/api/notifications/${notificationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
  });

  const handleDeleteNotification = (notificationId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    deleteNotificationMutation.mutate(notificationId);
  };

  const handleMarkRead = (notificationId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    markReadMutation.mutate(notificationId);
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
            <WorkspaceIdentity title={title} subtitle={subtitle} />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="hidden items-center gap-2 rounded-full px-3 text-muted-foreground hover:bg-accent hover:text-foreground md:flex"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="h-4 w-4" />
              <span className="text-sm">{t('search')}</span>
              <kbd className="hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline-flex">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative rounded-full">
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center p-0 text-[10px] font-bold ring-2 ring-background"
                    >
                      {unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>{t('notifications')}</span>
                  {unreadCount > 0 && (
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
                  <div className="p-6 text-center text-slate-500 text-sm">
                    {t('noNotifications')}
                  </div>
                ) : (
                  notifications.slice(0, 6).map((notification: any) => (
                    <DropdownMenuItem
                      key={notification.id}
                      className={`flex justify-between items-start p-3 gap-2 ${notification.isRead ? 'opacity-60' : ''}`}
                      onClick={() => !notification.isRead && markReadMutation.mutate(notification.id)}
                    >
                      <div className="flex-1 pr-2">
                        <div className="font-medium text-slate-900 text-sm">{notification.title}</div>
                        <div className="text-xs text-slate-500 mt-1 leading-relaxed">{notification.message}</div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-slate-200 rounded-full"
                            onClick={(e) => handleMarkRead(notification.id, e)}
                            disabled={markReadMutation.isPending}
                            title={t('markAsRead')}
                          >
                            <CheckCheck className="h-3 w-3 text-slate-400 hover:text-slate-600" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 hover:bg-slate-200 rounded-full shrink-0"
                          onClick={(e) => handleDeleteNotification(notification.id, e)}
                          disabled={deleteNotificationMutation.isPending}
                        >
                          <X className="h-3 w-3 text-slate-400 hover:text-slate-600" />
                        </Button>
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={() => setShowChat(true)} className="btn-modern">
              <MessageCircle className="h-5 w-5 mr-2" />
              {t('messages')}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                       style={{ background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', boxShadow: 'var(--shadow-primary)' }}>
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
                      style={{ background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))' }}
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
                            style={{ background: 'linear-gradient(135deg, var(--color-muted), var(--color-muted-foreground))' }}
                          >
                            {getInitials(account.accountUser.fullName)}
                          </div>
                          <span className="text-sm truncate flex-1">{account.accountUser.fullName}</span>
                          {isSwitching ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          ) : (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await removeAccount(account);
                                  toast({ title: t('accountRemoved') });
                                } catch (err: any) {
                                  toast({ title: t('error'), description: err?.message, variant: 'destructive' });
                                }
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
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
    </>
  );
}
