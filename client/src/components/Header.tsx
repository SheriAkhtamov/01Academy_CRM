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
import { MessageCircle, X, Settings, Menu, Search, UserPlus, Loader2, Check } from 'lucide-react';
import ChatSheet from './ux/ChatSheet';
import ConfirmDialog from './ConfirmDialog';
import SettingsModal from './modals/SettingsModal';
import AddAccountModal from './modals/AddAccountModal';
import { CommandPalette } from './ux/CommandPalette';
import { ThemeToggle } from './ux/ThemeToggle';
import { ModuleIdentity } from './ux/ModuleIdentity';
import { UnreadCountBadge } from './ux/UnreadCountBadge';
import { NotificationsMenu } from './ux/NotificationsMenu';
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

  const unreadMessageCount = totalUnreadMessages(conversations);
  const unreadMessagesLabel = t('unreadMessageCount')
    .replace('{count}', String(unreadMessageCount));

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
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 px-3 py-2.5 backdrop-blur-xl sm:px-4 sm:py-3 lg:px-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3 lg:flex-nowrap">
          {onMenuToggle && (
            <button
              ref={menuButtonRef}
              onClick={onMenuToggle}
              className="-ml-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
              aria-label={t('openNavigation')}
            >
              <Menu className="size-5" />
            </button>
          )}
          <div className="order-2 min-w-0 w-full lg:order-none lg:flex-1">
            <ModuleIdentity title={title} subtitle={subtitle} />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="flex lg:hidden rounded-full"
              onClick={() => setCommandOpen(true)}
              aria-label={t('search')}
            >
              <Search className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="hidden items-center gap-2 rounded-full px-3 text-muted-foreground hover:bg-accent hover:text-foreground lg:flex"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="h-4 w-4" />
              <span className="text-sm">{t('search')}</span>
            </Button>

            <ThemeToggle />

            <NotificationsMenu />

            <div className="relative">
              {/*
                The label is the first thing to go on a narrow screen: with the
                menu button, search, theme, notifications and the avatar all
                competing for a 375px row, a word-and-icon button is what pushed
                the account menu off the edge. Below `sm` it is a round icon
                button like its neighbours; the accessible name is unchanged, so
                nothing is lost but the printed word.
              */}
              <Button
                size="icon"
                className="rounded-full sm:size-auto sm:rounded-md sm:px-4 sm:py-2"
                onClick={() => setShowChat(true)}
                aria-label={unreadMessageCount > 0 ? unreadMessagesLabel : t('messages')}
              >
                <MessageCircle className="h-5 w-5 sm:mr-2" />
                <span className="hidden sm:inline">{t('messages')}</span>
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
