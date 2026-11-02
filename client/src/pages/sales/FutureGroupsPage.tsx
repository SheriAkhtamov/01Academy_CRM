import { ModulePage, ModulePageBody } from "@/components/ux/ModulePage";
import { FutureGroupsWorkspace } from "@/features/future-groups/FutureGroupsWorkspace";
import { useTranslation } from "@/hooks/useTranslation";

export default function FutureGroupsPage() {
  const { t } = useTranslation();
  return (
    <ModulePage contained>
      <ModulePageBody contained ariaLabel={t("futureGroupsTitle")}>
        <FutureGroupsWorkspace />
      </ModulePageBody>
    </ModulePage>
  );
}
