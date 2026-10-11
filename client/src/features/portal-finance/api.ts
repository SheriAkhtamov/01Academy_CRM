import {
  portalResourcePageSchema,
  type PortalFinanceQuestionPageDto,
  type PortalFinanceQuestionDetailDto,
  type PortalPaymentAllocationDto,
  type PortalPaymentAllocationInput,
  type PortalUnallocatedPaymentsPageDto,
  type PortalResourcePageDto,
} from "@shared/contracts/portal-resources";
export class PortalFinanceApiError extends Error {
  constructor(public readonly status: number) {
    super("portalFinanceRequestFailed");
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/lms-management${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new PortalFinanceApiError(response.status);
  return response.json();
}
async function requestPage<TPage extends PortalResourcePageDto<unknown>>(
  path: string,
): Promise<TPage> {
  const parsed = portalResourcePageSchema.safeParse(
    await request<unknown>(path),
  );
  if (!parsed.success) throw new PortalFinanceApiError(502);
  return parsed.data as unknown as TPage;
}
export const portalFinanceApi = {
  allocation: (id: number) =>
    request<PortalPaymentAllocationDto>(`/payments/${id}/allocations`),
  saveAllocation: (id: number, input: PortalPaymentAllocationInput) =>
    request<{ success: boolean }>(`/payments/${id}/allocations`, "POST", input),
  unallocated: (cursor: number | null) =>
    requestPage<PortalUnallocatedPaymentsPageDto>(
      `/payments/needs-review?limit=30${cursor ? `&cursor=${cursor}` : ""}`,
    ),
  questionsPage: (cursor: number | null) =>
    requestPage<PortalFinanceQuestionPageDto>(
      `/finance-questions?limit=30${cursor ? `&cursor=${cursor}` : ""}`,
    ),
  question: (id: number) =>
    request<PortalFinanceQuestionDetailDto>(
      `/finance-questions/${id}/messages`,
    ),
  reply: (id: number, body: string, idempotencyKey: string) =>
    request<PortalFinanceQuestionDetailDto>(
      `/finance-questions/${id}/messages`,
      "POST",
      { body, idempotencyKey },
    ),
};
