import {
  LearningManagement,
  type LearningManagementTab,
} from "@/features/lms-staff/management";
export function LearningManagementPage({
  administration = false,
  initialTab,
}: {
  administration?: boolean;
  initialTab?: LearningManagementTab;
}) {
  return (
    <LearningManagement
      administration={administration}
      initialTab={initialTab}
    />
  );
}
export default LearningManagementPage;
