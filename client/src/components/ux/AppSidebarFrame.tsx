import type { ReactNode } from 'react';
import Logo from '@/components/Logo';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface AppSidebarFrameProps {
  as?: 'aside' | 'div';
  children: ReactNode;
  footer?: ReactNode;
  headerAction?: ReactNode;
  className?: string;
}

/** Shared platform branding and navigation surface for every role module. */
export function AppSidebarFrame({
  as: Container = 'div',
  children,
  footer,
  headerAction,
  className,
}: AppSidebarFrameProps) {
  const { t } = useTranslation();
  return (
    <Container
      className={cn(
        'flex h-full w-72 flex-col border-r border-border/70 bg-card lg:w-64 lg:bg-card/95 lg:backdrop-blur-sm',
        className,
      )}
      data-platform-sidebar
    >
      <div className="flex items-center border-b border-border/70 px-3 py-4">
        <div className="flex items-center w-full">
          <Logo size="sm" className="shrink-0" />
          <div className="ml-2 flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="whitespace-nowrap text-base font-semibold text-foreground tracking-tight leading-tight">
              {t('platformName')}
            </span>
            <span className="whitespace-nowrap text-[11px] leading-tight text-muted-foreground">{t('schoolCrm')}</span>
          </div>
          {headerAction}
        </div>
      </div>
      {children}
      {footer}
    </Container>
  );
}
