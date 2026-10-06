import { ModulePage } from '@/components/ux/ModulePage';
import { PageHeader } from '@/components/ux/PageHeader';
import { useTranslation } from '@/hooks/useTranslation';
import { RESOURCE_NAVIGATION_ITEMS, type ResourcePageId } from '@/lib/moduleNavigation';

export default function ResourcePage({ resource }: { resource: ResourcePageId }) {
  const { t } = useTranslation();
  const definition = RESOURCE_NAVIGATION_ITEMS.find((item) => item.id === resource)!;
  const Icon = definition.icon;

  return (
    <ModulePage>
      <PageHeader title={t(definition.labelKey)} />
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden="true">
          <Icon className="size-6" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">{t('resourceComingSoon')}</p>
      </div>
    </ModulePage>
  );
}
