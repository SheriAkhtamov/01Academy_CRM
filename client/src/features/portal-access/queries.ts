import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PortalInvitationCreateCommand } from "@shared/contracts/portal-identity";
import { portalAccessApi } from "./api";

export function useStudentPortalAccess(
  studentId: number,
  staffAccountId: number,
  enabled: boolean,
) {
  const client = useQueryClient();
  const queryKey = ["staff-portal-access", staffAccountId, studentId] as const;
  const refresh = () => client.invalidateQueries({ queryKey });
  const query = useQuery({
    queryKey,
    queryFn: () => portalAccessApi.get(studentId),
    enabled,
    staleTime: 0,
  });
  const invitation = useMutation({
    mutationFn: (input: PortalInvitationCreateCommand) =>
      portalAccessApi.invite(studentId, input),
    onSuccess: refresh,
  });
  const classification = useMutation({
    mutationFn: (input: Parameters<typeof portalAccessApi.classify>[1]) =>
      portalAccessApi.classify(studentId, input),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (linkId: number) => portalAccessApi.revoke(studentId, linkId),
    onSuccess: refresh,
  });
  const permissions = useMutation({
    mutationFn: ({
      linkId,
      ...input
    }: Parameters<typeof portalAccessApi.permissions>[2] & {
      linkId: number;
    }) => portalAccessApi.permissions(studentId, linkId, input),
    onSuccess: refresh,
  });
  const recovery = useMutation({
    mutationFn: ({
      accountId,
      ...input
    }: Parameters<typeof portalAccessApi.recover>[2] & { accountId: number }) =>
      portalAccessApi.recover(studentId, accountId, input),
    onSuccess: refresh,
  });
  const accountStatus = useMutation({
    mutationFn: ({
      accountId,
      status,
    }: {
      accountId: number;
      status: "active" | "suspended";
    }) => portalAccessApi.accountStatus(studentId, accountId, status),
    onSuccess: refresh,
  });
  const lookup = useMutation({
    mutationFn: (login: string) => portalAccessApi.lookup(studentId, login),
  });
  const checkContacts = useMutation({
    mutationFn: (contact: Parameters<typeof portalAccessApi.checkContacts>[1]) => portalAccessApi.checkContacts(studentId, contact),
  });
  return {
    query,
    invitation,
    classification,
    revoke,
    permissions,
    recovery,
    accountStatus,
    lookup,
    checkContacts,
  };
}
export type StudentPortalAccessControls = ReturnType<
  typeof useStudentPortalAccess
>;
