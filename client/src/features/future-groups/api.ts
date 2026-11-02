import { apiRequest } from "@/lib/queryClient";
import type {
  FutureGroup,
  FutureGroupInput,
  FutureGroupMember,
  FutureGroupParty,
} from "@shared/contracts/future-groups";

export const futureGroupsKey = ["/api/academy/future-groups"] as const;
export const futureGroupsApi = {
  list: (): Promise<FutureGroup[]> =>
    apiRequest("GET", "/api/academy/future-groups"),
  save: (input: FutureGroupInput, id?: number): Promise<{ id: number }> =>
    apiRequest(
      id ? "PATCH" : "POST",
      `/api/academy/future-groups${id ? `/${id}` : ""}`,
      input,
    ),
  members: (id: number): Promise<FutureGroupMember[]> =>
    apiRequest("GET", `/api/academy/future-groups/${id}/members`),
  candidates: (q: string): Promise<FutureGroupMember[]> =>
    apiRequest(
      "GET",
      `/api/academy/future-groups/candidates?q=${encodeURIComponent(q)}`,
    ),
  add: (id: number, party: FutureGroupParty) =>
    apiRequest("POST", `/api/academy/future-groups/${id}/members`, party),
  remove: (id: number, party: FutureGroupParty) =>
    apiRequest(
      "DELETE",
      `/api/academy/future-groups/${id}/members/${party.kind}/${party.id}`,
    ),
  archive: (id: number) =>
    apiRequest("POST", `/api/academy/future-groups/${id}/archive`),
};
