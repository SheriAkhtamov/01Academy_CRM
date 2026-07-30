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

type ModuleType =
  | 'sales'
  | 'administration'
  | 'teacher'
  | 'marketing'
  | 'finance'
  | 'tasks';

interface ModuleDefinition {
  title: string;
  description: string;
  icon: LucideIcon;
}

function resolveModuleType(location: string, assignedModule?: string): ModuleType {
  if (location === '/tasks') {
    return 'tasks';
  }

  if (location === '/sales' || location.startsWith('/sales/')) {
    return 'sales';
  }

  if (location === '/teacher-module' || location.startsWith('/teacher-module/')) {
    return 'teacher';
  }

  if (location === '/marketing-module' || location.startsWith('/marketing-module/')) {
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

  const knownModules: ModuleType[] = [
    'administration',
    'sales',
    'teacher',
    'marketing',
  ];
  return knownModules.includes(assignedModule as ModuleType)
    ? assignedModule as ModuleType
    : 'administration';
}

interface ModuleIdentityProps {
  title?: string;
  subtitle?: string;
}

export function ModuleIdentity({ title, subtitle }: ModuleIdentityProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const moduleDefinitions: Record<ModuleType, ModuleDefinition> = {
    sales: {
      title: t('salesDepartmentModule'),
      description: t('salesDepartmentModuleDescription'),
      icon: TrendingUp,
    },
    administration: {
      title: t('administrationModule'),
      description: t('administrationModuleDescription'),
      icon: ShieldCheck,
    },
    teacher: {
      title: t('teacherModule'),
      description: t('teacherWorkplaceModuleDescription'),
      icon: GraduationCap,
    },
    marketing: {
      title: t('marketingDepartmentModule'),
      description: t('marketingDepartmentModuleDescription'),
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
  const module = moduleDefinitions[resolveModuleType(location, user?.module)];
  const Icon = module.icon;

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
          {t('currentModule')}
        </p>
        <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
          {title ?? module.title}
        </h1>
        <p className="hidden truncate text-xs text-muted-foreground xl:block">
          {subtitle ?? module.description}
        </p>
      </div>
    </div>
  );
}
