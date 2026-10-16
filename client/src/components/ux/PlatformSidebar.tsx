import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, X, type LucideIcon } from 'lucide-react';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { DURATION, EASE, SPRING } from '@/lib/motion';
import { AppSidebarFrame } from './AppSidebarFrame';
import { UnreadCountBadge } from './UnreadCountBadge';
import { StaggerGroup, StaggerItem } from './motion';

export interface PlatformSidebarItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  badgeCount?: number;
  badgeLabel?: string;
  opensDialog?: boolean;
  /** Custom navigation owns its guard and closes the drawer after approval. */
  onSelect?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export interface PlatformSidebarSection {
  id: string;
  label: string;
  items: readonly PlatformSidebarItem[];
}

export interface PlatformSidebarProps {
  sections: readonly PlatformSidebarSection[];
  trailingItems?: readonly PlatformSidebarItem[];
  collapsedSections: Partial<Record<string, boolean>>;
  onSectionToggle: (id: string) => void;
  onClose?: () => void;
  isOpen?: boolean;
  navigationKey?: string;
  footer?: ReactNode;
  navLabel?: string;
}

/** Shared branding, navigation, motion, and language footer for every role. */
export function PlatformSidebar({
  sections, trailingItems = [], collapsedSections, onSectionToggle,
  onClose, isOpen, navigationKey, footer, navLabel,
}: PlatformSidebarProps) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // The drawer remains mounted off screen; wait until it is actually open.
    if (isOpen === false) return undefined;
    const reveal = () => {
      const nav = navRef.current;
      const active = nav?.querySelector<HTMLElement>('.sidebar-nav-item.active');
      if (!nav || !active) return;
      // Rects account for positioned stagger wrappers; offsetTop does not.
      const navBox = nav.getBoundingClientRect();
      const itemBox = active.getBoundingClientRect();
      if (itemBox.top >= navBox.top && itemBox.bottom <= navBox.bottom) return;
      const contentTop = itemBox.top - navBox.top + nav.scrollTop;
      nav.scrollTo({
        top: Math.max(0, contentTop - nav.clientHeight / 2 + itemBox.height / 2),
        behavior: 'auto',
      });
    };
    reveal();
    // Entrance motion can still be settling when a drawer first opens.
    const settled = window.setTimeout(reveal, 450);
    return () => window.clearTimeout(settled);
  }, [isOpen, navigationKey]);

  const renderItem = (item: PlatformSidebarItem) => {
    const Icon = item.icon;
    return (
      <Tooltip key={item.id}>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            onClick={(event) => {
              if (item.onSelect) item.onSelect(event);
              else onClose?.();
            }}
            aria-current={item.active && !item.opensDialog ? 'page' : undefined}
            aria-haspopup={item.opensDialog ? 'dialog' : undefined}
          >
            <div className={cn('sidebar-nav-item group', item.active && 'active')}>
              {/* A shared layoutId moves the highlight between active links. */}
              {item.active && (
                <motion.span
                  layoutId="sidebar-active-highlight"
                  className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-r from-primary-50 to-primary-100"
                  transition={SPRING.snappy}
                >
                  <span
                    className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-600"
                    style={{ boxShadow: '0 0 10px 0 var(--primary-glow)' }}
                  />
                </motion.span>
              )}
              <Icon className="sidebar-nav-item__icon" />
              <span className="truncate">{item.label}</span>
              <UnreadCountBadge
                count={item.badgeCount ?? 0}
                label={item.badgeLabel ?? item.label}
                className="ml-auto ring-card"
              />
              {item.active && !item.badgeCount && (
                <motion.span
                  layoutId="sidebar-active-dot"
                  className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-600"
                  transition={SPRING.snappy}
                />
              )}
            </div>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="hidden lg:block">{item.label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      {/* The drawer is opaque; only docked desktop navigation is frosted. */}
      <AppSidebarFrame
        headerAction={onClose && (
          <button
            onClick={onClose}
            className="lg:hidden ml-2 shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={t('close')}
          ><X className="w-5 h-5" /></button>
        )}
        footer={(
          <>
            <div className="shrink-0 border-t border-border/70 px-4 py-2">
              <LanguageSwitcher />
            </div>
            {footer}
          </>
        )}
      >
        <StaggerGroup
          ref={navRef}
          count={sections.length + (trailingItems.length ? 1 : 0)}
          className="min-h-0 flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden"
          role="navigation"
          aria-label={navLabel}
        >
          {sections.map((section) => {
            if (!section.items.length) return null;
            const isCollapsed = collapsedSections[section.id];
            return (
              <StaggerItem
                key={section.id}
                className="mb-2"
                data-platform-section={section.id}
                data-platform-module={['student', 'parent'].includes(section.id) ? section.id : undefined}
              >
                <button
                  onClick={() => onSectionToggle(section.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-500 transition-colors"
                  aria-expanded={!isCollapsed}
                >
                  <span>{section.label}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200 ease-out-expo', isCollapsed && '-rotate-90')} />
                </button>
                {/* Unmount collapsed links so they leave the tab order. */}
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      className="space-y-0.5 overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: DURATION.base, ease: EASE.out }}
                    >
                      {section.items.map(renderItem)}
                    </motion.div>
                  )}
                </AnimatePresence>
              </StaggerItem>
            );
          })}
          {trailingItems.length > 0 && (
            <StaggerItem className="mt-3 border-t border-border/70 pt-3">
              {trailingItems.map(renderItem)}
            </StaggerItem>
          )}
        </StaggerGroup>
      </AppSidebarFrame>
    </TooltipProvider>
  );
}
