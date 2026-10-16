import type { LucideIcon } from 'lucide-react';
import { KanbanSquare } from 'lucide-react';
import { ModuleIdentityView } from './ModuleIdentityView';
export { ModuleIdentityView } from './ModuleIdentityView';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { MODULE_NAVIGATION, RESOURCE_NAVIGATION_ITEMS, TASKS_NAVIGATION_ITEM } from '@/lib/moduleNavigation';

type ModuleType =
  | 'sales'
  | 'administration'
  | 'teacher'
  | 'marketing'
  | 'finance'
  | 'tasks';

interface ModuleDefinition {
  title: string;
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
  const resource = RESOURCE_NAVIGATION_ITEMS.find((item) => item.href === location);
  const moduleDefinitions: Record<ModuleType, ModuleDefinition> = {
    sales: resolveDefinition('sales'),
    administration: resolveDefinition('administration'),
    teacher: resolveDefinition('teacher'),
    marketing: resolveDefinition('marketing'),
    finance: resolveDefinition('finance'),
    tasks: {
      title: t(TASKS_NAVIGATION_ITEM.labelKey),
      icon: KanbanSquare,
    },
  };
  const module = resource
    ? { title: t(resource.labelKey), icon: resource.icon }
    : moduleDefinitions[resolveModuleType(location, user?.module)];

  function resolveDefinition(moduleType: Exclude<ModuleType, 'tasks'>): ModuleDefinition {
    const definition = MODULE_NAVIGATION[moduleType];
    return {
      title: t(definition.nameKey),
      icon: definition.icon,
    };
  }

  return <ModuleIdentityView title={title ?? module.title} icon={module.icon} subtitle={subtitle} resource={Boolean(resource)} />;
}
