// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PortalSessionDto, PortalSubjectDto } from "../shared/contracts/portal-identity";
import { ThemeProvider } from "../client/src/components/ux/ThemeProvider";
import { PortalAuth } from "../client/src/features/portal-identity/PortalAuth";
import {
  PortalSessionProvider,
  portalSessionKey,
} from "../client/src/features/portal-app/context";
import { PortalApiError } from "../client/src/features/portal-app/api";
import { i18n, type TranslationKey } from "../client/src/lib/i18n";

const mocks = vi.hoisted(() => ({ session: vi.fn(), activate: vi.fn() }));
vi.mock("../client/src/features/portal-app/realtime", () => ({
  usePortalRealtime: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/api", async (importActual) => {
  const actual = await importActual<typeof import("../client/src/features/portal-app/api")>();
  return {
    ...actual,
    portalIdentityApi: {
      ...actual.portalIdentityApi,
      session: mocks.session,
      activate: mocks.activate,
    },
  };
});

const anonymous: PortalSessionDto = { account: null, subjects: [], csrfToken: "test-csrf" };
const activated: PortalSessionDto = {
  account: {
    id: 50,
    fullName: "Learner",
    login: "learner",
    email: null,
    phone: null,
    locale: "en",
    status: "active",
  },
  subjects: [],
  csrfToken: "activated-csrf",
};
let client: QueryClient;
const copy = (key: TranslationKey) => i18n.t(key);
const dialog = () => screen.getByRole("dialog", { name: copy("portalActivate") });

function mount(session = anonymous, token = "invitation") {
  mocks.session.mockResolvedValue(session);
  client.setQueryData(portalSessionKey, session);
  return render(
    <ThemeProvider defaultTheme="light">
      <QueryClientProvider client={client}>
        <PortalSessionProvider>
          <PortalAuth token={token} />
        </PortalSessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  const form = within(dialog());
  await user.type(form.getByLabelText(copy("portalFullName")), "Learner");
  await user.type(form.getByLabelText(copy("portalNewPassword")), "strong-password");
  await user.type(form.getByLabelText(copy("portalConfirmPassword")), "strong-password");
}

beforeEach(() => {
  mocks.activate.mockReset();
  i18n.setLanguage("en");
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/activate#token=invitation");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

it("opens invitation creation in a Dialog and leaves no editable form on the landing page", async () => {
  const user = userEvent.setup();
  mount();
  const modal = dialog();
  expect(modal.contains(screen.getByLabelText(copy("portalFullName")))).toBe(true);
  expect([...document.querySelectorAll("form")].every((form) => modal.contains(form))).toBe(true);
  expect(mocks.activate).not.toHaveBeenCalled();
  await user.click(within(modal).getByRole("button", { name: copy("portalCancel") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.querySelector("form")).toBeNull();
  expect(screen.queryByLabelText(copy("portalFullName"))).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: copy("portalActivate") }));
  await user.click(screen.getByRole("button", { name: copy("portalActivate") }));
  expect(dialog()).toBeTruthy();
  expect(within(dialog()).getByLabelText(copy("portalFullName"))).toBe(document.activeElement);
});

it("guards a dirty activation draft and discards it only after confirmation", async () => {
  const user = userEvent.setup();
  mount();
  await user.type(within(dialog()).getByLabelText(copy("portalFullName")), "Draft name");
  await user.click(within(dialog()).getByRole("button", { name: copy("close") }));
  const confirmation = await screen.findByRole("alertdialog", { name: copy("portalUnsavedTitle") });
  await user.click(within(confirmation).getByRole("button", { name: copy("portalCancel") }));
  expect((within(dialog()).getByLabelText(copy("portalFullName")) as HTMLInputElement).value).toBe("Draft name");
  await user.click(within(dialog()).getByRole("button", { name: copy("portalCancel") }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: copy("portalLeave") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(screen.getByRole("button", { name: copy("portalActivate") }));
  expect((within(dialog()).getByLabelText(copy("portalFullName")) as HTMLInputElement).value).toBe("");
  expect(mocks.activate).not.toHaveBeenCalled();
});

it("keeps validation and a failed activation draft inside the Dialog", async () => {
  const user = userEvent.setup();
  mocks.activate.mockRejectedValueOnce(new PortalApiError(0, "portalOffline"));
  mount();
  await fill(user);
  const repeat = within(dialog()).getByLabelText(copy("portalConfirmPassword"));
  await user.clear(repeat);
  await user.type(repeat, "different-password");
  await user.click(within(dialog()).getByRole("button", { name: copy("portalActivate") }));
  expect(within(dialog()).getByRole("alert").textContent).toContain(copy("portalPasswordMismatch"));
  expect(mocks.activate).not.toHaveBeenCalled();
  await user.clear(repeat);
  await user.type(repeat, "strong-password");
  await user.click(within(dialog()).getByRole("button", { name: copy("portalActivate") }));
  expect(await within(dialog()).findByText(copy("portalLmsOffline"))).toBeTruthy();
  expect((within(dialog()).getByLabelText(copy("portalFullName")) as HTMLInputElement).value).toBe("Learner");
  expect((within(dialog()).getByLabelText(copy("portalNewPassword")) as HTMLInputElement).value).toBe("strong-password");
});

it("freezes activation while saving and completes navigation once without another discard prompt", async () => {
  const user = userEvent.setup();
  let finish!: (session: PortalSessionDto) => void;
  mocks.activate.mockReturnValueOnce(new Promise<PortalSessionDto>((resolve) => { finish = resolve; }));
  mount();
  await fill(user);
  await user.click(within(dialog()).getByRole("button", { name: copy("portalActivate") }));
  await waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
  expect(mocks.activate).toHaveBeenCalledWith("invitation", "strong-password", "Learner");
  expect(within(dialog()).getByLabelText(copy("portalFullName")).matches(":disabled")).toBe(true);
  await user.click(within(dialog()).getByRole("button", { name: copy("close") }));
  expect(dialog()).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await act(async () => finish(activated));
  await waitFor(() => expect(window.location.pathname).toBe("/student-module"));
  expect(client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id).toBe(50);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("activates an invitation for the signed-in account inside the same Dialog without credential inputs", async () => {
  const user = userEvent.setup();
  mocks.activate.mockResolvedValueOnce(activated);
  mount(activated);
  expect(within(dialog()).getByText("Learner")).toBeTruthy();
  expect(screen.queryByLabelText(copy("portalNewPassword"))).toBeNull();
  await user.click(within(dialog()).getByRole("button", { name: copy("portalActivate") }));
  await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith("invitation", undefined, undefined));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

const own: PortalSubjectDto = {
  linkId: 1, studentId: 10, studentName: "Own study", kind: "self", relationship: null,
  permissions: ["learning.read"], status: "active", studentClassification: "adult",
};
const firstChild: PortalSubjectDto = {
  ...own, linkId: 2, studentId: 20, studentName: "First child", kind: "representative",
  relationship: "parent", studentClassification: "minor",
};
const newChild: PortalSubjectDto = { ...firstChild, linkId: 3, studentId: 30, studentName: "New child" };

it.each([
  [[own], newChild, "/parent-module?linkId=3"],
  [[firstChild], newChild, "/parent-module?linkId=3"],
  [[firstChild, newChild], own, "/student-module?linkId=1"],
] as const)("opens the module and exact relationship accepted by the server", async (existing, target, expected) => {
  const user = userEvent.setup();
  const before: PortalSessionDto = { ...activated, subjects: [...existing] };
  mocks.activate.mockResolvedValueOnce({
    ...before,
    subjects: [...existing, target],
    activatedLink: { linkId: target.linkId, kind: target.kind },
  });
  // Old issued links have no role hint; URL hints must never override the accepted relationship.
  history.replaceState(null, "", "/activate?linkId=999&module=student#token=invitation");
  mount(before);
  await user.click(within(dialog()).getByRole("button", { name: copy("portalActivate") }));
  await waitFor(() => expect(location.pathname + location.search).toBe(expected));
  expect(client.getQueryData<PortalSessionDto>(portalSessionKey)?.subjects).toEqual([...existing, target]);
});

it("keeps a consent-restricted activation in its assigned module instead of switching to another available role", async () => {
  const user = userEvent.setup();
  const before: PortalSessionDto = { ...activated, subjects: [own] };
  mocks.activate.mockResolvedValueOnce({
    ...before,
    activatedLink: { linkId: newChild.linkId, kind: newChild.kind },
  });
  mount(before);
  await user.click(within(dialog()).getByRole("button", { name: copy("portalActivate") }));
  await waitFor(() => expect(location.pathname + location.search).toBe("/parent-module?linkId=3"));
  expect(client.getQueryData<PortalSessionDto>(portalSessionKey)?.subjects).toEqual([own]);
});

it("does not replace a newer account or invitation with a late response from an abandoned activation", async () => {
  const user = userEvent.setup();
  let finish!: (session: PortalSessionDto) => void;
  mocks.activate.mockReturnValueOnce(new Promise<PortalSessionDto>((resolve) => { finish = resolve; }));
  const first = mount();
  await fill(user);
  await user.click(within(dialog()).getByRole("button", { name: copy("portalActivate") }));
  await waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
  first.unmount();
  const newer: PortalSessionDto = {
    ...activated,
    account: { ...activated.account!, id: 99, fullName: "Another learner" },
  };
  history.replaceState(null, "", "/activate#token=new-invitation");
  mount(newer, "new-invitation");
  await act(async () => finish(activated));
  expect(client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id).toBe(99);
  expect(within(dialog()).getByText("Another learner")).toBeTruthy();
  expect(window.location.hash).toBe("#token=new-invitation");
});

it("resets the activation form when the account changes on the same invitation and ignores its old pending response", async () => {
  const user = userEvent.setup();
  let finish!: (session: PortalSessionDto) => void;
  mocks.activate.mockReturnValueOnce(new Promise<PortalSessionDto>((resolve) => { finish = resolve; }));
  mount();
  await fill(user);
  await user.click(within(dialog()).getByRole("button", { name: copy("portalActivate") }));
  await waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
  const newer: PortalSessionDto = {
    ...activated,
    account: { ...activated.account!, id: 99, fullName: "Another learner" },
  };
  await act(async () => client.setQueryData(portalSessionKey, newer));
  expect(await within(dialog()).findByText("Another learner")).toBeTruthy();
  expect(screen.queryByLabelText(copy("portalNewPassword"))).toBeNull();
  await act(async () => finish(activated));
  expect(client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id).toBe(99);
  expect(within(dialog()).getByText("Another learner")).toBeTruthy();
  expect(window.location.pathname).toBe("/activate");
  await user.click(within(dialog()).getByRole("button", { name: copy("portalCancel") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
