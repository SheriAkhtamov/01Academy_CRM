const draftKey = (accountId: number, leadId: number) => `student-contract-draft:${accountId}:${leadId}`;

export function readContractDraft(accountId: number, leadId: number): string | null {
  try {
    return sessionStorage.getItem(draftKey(accountId, leadId));
  } catch {
    return null;
  }
}

export function rememberContractDraft(accountId: number, leadId: number, contractId: string | null) {
  try {
    if (contractId) sessionStorage.setItem(draftKey(accountId, leadId), contractId);
    else sessionStorage.removeItem(draftKey(accountId, leadId));
  } catch {
    // The active form still retains its draft when browser storage is unavailable.
  }
}
