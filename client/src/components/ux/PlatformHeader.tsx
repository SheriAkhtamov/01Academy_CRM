import type { ReactNode, Ref } from 'react';
import { Menu, MessageCircle, Search } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from './ThemeToggle';
import { UnreadCountBadge } from './UnreadCountBadge';

export interface PlatformHeaderProps {
  identity: ReactNode;
  onSearch: () => void;
  onMessages: () => void;
  unreadMessageCount: number;
  notifications: ReactNode;
  accountMenu: ReactNode;
  onMenuToggle?: () => void;
  menuButtonRef?: Ref<HTMLButtonElement>;
}

/** The same header presentation for staff, students, and representatives. */
export function PlatformHeader({
  identity, onSearch, onMessages, unreadMessageCount, notifications, accountMenu,
  onMenuToggle, menuButtonRef,
}: PlatformHeaderProps) {
  const { t } = useTranslation();
  const unreadMessagesLabel = t('unreadMessageCount')
    .replace('{count}', String(unreadMessageCount));
  return (
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
          {identity}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="flex lg:hidden rounded-full"
            onClick={onSearch}
            aria-label={t('search')}
          >
            <Search className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="hidden items-center gap-2 rounded-full px-3 text-muted-foreground hover:bg-accent hover:text-foreground lg:flex"
            onClick={onSearch}
          >
            <Search className="h-4 w-4" />
            <span className="text-sm">{t('search')}</span>
          </Button>
          <ThemeToggle />
          {notifications}
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
              onClick={onMessages}
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
          {accountMenu}
        </div>
      </div>
    </header>
  );
}
