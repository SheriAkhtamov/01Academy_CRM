import { useTranslation } from '@/hooks/useTranslation';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { PageHeader } from '@/components/ux/PageHeader';
import { ContractsDirectory } from '@/features/student-contracts/ContractsDirectory';

export default function ContractsPage() {
  const { t } = useTranslation();
  return <ModulePage contained>
    <PageHeader title={t('studentContractsTitle')} />
    <ModulePageBody contained ariaLabel={t('studentContractsTitle')}><ContractsDirectory /></ModulePageBody>
  </ModulePage>;
}
