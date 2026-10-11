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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudentPortalAccessTab } from "../client/src/features/portal-access/StudentPortalAccessTab";
import { i18n } from "../client/src/lib/i18n";
import type {
  PortalAccessLinkDto,
  PortalStudentAccessDto,
} from "@shared/contracts/portal-identity";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  lookup: vi.fn(),
  checkContacts: vi.fn(),
  classify: vi.fn(),
  invite: vi.fn(),
  revoke: vi.fn(),
  permissions: vi.fn(),
  recover: vi.fn(),
  accountStatus: vi.fn(),
}));
vi.mock("../client/src/features/portal-access/api", () => ({
  portalAccessApi: mocks,
}));
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  ResizeObserverStub;
(Element.prototype as unknown as Record<string, unknown>).hasPointerCapture =
  () => false;
(Element.prototype as unknown as Record<string, unknown>).setPointerCapture =
  () => undefined;
(
  Element.prototype as unknown as Record<string, unknown>
).releasePointerCapture = () => undefined;
(Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () =>
  undefined;
const link: PortalAccessLinkDto = {
  id: 4,
  account: {
    id: 9,
    login: "parent.login",
    fullName: "Parent One",
    email: null,
    phone: null,
    locale: "en",
    status: "active",
  },
  kind: "representative",
  relationship: "parent",
  permissions: ["learning.read", "attendance.read"],
  status: "active",
  verifiedAt: "2026-10-11T10:00:00Z",
  invitation: null,
};
let data: PortalStudentAccessDto;
const renderAccess = (
  props: Partial<React.ComponentProps<typeof StudentPortalAccessTab>> = {},
) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <StudentPortalAccessTab
        studentId={42}
        studentName="Student One"
        staffAccountId={7}
        canManageAccess
        {...props}
      />
    </QueryClientProvider>,
  );
const openInvitation = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Invite" }));
  return screen.findByRole("dialog", { name: "Invite" });
};
const next = () =>
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
const fillVerification = () => {
  fireEvent.change(screen.getByLabelText("Verification method"), {
    target: { value: "In person" },
  });
  fireEvent.change(screen.getByLabelText("Access basis"), {
    target: { value: "Confirmed with student" },
  });
};

beforeEach(() => {
  i18n.setLanguage("en");
  vi.clearAllMocks();
  data = {
    studentId: 42,
    studentName: "Student One",
    classification: "minor",
    links: [structuredClone(link)],
  };
  mocks.get.mockImplementation(async () => data);
  mocks.lookup.mockResolvedValue({
    id: 9,
    login: "parent.login",
    fullName: "Parent One",
    status: "active",
  });
  mocks.checkContacts.mockResolvedValue({ items: [], additionalMatches: false });
  mocks.classify.mockResolvedValue(data);
  mocks.revoke.mockResolvedValue({ success: true });
  mocks.permissions.mockResolvedValue(data);
  mocks.recover.mockResolvedValue({ success: true });
  mocks.accountStatus.mockResolvedValue(data);
  mocks.invite.mockResolvedValue({
    invitationId: 13,
    linkId: 4,
    accountId: 9,
    expiresAt: "2026-10-14T10:00:00Z",
    activationUrl:
      "https://academy.example/learn/activate#token=one-time-secret",
    status: "created",
    replayed: false,
  });
});
afterEach(cleanup);

describe("staff student portal access modal workflows", () => {
  it("creates self access only after completing and reviewing an explicit invitation", async () => {
    renderAccess();
    const dialog = await openInvitation();
    expect(
      within(dialog).getByRole("button", { name: "Student" }),
    ).toBeTruthy();
    expect(mocks.invite).not.toHaveBeenCalled();
    next();
    fireEvent.change(screen.getByLabelText("Login"), {
      target: { value: "adult.student" },
    });
    next();
    fillVerification();
    next();
    expect(screen.getByText("Review invitation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() =>
      expect(mocks.invite).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          kind: "self",
          relationship: null,
          permissions: [],
          account: expect.objectContaining({
            login: "adult.student",
            fullName: "Student One",
          }),
          channel: "manual",
        }),
      ),
    );
    expect(
      await screen.findByRole("dialog", { name: "Invitation created" }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Copy link") as HTMLInputElement).value,
    ).toContain("#token=");
  });
  it("links an existing verified parent through exact login lookup with selected permissions", async () => {
    renderAccess();
    await openInvitation();
    fireEvent.click(
      screen.getByRole("button", { name: "Parent or representative" }),
    );
    next();
    fireEvent.click(screen.getByRole("button", { name: "Existing account" }));
    fireEvent.change(screen.getByLabelText("Login"), {
      target: { value: "parent.login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find account" }));
    await waitFor(() =>
      expect(mocks.lookup).toHaveBeenCalledWith(42, "parent.login"),
    );
    expect(
      await within(screen.getByRole("dialog", { name: "Invite" })).findByText(
        "Parent One",
      ),
    ).toBeTruthy();
    next();
    expect(screen.queryByRole("checkbox", { name: "Assignments" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Quizzes" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Payments" }));
    fillVerification();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() =>
      expect(mocks.invite).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          accountId: 9,
          kind: "representative",
          relationship: "parent",
          permissions: expect.arrayContaining(["finance.read"]),
        }),
      ),
    );
    expect(mocks.invite.mock.calls[0][1].account).toBeUndefined();
  });
  it("validates login inline and keeps the wizard on its account step", async () => {
    renderAccess();
    await openInvitation();
    next();
    fireEvent.change(screen.getByLabelText("Login"), {
      target: { value: "family@example.com" },
    });
    next();
    expect(await screen.findByText(/Use 4–32 Latin letters/)).toBeTruthy();
    expect(mocks.invite).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Login").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
  it("requires confirmation before revoking a relationship", async () => {
    renderAccess();
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke access" }),
    );
    expect(mocks.revoke).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog", {
      name: "Revoke access?",
    });
    expect(within(dialog).getByText(/Parent One · Student One/)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Revoke access" }),
    );
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith(42, 4));
  });
  it("collects verification and confirms before resetting another person’s credentials", async () => {
    renderAccess();
    fireEvent.click(
      await screen.findByRole("button", { name: "Reset sign-in" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Reset sign-in" });
    fireEvent.change(within(dialog).getByLabelText("New password"), {
      target: { value: "ValidPassword123!" },
    });
    fireEvent.change(within(dialog).getByLabelText("Repeat password"), {
      target: { value: "ValidPassword123!" },
    });
    fillVerification();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reset sign-in" }),
    );
    expect(mocks.recover).not.toHaveBeenCalled();
    const warning = await screen.findByRole("alertdialog", {
      name: "Reset sign-in?",
    });
    fireEvent.click(
      within(warning).getByRole("button", { name: "Reset sign-in" }),
    );
    await waitFor(() =>
      expect(mocks.recover).toHaveBeenCalledWith(42, 9, {
        password: "ValidPassword123!",
        verificationMethod: "In person",
        verificationBasis: "Confirmed with student",
      }),
    );
  });
  it("keeps edits when a dirty invitation is closed and lets the user continue editing", async () => {
    renderAccess();
    const dialog = await openInvitation();
    next();
    fireEvent.change(screen.getByLabelText("Login"), {
      target: { value: "draft.login" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    const confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: /Keep editing/ }),
    );
    expect((screen.getByLabelText("Login") as HTMLInputElement).value).toBe(
      "draft.login",
    );
    expect(mocks.invite).not.toHaveBeenCalled();
  });
  it("limits account suspension controls to administrators and confirms the global scope", async () => {
    const view = renderAccess();
    await screen.findByText("Parent One");
    expect(
      screen.queryByRole("button", { name: "Suspend account" }),
    ).toBeNull();
    view.unmount();
    renderAccess({ canSuspendAccounts: true });
    fireEvent.click(
      await screen.findByRole("button", { name: "Suspend account" }),
    );
    expect(mocks.accountStatus).not.toHaveBeenCalled();
    const warning = await screen.findByRole("alertdialog", {
      name: "Suspend this account?",
    });
    expect(
      within(warning).getByText(/all their learning and children/),
    ).toBeTruthy();
    fireEvent.click(
      within(warning).getByRole("button", { name: "Suspend account" }),
    );
    await waitFor(() =>
      expect(mocks.accountStatus).toHaveBeenCalledWith(42, 9, "suspended"),
    );
  });
  it("hides management and skips loading when access management is unavailable", () => {
    const view = renderAccess({ canManageAccess: false });
    expect(view.container.textContent).toBe("");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("shows a recoverable load error instead of an empty access list", async () => {
    mocks.get.mockRejectedValueOnce(new Error("unavailable"));
    renderAccess();
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Parent One")).toBeTruthy();
  });
  it("prevents inviting a representative while student classification is unverified", async () => {
    data.classification = "unverified";
    renderAccess();
    await openInvitation();
    fireEvent.click(
      screen.getByRole("button", { name: "Parent or representative" }),
    );
    next();
    expect(
      await screen.findByText(
        "Confirm student status before inviting a representative",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Login")).toBeNull();
  });
});

describe("contact match warnings inside the invitation modal", () => {
  const matches = { items: [{ id: 9, login: "parent.login", fullName: "Parent One", status: "active", matchedBy: ["phone"], canUse: true }], additionalMatches: false };
  it("keeps matching contacts on the account step until an existing account is explicitly selected", async () => {
    mocks.checkContacts.mockResolvedValue(matches);
    renderAccess(); await openInvitation();
    fireEvent.click(screen.getByRole("button", { name: "Parent or representative" })); next();
    fireEvent.change(screen.getByLabelText("Login"), { target: { value: "new.parent" } });
    fireEvent.change(document.getElementById("portal-invite-fullName")!, { target: { value: "New Parent" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+998 90 123 45 67" } });
    next();
    expect(await screen.findByText("These contacts match existing accounts. Verify the recipient.")).toBeTruthy();
    expect(mocks.checkContacts).toHaveBeenCalledWith(42, { email: null, phone: "+998 90 123 45 67" });
    expect(mocks.invite).not.toHaveBeenCalled(); expect(screen.getByLabelText("Login")).toBeTruthy();
    next(); expect(await screen.findByText("Check contacts before continuing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use account" })); next(); fillVerification(); next();
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() => expect(mocks.invite).toHaveBeenCalledWith(42, expect.objectContaining({ accountId: 9, kind: "representative" })));
    expect(mocks.invite.mock.calls[0][1].account).toBeUndefined();
  });
  it("creates a separate account only after an explicit decision and does not select blocked accounts", async () => {
    mocks.checkContacts.mockResolvedValue({ items: [{ ...matches.items[0], status: "suspended", canUse: false }], additionalMatches: true });
    renderAccess(); await openInvitation(); next();
    fireEvent.change(screen.getByLabelText("Login"), { target: { value: "separate.child" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "998901234567" } }); next();
    await screen.findByText("These contacts match existing accounts. Verify the recipient.");
    expect((screen.getByRole("button", { name: "Use account" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Create a separate account" })); next(); fillVerification(); next();
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() => expect(mocks.invite).toHaveBeenCalledWith(42, expect.objectContaining({ account: expect.objectContaining({ login: "separate.child", phone: "998901234567" }) })));
    expect(mocks.invite.mock.calls[0][1].accountId).toBeUndefined();
  });
  it("discards an old response when contacts change during checking", async () => {
    let resolve!: (value: { items: []; additionalMatches: false }) => void;
    mocks.checkContacts.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue({ items: [], additionalMatches: false });
    renderAccess(); await openInvitation(); next();
    fireEvent.change(screen.getByLabelText("Login"), { target: { value: "student.login" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "998901234567" } }); next();
    await waitFor(() => expect(mocks.checkContacts).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "998901234568" } });
    resolve({ items: [], additionalMatches: false });
    expect(await screen.findByText("Check the updated contacts")).toBeTruthy();
    expect(screen.queryByLabelText("Verification method")).toBeNull(); next();
    expect(await screen.findByLabelText("Verification method")).toBeTruthy();
    expect(mocks.checkContacts).toHaveBeenLastCalledWith(42, { email: null, phone: "998901234568" });
  });
  it("preserves entered contacts when checking fails and allows a deliberate retry", async () => {
    mocks.checkContacts.mockRejectedValueOnce(new Error("private server error")).mockResolvedValue({ items: [], additionalMatches: false });
    renderAccess(); await openInvitation(); next();
    fireEvent.change(screen.getByLabelText("Login"), { target: { value: "student.login" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "fixture@example.invalid" } }); next();
    expect(await screen.findByText("Could not check contacts")).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("fixture@example.invalid");
    expect(screen.queryByText("private server error")).toBeNull(); next();
    expect(await screen.findByLabelText("Verification method")).toBeTruthy();
  });
});
