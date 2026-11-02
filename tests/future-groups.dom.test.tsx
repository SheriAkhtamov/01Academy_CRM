// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FutureGroupsPage from "../client/src/pages/sales/FutureGroupsPage";
import { FutureGroupDialog } from "../client/src/features/future-groups/FutureGroupDialog";
import { i18n } from "../client/src/lib/i18n";
import type { FutureGroup } from "../shared/contracts/future-groups";
import type { GroupConfiguration } from "../client/src/features/groups/types";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  members: vi.fn(),
  candidates: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  archive: vi.fn(),
  payment: vi.fn(),
}));
vi.mock("../client/src/features/future-groups/api", () => ({
  futureGroupsKey: ["/api/academy/future-groups"],
  futureGroupsApi: api,
}));
vi.mock("../client/src/features/payments/api", () => ({
  paymentsApi: { create: api.payment },
}));
const group: FutureGroup = {
  id: 1,
  name: "CYP-AI-GRP-26-0001 — Вечер",
  nameSuffix: "Вечер",
  courseId: 1,
  schoolId: 1,
  courseName: "AI Kids",
  schoolName: "Cyberpark",
  deliveryMode: "offline",
  maxStudents: 12,
  startDate: null,
  teacherId: null,
  teacherName: null,
  roomId: null,
  roomName: null,
  schedule: [],
  lessonDurationMinutes: 120,
  currentStudents: 2,
  reservedStudents: 3,
  paidMembers: 1,
  paidAmountUzs: 100000,
  isArchived: false,
  updatedAt: "2026-11-02T12:00:00.000Z",
};
const configuration: GroupConfiguration = {
  schools: [{ id: 1, name: "Cyberpark", isActive: true }],
  courses: [{ id: 1, name: "AI Kids", isActive: true }],
  rooms: [],
  teachers: [],
  groups: [],
} as unknown as GroupConfiguration;
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  i18n.setLanguage("ru");
  localStorage.clear();
  api.list.mockResolvedValue([group]);
  api.members.mockResolvedValue([]);
  api.candidates.mockResolvedValue([]);
  api.save.mockResolvedValue({ id: 1 });
  api.add.mockResolvedValue({ ok: true });
  api.remove.mockResolvedValue({ ok: true });
  api.payment.mockResolvedValue({ id: 9 });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, queryFn: async () => configuration },
    },
  });
});
afterEach(async () => {
  cleanup();
  client.clear();
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});
const wrap = (node: React.ReactNode) =>
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
const open = async () => {
  wrap(<FutureGroupsPage />);
  await screen.findByText(group.name);
  await userEvent.click(screen.getByRole("button", { name: "Редактировать" }));
  return screen.getByRole("dialog");
};
it("shows a list of future groups and opens editing in a modal", async () => {
  const dialog = await open();
  expect(
    screen.getByRole("list", { name: "Будущие группы", hidden: true }),
  ).toBeTruthy();
  expect(
    within(dialog).getByRole("heading", {
      name: "Редактировать будущую группу",
    }),
  ).toBeTruthy();
  expect(within(dialog).getByLabelText("Дата начала")).toBeTruthy();
  expect(
    within(dialog).getByRole("button", { name: "Сохранить изменения" }),
  ).toBeTruthy();
});
it("saves unspecified date, room and teacher without requiring academic setup", async () => {
  const dialog = await open();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Сохранить изменения" }),
  );
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: null,
        roomId: null,
        teacherId: null,
        schedule: [],
        expectedUpdatedAt: group.updatedAt,
      }),
      1,
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("preserves edited fields after a failed save and requires confirmation to discard", async () => {
  api.save.mockRejectedValue(Error("network"));
  const dialog = await open();
  const name = within(dialog).getByLabelText("Название группы");
  await userEvent.clear(name);
  await userEvent.type(name, "Новый вечер");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Сохранить изменения" }),
  );
  await screen.findByRole("alert");
  expect((name as HTMLInputElement).value).toBe("Новый вечер");
  await userEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
});
it("blocks repeated submit while saving and does not overwrite a draft on a background refresh", async () => {
  let resolve!: (value: { id: number }) => void;
  api.save.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const dialog = await open();
  const form = within(dialog)
    .getByRole("button", { name: "Сохранить изменения" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(
    within(dialog)
      .getByRole("button", { name: "Отмена" })
      .hasAttribute("disabled"),
  ).toBe(true);
  resolve({ id: 1 });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("records payment against the selected group and participant", async () => {
  api.members.mockResolvedValue([
    {
      kind: "student",
      id: 21,
      leadId: 11,
      studentName: "Ученик",
      contactName: "Родитель",
      managerName: "Менеджер",
      paidAmountUzs: 0,
      canManage: true,
    },
  ]);
  const dialog = await open();
  await within(dialog).findByText("Ученик");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Внести оплату" }),
  );
  const payment = screen
    .getAllByRole("dialog")
    .find((el) =>
      within(el).queryByRole("heading", { name: "Внести оплату" }),
    )!;
  await userEvent.type(within(payment).getByLabelText(/Сумма/), "100000");
  await userEvent.click(
    within(payment).getByRole("button", { name: "Подтвердить оплату" }),
  );
  await waitFor(() =>
    expect(api.payment).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 1,
        leadId: 11,
        studentId: 21,
        amountUzs: 100000,
        type: "prepayment",
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Внести оплату" })).toBeNull(),
  );
  expect(api.save).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: "Редактировать будущую группу" }),
  ).toBeTruthy();
});
it("keeps membership actions separate from an unsaved group draft", async () => {
  api.members.mockResolvedValue([
    {
      kind: "lead",
      id: 11,
      leadId: 11,
      studentName: "Ребёнок",
      contactName: "Родитель",
      managerName: "Менеджер",
      paidAmountUzs: 0,
      canManage: true,
    },
  ]);
  const onClose = vi.fn();
  wrap(
    <FutureGroupDialog
      group={group}
      configuration={configuration}
      onClose={onClose}
      onPrepare={vi.fn()}
    />,
  );
  const name = screen.getByLabelText("Название группы");
  await userEvent.clear(name);
  await userEvent.type(name, "Черновик");
  await userEvent.click(
    await screen.findByRole("button", { name: "Отменить запись" }),
  );
  const confirmation = screen.getByRole("alertdialog");
  await userEvent.click(
    within(confirmation).getByRole("button", { name: "Убрать" }),
  );
  await waitFor(() =>
    expect(api.remove).toHaveBeenCalledWith(1, { kind: "lead", id: 11 }),
  );
  expect((name as HTMLInputElement).value).toBe("Черновик");
  expect(onClose).not.toHaveBeenCalled();
});
