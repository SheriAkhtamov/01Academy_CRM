import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export interface ModuleIdentityViewProps {
  title: string;
  icon: LucideIcon;
  subtitle?: string;
  resource?: boolean;
}

/** Module identity without account or route dependencies. */
export function ModuleIdentityView({ title, icon: Icon, subtitle, resource = false }: ModuleIdentityViewProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className="hidden size-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary shadow-sm sm:flex"
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </div>

      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t(resource ? 'sidebarResources' : 'currentModule')}
        </p>
        <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
          {title}
        </h1>
        {subtitle ? <p className="hidden truncate text-xs text-muted-foreground xl:block">{subtitle}</p> : null}
      </div>
    </div>
  );
}
