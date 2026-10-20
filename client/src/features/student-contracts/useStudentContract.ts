import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_STUDENT_CONTRACT_BYTES,
  STUDENT_CONTRACT_FILE_ACCEPT,
  studentContractNumberSchema,
  type StudentContract,
} from '@shared/contracts/student-contracts';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { localizeApiErrorMessage } from '@/lib/queryClient';
import { studentContractsApi } from './api';
import { readContractDraft, rememberContractDraft } from './draft-storage';

type ContractOperation =
  | { kind: 'create' }
  | { kind: 'number'; contract: StudentContract; number: string }
  | { kind: 'regenerate'; contract: StudentContract }
  | { kind: 'file'; contract: StudentContract; file: File }
  | { kind: 'cancel'; contract: StudentContract };

type ContractTarget = {
  identity: string;
  queryKey: (string | number)[];
  accountId: number;
  leadId: number;
  studentId?: number;
};
type ContractAction = ContractOperation & { target: ContractTarget };
type ContractError = Error & { status?: number };

export function useStudentContract({
  studentId,
  leadId,
  open,
}: {
  studentId?: number;
  leadId: number;
  open: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const accountId = user?.id ?? 0;
  const queryClient = useQueryClient();
  const identity = `${accountId}:${studentId ? `student:${studentId}` : `lead:${leadId}`}`;
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const target = useMemo<ContractTarget>(() => ({
    identity,
    queryKey: studentId
      ? ['student-contract', accountId, studentId]
      : ['student-contract-draft', accountId, leadId],
    accountId,
    studentId,
    leadId,
  }), [accountId, identity, leadId, studentId]);
  const [draftRecord, setDraftRecord] = useState(() => ({
    identity,
    id: studentId ? null : readContractDraft(accountId, leadId),
  }));
  const draftId = draftRecord.identity === identity ? draftRecord.id : readContractDraft(accountId, leadId);
  const [numberDraft, setNumberDraft] = useState<{ contractId: string; value: string } | null>(null);
  const [errorRecord, setErrorRecord] = useState<{ identity: string; message: string } | null>(null);
  const setError = (message: string | null) => setErrorRecord(message ? { identity, message } : null);
  const error = errorRecord?.identity === identity ? errorRecord.message : null;
  const shouldLoad = Boolean(studentId || draftId);
  const query = useQuery<StudentContract | null>({
    queryKey: target.queryKey,
    queryFn: async ({ signal }) => {
      if (studentId) return studentContractsApi.forStudent(studentId);
      if (!draftId) return null;
      try {
        const restored = await studentContractsApi.get(draftId);
        if (restored.studentId === null) return restored;
      } catch (error) {
        if ((error as ContractError).status !== 404) throw error;
      }
      if (signal.aborted) return null;
      // A draft may already have been attached or cancelled in another window.
      rememberContractDraft(accountId, leadId, null);
      if (activeIdentity.current === identity) setDraftRecord({ identity, id: null });
      return null;
    },
    enabled: open && shouldLoad,
    staleTime: 0,
    retry: false,
  });
  const inaccessible = query.isError && [403, 404].includes((query.error as ContractError).status ?? 0);
  const contract = inaccessible ? null : query.data ?? null;
  const number = numberDraft && numberDraft.contractId === contract?.id
    ? numberDraft.value
    : contract?.number ?? '';
  const numberChanged = Boolean(contract && number.trim() !== contract.number);

  const operation = useMutation<StudentContract | null, ContractError, ContractAction>({
    onMutate: (action) => queryClient.cancelQueries({ queryKey: action.target.queryKey }),
    mutationFn: async (action) => {
      if (action.kind === 'create') {
        return action.target.studentId
          ? studentContractsApi.create(action.target.studentId)
          : studentContractsApi.createDraft(action.target.leadId);
      }
      const { id, version } = action.contract;
      if (action.kind === 'number') return studentContractsApi.changeNumber(id, action.number, version);
      if (action.kind === 'regenerate') return studentContractsApi.regenerate(id, version);
      if (action.kind === 'file') return studentContractsApi.uploadFile(id, action.file, version);
      await studentContractsApi.cancel(id, version);
      return null;
    },
    onSuccess: (next, action) => {
      queryClient.setQueryData(action.target.queryKey, next);
      if (!action.target.studentId) {
        const nextDraftId = next?.id ?? null;
        rememberContractDraft(action.target.accountId, action.target.leadId, nextDraftId);
        if (activeIdentity.current === action.target.identity) {
          setDraftRecord({ identity: action.target.identity, id: nextDraftId });
        }
      }
      if (activeIdentity.current !== action.target.identity) return;
      if (action.kind !== 'file') setNumberDraft(null);
      setErrorRecord(null);
    },
    onError: (error, action) => {
      if (activeIdentity.current === action.target.identity) {
        setErrorRecord({ identity: action.target.identity, message: localizeApiErrorMessage(error.message, error.status ?? 0) });
      }
      if (error.status === 409 || error.status === 403 || error.status === 404) {
        void queryClient.invalidateQueries({ queryKey: action.target.queryKey });
      }
    },
  });

  useEffect(() => {
    if (open) return;
    setNumberDraft(null);
    setErrorRecord(null);
  }, [open]);

  const run = async (action: ContractOperation) => {
    if (operation.isPending || query.isError) return false;
    setError(null);
    try {
      await operation.mutateAsync({ ...action, target });
      return true;
    } catch {
      return false;
    }
  };

  const saveNumber = async () => {
    if (!contract || !numberChanged) return true;
    const parsed = studentContractNumberSchema.safeParse(number);
    if (!parsed.success) {
      setError(t('studentContractNumberInvalid'));
      return false;
    }
    return run({ kind: 'number', contract, number: parsed.data });
  };

  const validateFile = (file: File) => {
    if (file.size > MAX_STUDENT_CONTRACT_BYTES) {
      setError(t('studentContractFileTooLarge'));
      return false;
    }
    const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
    if (!STUDENT_CONTRACT_FILE_ACCEPT.split(',').includes(extension)) {
      setError(t('studentContractFileTypeInvalid'));
      return false;
    }
    if (!file.size) {
      setError(t('studentContractFileRequired'));
      return false;
    }
    setError(null);
    return true;
  };

  return {
    contract,
    number,
    numberChanged,
    draftId: !studentId ? contract?.id : undefined,
    isLoading: open && shouldLoad && query.isPending,
    isPending: operation.isPending,
    error,
    loadError: query.isError ? t('studentContractLoadFailed') : null,
    refetch: () => void query.refetch(),
    changeNumber: (value: string) => {
      if (contract) setNumberDraft({ contractId: contract.id, value });
      setError(null);
    },
    create: () => run({ kind: 'create' }),
    saveNumber,
    regenerate: () => contract ? run({ kind: 'regenerate', contract }) : Promise.resolve(false),
    cancel: () => contract ? run({ kind: 'cancel', contract }) : Promise.resolve(false),
    validateFile,
    uploadFile: (file: File) => contract && validateFile(file)
      ? run({ kind: 'file', contract, file })
      : Promise.resolve(false),
    releaseAttachedDraft: () => {
      rememberContractDraft(accountId, leadId, null);
      setDraftRecord({ identity, id: null });
      setNumberDraft(null);
      queryClient.setQueryData(target.queryKey, null);
    },
  };
}

export type StudentContractControls = ReturnType<typeof useStudentContract>;
