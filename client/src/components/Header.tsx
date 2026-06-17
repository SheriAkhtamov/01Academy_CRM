import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import { getInitials } from '@/lib/auth';
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
import { Bell, MessageCircle, X, Settings, Menu, Search, CheckCheck } from 'lucide-react';
import ChatModal from './modals/ChatModal';
import SettingsModal from './modals/SettingsModal';
import { CommandPalette } from './ux/CommandPalette';
import { ThemeToggle } from './ux/ThemeToggle';

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
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/70 dark:border-slate-800/70 px-6 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onMenuToggle && (
              <button
                onClick={onMenuToggle}
                className="md:hidden p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">{title || t('dashboard')}</h1>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">{subtitle || t('welcomeMessage')}</p>
            </div>
          </div>
          <div className="flex items-center space-x-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="hidden md:flex items-center gap-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full px-3"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="h-4 w-4" />
              <span className="text-sm">{t('search')}</span>
              <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border bg-slate-100 dark:bg-slate-800 px-1.5 font-mono text-[10px] font-medium text-slate-500">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -top-0.5 -right-0.5 h-5 w-5 flex items-center justify-center p-0 text-[10px] font-bold ring-2 ring-white dark:ring-slate-900"
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
              <DropdownMenuContent align="end">
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

      <ChatModal
        open={showChat}
        onOpenChange={setShowChat}
      />

      <SettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
      />

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
    </>
  );
}
