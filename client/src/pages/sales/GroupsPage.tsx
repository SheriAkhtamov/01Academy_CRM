import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { PageHeader } from '@/components/ux/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { GroupsWorkspace } from '@/features/groups/GroupsWorkspace';
import { groupConfigurationKey } from '@/features/groups/queries';
import type { GroupConfiguration } from '@/features/groups/types';
import { LoadingRegion } from '@/components/ui/loading-region';

export default function GroupsPage() {
  const { t } = useTranslation();
  const configuration = useQuery<GroupConfiguration>({ queryKey: groupConfigurationKey });
  return <ModulePage contained>
    <PageHeader title={t('navGroups')} />
    <ModulePageBody contained ariaLabel={t('navGroups')}>
      {configuration.isPending ? <LoadingRegion role="status" aria-label={t('loading')} className="space-y-4">
        <Skeleton className="h-44 w-full" /><Skeleton className="h-96 w-full" />
      </LoadingRegion> : configuration.isError || !configuration.data ? <Card>
        <CardHeader><CardTitle>{t('failedToLoadData')}</CardTitle></CardHeader>
        <CardContent><Button onClick={() => void configuration.refetch()}>{t('retry')}</Button></CardContent>
      </Card> : <GroupsWorkspace configuration={configuration.data} basePath="/sales/groups" showTitle={false} />}
    </ModulePageBody>
  </ModulePage>;
}
