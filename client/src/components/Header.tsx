import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import { getInitials } from '@/lib/auth';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Bell, MessageCircle, X, Settings, Menu } from 'lucide-react';
import { devLog } from '@/lib/debug';
import ChatModal from './modals/ChatModal';
import SettingsModal from './modals/SettingsModal';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuToggle?: () => void;
}

export default function Header({
  title,
  subtitle,
  onMenuToggle
}: HeaderProps) {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const displayTitle = title || t('dashboard');

  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ['/api/notifications'],
  });

  const unreadCount = notifications.filter((n: any) => !n.isRead).length;

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

  return (
    <>
      <header className="bg-white shadow-sm border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onMenuToggle && (
              <button
                onClick={onMenuToggle}
                className="md:hidden p-2 -ml-2 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-slate-900">{displayTitle}</h1>
              </div>
              <p className="text-slate-600 mt-1">{subtitle || t('welcomeMessage')}</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                    >
                      {unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">
                    {t('noNotifications')}
                  </div>
                ) : (
                  notifications.slice(0, 5).map((notification: any) => (
                    <DropdownMenuItem
                      key={notification.id}
                      className="flex justify-between items-start p-3 hover:bg-slate-50"
                    >
                      <div className="flex-1 pr-2">
                        <div className="font-medium text-slate-900">{notification.title}</div>
                        <div className="text-sm text-slate-500 mt-1">{notification.message}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:bg-slate-200 rounded-full"
                        onClick={(e) => handleDeleteNotification(notification.id, e)}
                        disabled={deleteNotificationMutation.isPending}
                      >
                        <X className="h-3 w-3 text-slate-400 hover:text-slate-600" />
                      </Button>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={() => setShowChat(true)} className="bg-primary-600 hover:bg-primary-700 btn-modern shadow-md hover:shadow-lg transition-all duration-300">
              <MessageCircle className="h-5 w-5 mr-2" />
              {t('messages')}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <div className="w-8 h-8 bg-slate-300 rounded-full flex items-center justify-center">
                    <span className="text-xs font-medium">{getInitials(user?.fullName || '')}</span>
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
    </>
  );
}
