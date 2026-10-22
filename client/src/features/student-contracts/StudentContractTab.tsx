import { useEffect } from 'react';
import { StudentContractFields } from './StudentContractFields';
import { StudentContractPreview } from './StudentContractPreview';
import { useStudentContract } from './useStudentContract';

export function StudentContractTab({
  studentId,
  leadId,
  open,
  active,
  onDraftChange,
  compact = false,
}: {
  studentId: number;
  leadId?: number | null;
  open: boolean;
  active: boolean;
  compact?: boolean;
  onDraftChange: (dirty: boolean, pending: boolean) => void;
}) {
  const controls = useStudentContract({ studentId, leadId: leadId ?? 0, open, enabled: active });

  useEffect(() => {
    onDraftChange(controls.numberChanged, controls.isPending);
  }, [controls.numberChanged, controls.isPending, onDraftChange]);

  useEffect(() => () => onDraftChange(false, false), [onDraftChange]);

  return (
    <div className="space-y-3">
      <StudentContractFields controls={controls} compact={compact} />
      {open && active && controls.contract?.file ? (
        <StudentContractPreview key={controls.contract.id} contract={controls.contract} file={controls.contract.file} />
      ) : null}
    </div>
  );
}
