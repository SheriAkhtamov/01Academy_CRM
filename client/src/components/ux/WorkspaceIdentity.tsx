import type { LucideIcon } from 'lucide-react';
import {
  GraduationCap,
  Megaphone,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';

type WorkspaceType =
  | 'sales'
  | 'administration'
  | 'director'
  | 'teacher'
  | 'marketing';

interface WorkspaceDefinition {
  title: string;
  description: string;
  icon: LucideIcon;
}

function resolveWorkspaceType(location: string, assignedWorkspace?: string): WorkspaceType {
  if (location === '/sales' || location.startsWith('/sales/')) {
    return 'sales';
  }

  if (location === '/teacher-workspace' || location.startsWith('/teacher-workspace/')) {
    return 'teacher';
  }

  if (location === '/marketing-workspace' || location.startsWith('/marketing-workspace/')) {
    return 'marketing';
  }

  if (
    location === '/admin'
    || location.startsWith('/admin/')
    || location === '/employees'
    || location === '/integrations'
  ) {
    return 'administration';
  }

  const knownWorkspaces: WorkspaceType[] = [
    'administration',
    'director',
    'sales',
    'teacher',
    'marketing',
  ];
  return knownWorkspaces.includes(assignedWorkspace as WorkspaceType)
    ? assignedWorkspace as WorkspaceType
    : 'administration';
}

interface WorkspaceIdentityProps {
  title?: string;
  subtitle?: string;
}

export function WorkspaceIdentity({ title, subtitle }: WorkspaceIdentityProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const workspaceDefinitions: Record<WorkspaceType, WorkspaceDefinition> = {
    sales: {
      title: t('salesDepartmentWorkspace'),
      description: t('salesDepartmentWorkspaceDescription'),
      icon: TrendingUp,
    },
    administration: {
      title: t('administrationWorkspace'),
      description: t('administrationWorkspaceDescription'),
      icon: ShieldCheck,
    },
    director: {
      title: t('directorWorkspace'),
      description: t('directorWorkspaceDescription'),
      icon: ShieldCheck,
    },
    teacher: {
      title: t('teacherWorkspace'),
      description: t('teacherWorkplaceWorkspaceDescription'),
      icon: GraduationCap,
    },
    marketing: {
      title: t('marketingDepartmentWorkspace'),
      description: t('marketingDepartmentWorkspaceDescription'),
      icon: Megaphone,
    },
  };
  const workspace = workspaceDefinitions[resolveWorkspaceType(location, user?.workspace)];
  const Icon = workspace.icon;

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
          {t('currentWorkspace')}
        </p>
        <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
          {title ?? workspace.title}
        </h1>
        <p className="hidden truncate text-xs text-muted-foreground xl:block">
          {subtitle ?? workspace.description}
        </p>
      </div>
    </div>
  );
}
