// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PortalPaymentAllocationDto } from "../shared/contracts/portal-resources";
import { PaymentAllocationDialog } from "../client/src/features/portal-finance/PaymentAllocationDialog";
import { PortalFinanceApiError } from "../client/src/features/portal-finance/api";
import { i18n } from "../client/src/lib/i18n";

const mocks = vi.hoisted(() => ({
  allocation: vi.fn(),
  saveAllocation: vi.fn(),
  closed: vi.fn(),
}));
vi.mock("../client/src/features/portal-finance/api", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../client/src/features/portal-finance/api")
    >();
  return {
    ...actual,
    portalFinanceApi: {
      ...actual.portalFinanceApi,
      allocation: mocks.allocation,
      saveAllocation: mocks.saveAllocation,
    },
  };
});
const allocation: PortalPaymentAllocationDto = {
  paymentId: 88,
  amountUzs: 1000,
  version: 7,
  students: [
    { id: 20, name: "Alice Brown", amountUzs: 300 },
    { id: 21, name: "Child Cedar", amountUzs: 500 },
  ],
};
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  i18n.setLanguage("ru");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.allocation.mockResolvedValue(structuredClone(allocation));
  mocks.saveAllocation.mockResolvedValue({ success: true });
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  client.clear();
});
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>
        {i18n.t("lmsPaymentAllocationAction")}
      </button>
      {open && (
        <PaymentAllocationDialog
          paymentId={88}
          money={(value) => `${value} UZS`}
          onClose={() => {
            mocks.closed();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
async function openAllocation() {
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  const opener = screen.getByRole("button", {
    name: i18n.t("lmsPaymentAllocationAction"),
  });
  await userEvent.click(opener);
  await screen.findByLabelText("Alice Brown");
  return opener;
}
function changeAmount(name: string, amount: string) {
  fireEvent.change(screen.getByLabelText(name), { target: { value: amount } });
}
function changeReason(reason = "Separate children") {
  fireEvent.change(
    screen.getByLabelText(i18n.t("lmsPaymentAllocationReason")),
    { target: { value: reason } },
  );
}
function saveButton() {
  return screen.getByRole("button", { name: i18n.t("save") });
}

it("does not mutate an allocation until the named AlertDialog is confirmed and keeps the original CAS version after refetch", async () => {
  await openAllocation();
  changeAmount("Alice Brown", "400");
  changeReason();
  mocks.allocation.mockResolvedValue({
    ...allocation,
    version: 8,
    students: allocation.students.map((student) => ({
      ...student,
      amountUzs: 0,
    })),
  });
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["portal-finance", "allocation", 88],
    });
  });
  expect(
    (screen.getByLabelText("Alice Brown") as HTMLInputElement).value.replace(
      /\D/g,
      "",
    ),
  ).toBe("400");
  await userEvent.click(saveButton());
  const confirmation = screen.getByRole("alertdialog", {
    name: i18n.t("lmsPaymentAllocationConfirm"),
  });
  expect(confirmation.textContent).toContain("Alice Brown: 400 UZS");
  expect(confirmation.textContent).toContain("Child Cedar: 500 UZS");
  expect(mocks.saveAllocation).not.toHaveBeenCalled();
  await userEvent.click(
    within(confirmation).getByRole("button", { name: i18n.t("cancel") }),
  );
  expect(mocks.saveAllocation).not.toHaveBeenCalled();
  expect(mocks.closed).not.toHaveBeenCalled();
  await userEvent.click(saveButton());
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("save"),
    }),
  );
  await waitFor(() =>
    expect(mocks.saveAllocation).toHaveBeenCalledWith(88, {
      version: 7,
      reason: "Separate children",
      allocations: [
        { studentId: 20, amountUzs: 400 },
        { studentId: 21, amountUzs: 500 },
      ],
    }),
  );
  await waitFor(() => expect(mocks.closed).toHaveBeenCalledOnce());
});

it("blocks allocations larger than the payment before opening a confirmation or sending a mutation", async () => {
  await openAllocation();
  changeAmount("Alice Brown", "600");
  changeReason();
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("lmsPaymentAllocationExceeds"),
  );
  expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(saveButton());
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(mocks.saveAllocation).not.toHaveBeenCalled();
});

it("preserves allocation values and reason after a version conflict and asks before discarding the failed draft", async () => {
  mocks.saveAllocation.mockRejectedValue(new PortalFinanceApiError(409));
  await openAllocation();
  changeAmount("Alice Brown", "400");
  changeReason("Correct family allocation");
  await userEvent.click(saveButton());
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("save"),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      i18n.t("portalIdentityConflict"),
    ),
  );
  expect(
    (screen.getByLabelText("Alice Brown") as HTMLInputElement).value.replace(
      /\D/g,
      "",
    ),
  ).toBe("400");
  expect(
    (
      screen.getByLabelText(
        i18n.t("lmsPaymentAllocationReason"),
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("Correct family allocation");
  expect(mocks.closed).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: i18n.t("cancel") }));
  const warning = screen.getByRole("alertdialog", {
    name: i18n.t("unsavedChangesTitle"),
  });
  await userEvent.click(
    within(warning).getByRole("button", { name: i18n.t("keepEditing") }),
  );
  expect(mocks.closed).not.toHaveBeenCalled();
  expect(
    (
      screen.getByLabelText(
        i18n.t("lmsPaymentAllocationReason"),
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("Correct family allocation");
  await userEvent.click(screen.getByRole("button", { name: i18n.t("cancel") }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("discardChanges"),
    }),
  );
  await waitFor(() => expect(mocks.closed).toHaveBeenCalledOnce());
  expect(mocks.saveAllocation).toHaveBeenCalledOnce();
});

it("restores focus to the caller after the loading Dialog is replaced by the allocation form", async () => {
  let resolve: ((value: PortalPaymentAllocationDto) => void) | undefined;
  mocks.allocation.mockReturnValue(
    new Promise<PortalPaymentAllocationDto>((done) => {
      resolve = done;
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  const opener = screen.getByRole("button", {
    name: i18n.t("lmsPaymentAllocationAction"),
  });
  await userEvent.click(opener);
  expect(screen.getByRole("status").textContent).toBe(i18n.t("loading"));
  await act(async () => {
    resolve?.(structuredClone(allocation));
  });
  await screen.findByLabelText("Alice Brown");
  await userEvent.click(screen.getByRole("button", { name: i18n.t("cancel") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(mocks.saveAllocation).not.toHaveBeenCalled();
});
