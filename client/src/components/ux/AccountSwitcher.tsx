import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAccounts } from '@/hooks/useAccounts';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { getInitials, formatUserWorkspace } from '@/lib/auth';
import type { SavedAccountEntry } from '@shared/auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Check, Loader2, Trash2, ArrowLeftRight } from 'lucide-react';
import AddAccountModal from '@/components/modals/AddAccountModal';

export default function AccountSwitcher() {
  const { user } = useAuth();
  const { accounts, switchToAccount, removeAccount, isSwitching, isRemoving } = useAccounts();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);

  const handleSwitch = async (account: SavedAccountEntry) => {
    try {
      await switchToAccount(account);
      toast({
        title: t('accountSwitched'),
      });
      window.location.assign('/');
    } catch (err: any) {
      toast({
        title: t('error'),
        description: err?.message || 'Failed to switch account',
        variant: 'destructive',
      });
    }
  };

  const handleRemove = async (account: SavedAccountEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await removeAccount(account);
      toast({
        title: t('accountRemoved'),
      });
    } catch (err: any) {
      toast({
        title: t('error'),
        description: err?.message || 'Failed to remove account',
        variant: 'destructive',
      });
    }
  };

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            <span className="hidden sm:inline">{t('accounts')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t('currentAccount')}
          </div>
          <DropdownMenuItem className="cursor-default opacity-100">
            <div className="flex items-center gap-3 w-full">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))' }}
              >
                {getInitials(user.fullName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{user.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <Check className="h-4 w-4 text-primary shrink-0" />
            </div>
          </DropdownMenuItem>

          {accounts.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('savedAccounts')}
              </div>
              {accounts.map((account) => (
                <DropdownMenuItem
                  key={account.id}
                  onClick={() => handleSwitch(account)}
                  disabled={isSwitching}
                  className="cursor-pointer"
                >
                  <div className="flex items-center gap-3 w-full">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                      style={{ background: 'linear-gradient(135deg, var(--color-muted), var(--color-muted-foreground))' }}
                    >
                      {getInitials(account.accountUser.fullName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{account.accountUser.fullName}</p>
                        {account.label && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {account.label}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {account.accountUser.position || formatUserWorkspace(account.accountUser.workspace, t)}
                      </p>
                    </div>
                    {isSwitching ? (
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    ) : (
                      <button
                        onClick={(e) => handleRemove(account, e)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        title={t('removeAccount')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowAddModal(true)} className="cursor-pointer">
            <UserPlus className="h-4 w-4 mr-2" />
            {t('addAccount')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddAccountModal open={showAddModal} onOpenChange={setShowAddModal} />
    </>
  );
}
