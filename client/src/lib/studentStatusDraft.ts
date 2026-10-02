export interface StudentStatusSnapshot {
  id: number | null;
  status: string;
  exitReason: string;
}

export interface StudentStatusDraft {
  baseline: StudentStatusSnapshot;
  status: string;
  exitReason: string;
  incoming: StudentStatusSnapshot | null;
}

export const createStudentStatusDraft = (snapshot: StudentStatusSnapshot): StudentStatusDraft => ({
  baseline: snapshot, status: snapshot.status, exitReason: snapshot.exitReason, incoming: null,
});

export const studentStatusIsDirty = (draft: StudentStatusDraft) => (
  draft.status !== draft.baseline.status || draft.exitReason !== draft.baseline.exitReason
);

export const reconcileStudentStatusDraft = (draft: StudentStatusDraft, snapshot: StudentStatusSnapshot): StudentStatusDraft => {
  if (draft.baseline.id !== snapshot.id) return createStudentStatusDraft(snapshot);
  if (draft.baseline.status === snapshot.status && draft.baseline.exitReason === snapshot.exitReason) {
    return draft.incoming ? { ...draft, incoming: null } : draft;
  }
  return studentStatusIsDirty(draft)
    ? { ...draft, incoming: snapshot }
    : createStudentStatusDraft(snapshot);
};
