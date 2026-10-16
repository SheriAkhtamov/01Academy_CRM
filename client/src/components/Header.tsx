import { UserAvatar } from '@/components/ux/UserAvatar';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useAccounts } from '@/hooks/useAccounts';
import { useToast } from '@/hooks/use-toast';
import { formatUserModule } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { X, Settings, UserPlus, Loader2, Check } from 'lucide-react';
import ChatSheet from './ux/ChatSheet';
import ConfirmDialog from './ConfirmDialog';
import SettingsModal from './modals/SettingsModal';
import AddAccountModal from './modals/AddAccountModal';
import { CommandPalette } from './ux/CommandPalette';
import { ModuleIdentity } from './ux/ModuleIdentity';
import { PlatformHeader } from './ux/PlatformHeader';
import { NotificationsMenu } from './ux/NotificationsMenu';
import {
  conversationQueryOptions,
  totalUnreadMessages,
} from '@/features/messages/api';
import type { ConversationUserDto } from '@shared/contracts/messages';
import { chatGroupQueryOptions } from '@/features/messages/chat-groups-api';
import type { SavedAccountEntry } from '@shared/auth';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuToggle?: () => void;
  menuButtonRef?: React.Ref<HTMLButtonElement>;
}

export default function Header({
  title,
  subtitle,
  onMenuToggle,
  menuButtonRef,
}: HeaderProps) {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const { accounts, switchToAccount, removeAccount, isSwitching, isRemoving } = useAccounts();
  const { toast } = useToast();
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [accountToRemove, setAccountToRemove] = useState<SavedAccountEntry | null>(null);

  const { data: conversations = [] } = useQuery<ConversationUserDto[]>({
    ...conversationQueryOptions,
  });

  const { data: chatGroups = [] } = useQuery(chatGroupQueryOptions);
  const unreadMessageCount = totalUnreadMessages(conversations) + chatGroups.reduce((sum, group) => sum + Number(group.unreadCount || 0), 0);

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
      <PlatformHeader
        identity={<ModuleIdentity title={title} subtitle={subtitle} />}
        onSearch={() => setCommandOpen(true)}
        onMessages={() => setShowChat(true)}
        unreadMessageCount={unreadMessageCount}
        notifications={<NotificationsMenu />}
        onMenuToggle={onMenuToggle}
        menuButtonRef={menuButtonRef}
        accountMenu={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label={t('currentAccount')}
              >
                <UserAvatar user={user} className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(16rem,calc(100vw-1.5rem))]">
              {/* Current account */}
              <div className="px-3 py-2">
                <p className="text-xs text-muted-foreground">{t('currentAccount')}</p>
                <div className="flex items-center gap-2 mt-1">
                  <UserAvatar user={user} className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0" />
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
                    <div key={account.id} className="flex items-center gap-1 pr-1">
                      <DropdownMenuItem
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
                        className="min-w-0 flex-1"
                      >
                        <div className="flex items-center gap-2 w-full">
                          <UserAvatar user={account.accountUser} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-semibold shrink-0" />
                          <span className="text-sm truncate flex-1">{account.accountUser.fullName}</span>
                          {isSwitching && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          )}
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="size-6 shrink-0 justify-center rounded-full p-0 text-destructive focus:text-destructive"
                        aria-label={t('removeAccount')}
                        onSelect={() => setAccountToRemove(account)}
                      >
                        <X className="h-3 w-3" />
                      </DropdownMenuItem>
                    </div>
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
        )}
      />

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
