import { useEffect } from 'react';
import { StudentContractFields } from './StudentContractFields';
import { useStudentContract } from './useStudentContract';

export function StudentContractTab({
  studentId,
  leadId,
  open,
  active,
  onDraftChange,
}: {
  studentId: number;
  leadId?: number | null;
  open: boolean;
  active: boolean;
  onDraftChange: (dirty: boolean, pending: boolean) => void;
}) {
  const controls = useStudentContract({ studentId, leadId: leadId ?? 0, open, enabled: active });

  useEffect(() => {
    onDraftChange(controls.numberChanged, controls.isPending);
  }, [controls.numberChanged, controls.isPending, onDraftChange]);

  useEffect(() => () => onDraftChange(false, false), [onDraftChange]);

  return <StudentContractFields controls={controls} />;
}
