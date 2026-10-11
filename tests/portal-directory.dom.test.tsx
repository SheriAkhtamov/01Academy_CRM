// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalAccessDirectory } from "../client/src/features/portal-access/PortalAccessDirectory";
import { i18n } from "../client/src/lib/i18n";
import type { PortalDirectoryPage, PortalDirectoryRow, PortalRepresentativePage } from "@shared/contracts/portal-directory";
const mocks = vi.hoisted(() => ({ students: vi.fn(), representatives: vi.fn(), export: vi.fn(), user: { id: 7, module: "administration", modules: ["administration"] } }));
vi.mock("../client/src/features/portal-access/directory-api", () => ({ portalDirectoryApi: mocks }));
vi.mock("../client/src/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../client/src/components/ux/StudentDetailDialog", () => ({ StudentDetailDialog: ({ student, open, initialTab, onOpenChange }: { student: { studentName: string } | null; open: boolean; initialTab: string; onOpenChange: (open: boolean) => void }) => open ? <div role="dialog" aria-label={student?.studentName} data-initial-tab={initialTab}><button onClick={() => onOpenChange(false)}>Close student</button></div> : null }));
let client: QueryClient;
const row: PortalDirectoryRow = {
  student: { id: 42, studentName: "Learner", contactName: "Contact", status: "studying", managerName: "Manager", leadId: 3, updatedAt: "2026-10-11T09:00:00Z", classification: "minor", groups: [{ id: 1, name: "Group One" }] },
  selfAccount: { accountId: 4, linkId: 8, fullName: "Learner", login: "learner.login", accountStatus: "pending", linkStatus: "pending", relationship: null, permissions: [], invitationStatus: "created", lastSeenAt: null },
  representatives: [{ accountId: 9, linkId: 12, fullName: "Parent", login: "parent.login", accountStatus: "active", linkStatus: "active", relationship: "parent", permissions: ["learning.read", "finance.read"], invitationStatus: "accepted", lastSeenAt: "2026-10-10T09:00:00Z" }],
  lastSeenAt: "2026-10-10T09:00:00Z", hasAccess: true, needsVerification: false, pendingActivation: true, blocked: false,
};
const page: PortalDirectoryPage = { items: [row], total: 40, page: 1, pageSize: 20, stats: { students: 40, accounts: 2, activatedAccounts: 1, activationPercent: 50, active7Days: 1, active30Days: 1, periodEnd: "2026-10-11T10:00:00Z" }, groups: [{ id: 1, name: "Group One" }] };
const representatives: PortalRepresentativePage = { items: [{ accountId: 9, fullName: "Parent", login: "parent.login", accountStatus: "active", lastSeenAt: row.lastSeenAt, students: [{ student: row.student, access: row.representatives[0] }] }], total: 1, page: 1, pageSize: 20, groups: page.groups };
const mount = (kind: "students" | "representatives" = "students", enabled = true) => render(<QueryClientProvider client={client}><PortalAccessDirectory kind={kind} enabled={enabled} /></QueryClientProvider>);
beforeEach(() => {
  i18n.setLanguage("en");
  mocks.students.mockReset(); mocks.representatives.mockReset(); mocks.export.mockReset();
  mocks.user = { id: 7, module: "administration", modules: ["administration"] };
  mocks.students.mockImplementation(async (query: { page: number; pageSize: number }) => ({ ...page, page: query.page, pageSize: query.pageSize }));
  mocks.representatives.mockResolvedValue(representatives);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
describe("Portal access administration directory UI", () => {
  it("shows account status, invitations and activation denominators and opens the existing student modal", async () => {
    mount();
    expect(await screen.findAllByText("learner.login")).toHaveLength(2);
    expect(screen.getAllByText("parent.login")).toHaveLength(2);
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getAllByText("1 of 2")).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open student: Learner" }));
    expect(await screen.findByRole("dialog", { name: "Learner" })).toHaveProperty("dataset.initialTab", "access");
    fireEvent.click(screen.getByRole("button", { name: "Close student" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.students.mock.calls.length).toBeGreaterThan(1);
  });
  it("resets pagination when filters, groups, search or page size change", async () => {
    mount(); await screen.findAllByText("learner.login");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("nextPage") }));
    await waitFor(() => expect(mocks.students).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.change(screen.getByLabelText(i18n.t("portalDirectoryFilter")), { target: { value: "pending" } });
    await waitFor(() => expect(mocks.students).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, filter: "pending" })));
    fireEvent.change(screen.getByLabelText(i18n.t("lmsStaffGroup")), { target: { value: "1" } });
    await waitFor(() => expect(mocks.students).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 1 })));
    fireEvent.change(screen.getByLabelText(i18n.t("portalDirectorySearch")), { target: { value: " parent.login " } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("search") }));
    await waitFor(() => expect(mocks.students).toHaveBeenLastCalledWith(expect.objectContaining({ q: "parent.login", page: 1 })));
    fireEvent.change(screen.getByLabelText(i18n.t("portalDirectoryPageSize")), { target: { value: "50" } });
    await waitFor(() => expect(mocks.students).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50, page: 1 })));
  });
  it("exports the selected filters and presents a localized limit error", async () => {
    mocks.export.mockRejectedValue(new Error("portalDirectoryExportLimit"));
    mount(); await screen.findAllByText("learner.login");
    fireEvent.change(screen.getByLabelText(i18n.t("lmsStaffGroup")), { target: { value: "1" } });
    await waitFor(() => expect(mocks.students).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 1 })));
    await waitFor(() => expect((screen.getByRole("button", { name: i18n.t("portalDirectoryExport") }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("portalDirectoryExport") }));
    await waitFor(() => expect(mocks.export).toHaveBeenCalledWith(expect.objectContaining({ groupId: 1 }), "en"));
    expect((await screen.findByRole("alert")).textContent).toBe(i18n.t("portalDirectoryExportLimit"));
  });
  it("shows representative permissions and opens the selected child without creating invitations", async () => {
    mount("representatives");
    expect(await screen.findByText("parent.login")).toBeTruthy();
    expect(screen.getByText(i18n.t("lmsStaffPermissionFinance"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: i18n.t("portalDirectoryExport") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open student: Learner" }));
    expect(await screen.findByRole("dialog", { name: "Learner" })).toBeTruthy();
    expect(mocks.students).not.toHaveBeenCalled(); expect(mocks.export).not.toHaveBeenCalled();
  });
  it("does not fetch or render directory data for staff outside administration or when disabled", () => {
    mocks.user = { id: 8, module: "sales", modules: ["sales"] };
    const view = mount(); expect(view.container.textContent).toBe(""); expect(mocks.students).not.toHaveBeenCalled();
    view.unmount(); mocks.user = { id: 7, module: "administration", modules: ["administration"] };
    mount("students", false); expect(mocks.students).not.toHaveBeenCalled();
  });
});
