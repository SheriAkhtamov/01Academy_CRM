import type { LucideIcon } from 'lucide-react';
import {
  GraduationCap,
  Megaphone,
  ShieldCheck,
  TrendingUp,
  Landmark,
  KanbanSquare,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';

type WorkspaceType =
  | 'sales'
  | 'administration'
  | 'teacher'
  | 'marketing'
  | 'finance'
  | 'tasks';

interface WorkspaceDefinition {
  title: string;
  description: string;
  icon: LucideIcon;
}

function resolveWorkspaceType(location: string, assignedWorkspace?: string): WorkspaceType {
  if (location === '/tasks') {
    return 'tasks';
  }

  if (location === '/sales' || location.startsWith('/sales/')) {
    return 'sales';
  }

  if (location === '/teacher-workspace' || location.startsWith('/teacher-workspace/')) {
    return 'teacher';
  }

  if (location === '/marketing-workspace' || location.startsWith('/marketing-workspace/')) {
    return 'marketing';
  }

  if (location === '/finance' || location.startsWith('/finance/')) {
    return 'finance';
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
    finance: {
      title: t('financeCenterModule'),
      description: t('financeCenterSubtitle'),
      icon: Landmark,
    },
    tasks: {
      title: t('taskBoard'),
      description: t('taskBoardSubtitle'),
      icon: KanbanSquare,
    },
  };
  const workspace = workspaceDefinitions[resolveWorkspaceType(location, user?.workspace)];
  const Icon = workspace.icon;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        className="hidden size-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary shadow-2xs sm:flex"
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </div>

      <div className="min-w-0 leading-tight">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
          {t('currentWorkspace')}
        </p>
        <h1 className="truncate text-sm font-semibold tracking-tight text-foreground sm:text-base">
          {title ?? workspace.title}
        </h1>
        <p className="hidden truncate text-[11px] text-muted-foreground/90 xl:block">
          {subtitle ?? workspace.description}
        </p>
      </div>
    </div>
  );
}
