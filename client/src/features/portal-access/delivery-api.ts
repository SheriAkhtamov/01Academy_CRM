import { portalDeliveryPageSchema, portalDeliveryRetryResultSchema, type PortalDeliveryKind, type PortalDeliveryQuery, type PortalDeliveryRetry } from "@shared/contracts/portal-delivery-management";
export class PortalDeliveryRequestError extends Error {
  constructor(public readonly code: "portalDeliveryConflict" | "portalDeliveryRetryUnavailable" | "portalDeliveryLoadFailed") { super(code); }
}
async function request(method: "GET" | "POST", path: string, body?: PortalDeliveryRetry) {
  const response = await fetch(`/api/lms-management${path}`, { method, credentials: "include", cache: "no-store",
    headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result && typeof result === "object" && "code" in result ? result.code : null;
    throw new PortalDeliveryRequestError(code === "portalDeliveryConflict" || code === "portalDeliveryRetryUnavailable" ? code : "portalDeliveryLoadFailed");
  }
  return result;
}
export const portalDeliveryApi = {
  list: async (query: PortalDeliveryQuery) => {
    const search = new URLSearchParams({ kind: query.kind, limit: String(query.limit) });
    if (query.cursor) search.set("cursor", query.cursor);
    return portalDeliveryPageSchema.parse(await request("GET", `/delivery-failures?${search}`));
  },
  retry: async (kind: PortalDeliveryKind, id: number, command: PortalDeliveryRetry) =>
    portalDeliveryRetryResultSchema.parse(await request("POST", `/delivery-failures/${kind}/${id}/retry`, command)),
};
