// @vitest-environment jsdom
import {
  useEffect,
  useState,
  type ComponentProps,
  type ElementRef,
} from "react";
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
import type { PortalSessionDto } from "../shared/contracts/portal-identity";
import { PortalApp } from "../client/src/features/portal-app/PortalApp";
import { usePortal } from "../client/src/features/portal-app/context";
import { ThemeProvider } from "../client/src/components/ux/ThemeProvider";
import { i18n } from "../client/src/lib/i18n";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  profile: vi.fn(),
  sessions: vi.fn(),
  password: vi.fn(),
  reauthenticate: vi.fn(),
  childCredentials: vi.fn(),
  representatives: vi.fn(),
  consent: vi.fn(),
  notifications: vi.fn(),
  backgroundMount: vi.fn(),
  closeAutoFocus: null as ((event: Event) => void) | null,
}));
vi.mock(
  "../client/src/features/portal-app/modal-content",
  async (importActual) => {
    const actual =
      await importActual<
        typeof import("../client/src/features/portal-app/modal-content")
      >();
    const { forwardRef } = await import("react");
    return {
      ...actual,
      PortalDialogContent: forwardRef<
        ElementRef<typeof actual.PortalDialogContent>,
        ComponentProps<typeof actual.PortalDialogContent>
      >(function CaptureFocus(props, ref) {
        if (props.onCloseAutoFocus)
          mocks.closeAutoFocus = props.onCloseAutoFocus;
        return <actual.PortalDialogContent {...props} ref={ref} />;
      }),
    };
  },
);
vi.mock("../client/src/features/portal-app/realtime", () => ({
  usePortalRealtime: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/api", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../client/src/features/portal-app/api")
    >();
  return {
    ...actual,
    portalIdentityApi: {
      ...actual.portalIdentityApi,
      session: mocks.session,
      profile: mocks.profile,
      sessions: mocks.sessions,
      password: mocks.password,
      reauthenticate: mocks.reauthenticate,
      childCredentials: mocks.childCredentials,
      representatives: mocks.representatives,
      consent: mocks.consent,
      support: vi
        .fn()
        .mockResolvedValue({ schoolName: "Academy", phone: null, email: null }),
    },
  };
});
vi.mock(
  "../client/src/features/portal-app/resources-api",
  async (importActual) => {
    const actual =
      await importActual<
        typeof import("../client/src/features/portal-app/resources-api")
      >();
    return {
      ...actual,
      portalResourcesApi: {
        ...actual.portalResourcesApi,
        notifications: mocks.notifications,
      },
    };
  },
);
vi.mock("../client/src/features/lms/courses", async (importActual) => {
  const actual =
    await importActual<typeof import("../client/src/features/lms/courses")>();
  return {
    ...actual,
    PortalCourses: () => <Background name="Courses workspace" />,
  };
});
vi.mock("../client/src/features/lms/overview", async (importActual) => {
  const actual =
    await importActual<typeof import("../client/src/features/lms/overview")>();
  return {
    ...actual,
    PortalDay: () => <Background name="Home workspace" />,
    FamilyOverview: () => <Background name="Family workspace" />,
  };
});

function Background({ name }: { name: string }) {
  const [value, setValue] = useState("");
  const { setUnsaved, refresh, session: currentSession } = usePortal();
  useEffect(() => {
    mocks.backgroundMount(name);
  }, [name]);
  useEffect(() => {
    setUnsaved(Boolean(value));
  }, [value, setUnsaved]);
  return (
    <>
      <label>
        {name}
        <input
          aria-label={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button onClick={refresh}>Refresh session</button>
      <span data-testid="csrf">{currentSession?.csrfToken}</span>
    </>
  );
}

const session: PortalSessionDto = {
  account: {
    id: 50,
    login: "learner",
    fullName: "Learner",
    email: null,
    phone: null,
    locale: "en",
    status: "active",
  },
  csrfToken: "profile-modal-test",
  subjects: [
    {
      linkId: 10,
      studentId: 20,
      studentName: "Learner",
      kind: "self",
      relationship: null,
      permissions: ["learning.read", "attendance.read"],
      status: "active",
      studentClassification: "minor",
    },
  ],
};
const mount = () =>
  render(
    <ThemeProvider defaultTheme="light">
      <PortalApp />
    </ThemeProvider>,
  );
const main = () => screen.getByRole("main", { hidden: true });
const headerProfile = () =>
  within(document.querySelector("header")!).getByRole("button", {
    name: i18n.t("portalProfile"),
    hidden: true,
  });
const profile = () =>
  screen.getByRole("dialog", { name: i18n.t("portalProfile") });
const confirmation = () => screen.getByRole("alertdialog");
const clickConfirmation = (key: "portalCancel" | "portalLeave") =>
  fireEvent.click(
    within(confirmation()).getByRole("button", { name: i18n.t(key) }),
  );
const closeProfile = () =>
  fireEvent.click(
    within(profile()).getByRole("button", { name: i18n.t("close") }),
  );
let resizeDesktop: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.closeAutoFocus = null;
  localStorage.clear();
  sessionStorage.clear();
  i18n.setLanguage("en");
  history.replaceState(null, "", "/learn/courses?tab=active");
  mocks.session.mockResolvedValue(session);
  mocks.sessions.mockResolvedValue([]);
  mocks.reauthenticate.mockResolvedValue({ success: true });
  mocks.childCredentials.mockResolvedValue({ success: true });
  mocks.representatives.mockResolvedValue([]);
  mocks.consent.mockResolvedValue({ success: true });
  mocks.password.mockResolvedValue(session);
  mocks.notifications.mockResolvedValue({
    items: [],
    unreadCount: 0,
    nextCursor: null,
  });
  mocks.profile.mockImplementation(async (values) => ({
    ...session.account!,
    ...values,
  }));
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const desktop = {
    matches: false,
    media: "(min-width: 1024px)",
    onchange: null,
    addEventListener: (
      _: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.add(listener),
    removeEventListener: (
      _: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  resizeDesktop = () => {
    desktop.matches = true;
    listeners.forEach((listener) =>
      listener({ matches: true } as MediaQueryListEvent),
    );
  };
  vi.stubGlobal("matchMedia", (query: string) =>
    query === desktop.media
      ? desktop
      : {
          ...desktop,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
  );
  if (!HTMLElement.prototype.scrollTo)
    HTMLElement.prototype.scrollTo = () => {};
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ) {
    this.scrollTop =
      typeof options === "number" ? options : (options?.top ?? 0);
    this.dispatchEvent(new Event("scroll"));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the header profile over the mounted workspace and preserves draft, scroll, URL and opener focus", async () => {
  mount();
  const workspace = await screen.findByRole("textbox", {
    name: "Courses workspace",
  });
  await userEvent.type(workspace, "Unsubmitted work");
  main().scrollTop = 380;
  fireEvent.scroll(main());
  const opener = headerProfile();
  await userEvent.click(opener);
  expect(window.location.pathname + window.location.search).toBe(
    "/learn/courses?tab=active",
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(
    within(profile()).getByLabelText(i18n.t("portalFullName")),
  ).toBeTruthy();
  expect(within(profile()).queryByRole("heading", { level: 1 })).toBeNull();
  expect(main().scrollTop).toBe(380);
  fireEvent.click(
    within(profile()).getByRole("button", { name: i18n.t("portalCancel") }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("textbox", { name: "Courses workspace" })).toBe(
    workspace,
  );
  expect((workspace as HTMLInputElement).value).toBe("Unsubmitted work");
  expect(mocks.backgroundMount).toHaveBeenCalledOnce();
  expect(main().scrollTop).toBe(380);
  await waitFor(() => expect(document.activeElement).toBe(opener));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("portalToday") }));
  expect(confirmation()).toBeTruthy();
});

it("opens the sidebar profile as a dialog and returns focus to its button", async () => {
  mount();
  await screen.findByRole("textbox", { name: "Courses workspace" });
  const opener = within(document.querySelector("aside")!).getByRole("button", {
    name: i18n.t("portalProfile"),
  });
  await userEvent.click(opener);
  expect(profile()).toBeTruthy();
  expect(window.location.pathname).toBe("/learn/courses");
  closeProfile();
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("hands focus from the mobile menu to the profile dialog and back to the header after closing", async () => {
  mount();
  await screen.findByRole("textbox", { name: "Courses workspace" });
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("openNavigation") }),
  );
  const menu = screen.getByRole("dialog");
  await userEvent.click(
    within(menu).getByRole("button", { name: i18n.t("portalProfile") }),
  );
  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
  await waitFor(() =>
    expect(profile().contains(document.activeElement)).toBe(true),
  );
  closeProfile();
  await waitFor(() => expect(document.activeElement).toBe(headerProfile()));
  expect(window.location.pathname).toBe("/learn/courses");
});

it("opens a legacy profile URL over home and replaces that URL when its dialog closes", async () => {
  history.replaceState(null, "", "/learn/profile");
  const length = history.length;
  mount();
  await screen.findByRole("dialog", { name: i18n.t("portalProfile") });
  const home = screen.getByRole("textbox", {
    name: "Home workspace",
    hidden: true,
  });
  expect(within(main()).queryByLabelText(i18n.t("portalFullName"))).toBeNull();
  expect(window.location.pathname).toBe("/learn/profile");
  closeProfile();
  await waitFor(() => expect(window.location.pathname).toBe("/learn"));
  expect(history.length).toBe(length);
  expect(screen.getByRole("textbox", { name: "Home workspace" })).toBe(home);
  expect(mocks.backgroundMount).toHaveBeenCalledOnce();
});

it("keeps dirty profile edits after cancelling close and only discards them after confirmation", async () => {
  mount();
  await userEvent.type(
    await screen.findByRole("textbox", { name: "Courses workspace" }),
    "Unsent work",
  );
  await userEvent.click(headerProfile());
  const name = within(profile()).getByLabelText(i18n.t("portalFullName"));
  await userEvent.type(name, " edited");
  closeProfile();
  clickConfirmation("portalCancel");
  expect((name as HTMLInputElement).value).toBe("Learner edited");
  await userEvent.click(
    within(profile()).getByRole("button", {
      name: i18n.t("portalChangePassword"),
    }),
  );
  const password = screen.getByRole("dialog", {
    name: i18n.t("portalChangePassword"),
  });
  fireEvent.click(
    within(password).getByRole("button", { name: i18n.t("close") }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  closeProfile();
  clickConfirmation("portalLeave");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(headerProfile());
  expect(
    (
      within(profile()).getByLabelText(
        i18n.t("portalFullName"),
      ) as HTMLInputElement
    ).value,
  ).toBe("Learner");
  closeProfile();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: i18n.t("portalToday") }));
  expect(confirmation()).toBeTruthy();
});

it("saves profile edits inside the dialog without replacing its workspace", async () => {
  mount();
  const workspace = await screen.findByRole("textbox", {
    name: "Courses workspace",
  });
  await userEvent.click(headerProfile());
  const name = within(profile()).getByLabelText(i18n.t("portalFullName"));
  await userEvent.clear(name);
  await userEvent.type(name, "Saved learner");
  await userEvent.click(
    within(profile()).getByRole("button", { name: i18n.t("portalSave") }),
  );
  await screen.findByText(i18n.t("portalSaved"));
  expect(mocks.profile).toHaveBeenCalledWith({
    fullName: "Saved learner",
    locale: "en",
  });
  closeProfile();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Courses workspace" })).toBe(
      workspace,
    ),
  );
});

it("uses the global dirty guard for browser Back and closes the local dialog only after navigation is approved", async () => {
  history.replaceState(null, "", "/learn");
  mount();
  await screen.findByRole("textbox", { name: "Home workspace" });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("portalCourses") }),
  );
  await screen.findByRole("textbox", { name: "Courses workspace" });
  await userEvent.click(headerProfile());
  await userEvent.type(
    within(profile()).getByLabelText(i18n.t("portalFullName")),
    " edited",
  );
  act(() => history.back());
  await screen.findByRole("alertdialog");
  clickConfirmation("portalCancel");
  expect(window.location.pathname).toBe("/learn/courses");
  expect(profile()).toBeTruthy();
  act(() => history.back());
  await screen.findByRole("alertdialog");
  clickConfirmation("portalLeave");
  await screen.findByRole("textbox", { name: "Home workspace" });
  expect(window.location.pathname).toBe("/learn");
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(main()));
  // Radix can deliver this after its exit animation, later than route RAF focus.
  headerProfile().focus();
  const lateClose = new Event("focusScope.autoFocusOnUnmount", {
    cancelable: true,
  });
  await act(async () => {
    await Promise.resolve();
    mocks.closeAutoFocus?.(lateClose);
  });
  expect(lateClose.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(main());
  act(() => history.forward());
  await screen.findByRole("textbox", { name: "Courses workspace" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("preserves the dirty account profile through desktop resize and background grant refresh", async () => {
  mount();
  await screen.findByRole("textbox", { name: "Courses workspace" });
  await userEvent.click(headerProfile());
  const name = within(profile()).getByLabelText(i18n.t("portalFullName"));
  await userEvent.type(name, " edited");
  act(() => resizeDesktop());
  expect(profile()).toBeTruthy();
  expect((name as HTMLInputElement).value).toBe("Learner edited");
  mocks.session.mockResolvedValue({
    ...session,
    subjects: [
      {
        ...session.subjects[0],
        permissions: ["learning.read", "attendance.read", "feedback.read"],
      },
    ],
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh session", hidden: true }),
  );
  await waitFor(() => expect(mocks.session).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      within(document.querySelector("aside")!).getByRole("button", {
        name: i18n.t("portalFeedback"),
        hidden: true,
      }),
    ).toBeTruthy(),
  );
  expect(profile()).toBeTruthy();
  expect(
    (
      within(profile()).getByLabelText(
        i18n.t("portalFullName"),
      ) as HTMLInputElement
    ).value,
  ).toBe("Learner edited");
  closeProfile();
  expect(confirmation()).toBeTruthy();
});

it("remounts profile and nested security forms when the authenticated account changes", async () => {
  mount();
  await screen.findByRole("textbox", { name: "Courses workspace" });
  await userEvent.click(headerProfile());
  await userEvent.type(
    within(profile()).getByLabelText(i18n.t("portalFullName")),
    " old draft",
  );
  await userEvent.click(
    within(profile()).getByRole("button", {
      name: i18n.t("portalChangePassword"),
    }),
  );
  const password = screen.getByRole("dialog", {
    name: i18n.t("portalChangePassword"),
  });
  await userEvent.type(
    within(password).getByLabelText(i18n.t("portalCurrentPassword")),
    "old account password",
  );
  mocks.session.mockResolvedValue({
    ...session,
    account: { ...session.account!, id: 51, fullName: "Another account" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh session", hidden: true }),
  );
  await waitFor(() =>
    expect(
      (
        within(profile()).getByLabelText(
          i18n.t("portalFullName"),
        ) as HTMLInputElement
      ).value,
    ).toBe("Another account"),
  );
  expect(
    screen.queryByRole("dialog", { name: i18n.t("portalChangePassword") }),
  ).toBeNull();
  closeProfile();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.profile).not.toHaveBeenCalled();
});

const childSession = (linkId = 10): PortalSessionDto => ({
  ...session,
  subjects: [
    {
      ...session.subjects[0],
      linkId,
      studentId: linkId + 10,
      studentName: `Child ${linkId}`,
      kind: "representative",
      relationship: "parent",
      permissions: ["learning.read", "child_credentials.manage"],
    },
  ],
});
const childDialog = () =>
  screen.getByRole("dialog", { name: i18n.t("portalChildCredentials") });
async function refreshSession(next: PortalSessionDto) {
  mocks.session.mockResolvedValue(next);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh session", hidden: true }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("csrf").textContent).toBe(next.csrfToken),
  );
}
async function openChildProfile() {
  mocks.session.mockResolvedValue(childSession());
  mount();
  await screen.findByRole("textbox", { name: "Courses workspace" });
  await userEvent.click(headerProfile());
  await userEvent.type(
    within(profile()).getByLabelText(i18n.t("portalFullName")),
    " account draft",
  );
  await userEvent.click(
    within(profile()).getByRole("button", {
      name: i18n.t("portalChildCredentials"),
    }),
  );
}
async function fillChild(login: string) {
  const dialog = childDialog();
  await userEvent.type(
    within(dialog).getByLabelText(i18n.t("portalChildLogin")),
    login,
  );
  await userEvent.type(
    within(dialog).getByLabelText(i18n.t("portalNewPassword")),
    "child-password-123",
  );
  await userEvent.type(
    within(dialog).getByLabelText(i18n.t("portalVerifyPassword")),
    "parent-password",
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalSave") }),
  );
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalSave"),
    }),
  );
}
async function fillPassword() {
  const dialog = screen.getByRole("dialog", {
    name: i18n.t("portalChangePassword"),
  });
  await userEvent.type(
    within(dialog).getByLabelText(i18n.t("portalCurrentPassword")),
    "current-password",
  );
  await userEvent.type(
    within(dialog).getByLabelText(i18n.t("portalNewPassword")),
    "updated-password-123",
  );
  await userEvent.type(
    within(dialog).getByLabelText(i18n.t("portalConfirmPassword")),
    "updated-password-123",
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalSave") }),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(["subject", "permission", "classification", "kind"] as const)(
  "removes a dirty child editor after a same-account %s change and preserves the account draft",
  async (change) => {
    await openChildProfile();
    await userEvent.type(
      within(childDialog()).getByLabelText(i18n.t("portalChildLogin")),
      "child_a_draft",
    );
    const next = childSession(change === "subject" ? 11 : 10);
    next.csrfToken = `changed-${change}`;
    if (change === "permission")
      next.subjects[0].permissions = ["learning.read"];
    if (change === "classification")
      next.subjects[0].studentClassification = "adult";
    if (change === "kind") next.subjects[0].kind = "self";
    await refreshSession(next);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: i18n.t("portalChildCredentials"),
        }),
      ).toBeNull(),
    );
    expect(
      (
        within(profile()).getByLabelText(
          i18n.t("portalFullName"),
        ) as HTMLInputElement
      ).value,
    ).toBe("Learner account draft");
    expect(mocks.childCredentials).not.toHaveBeenCalled();
    if (change === "subject") {
      await userEvent.click(
        within(profile()).getByRole("button", {
          name: i18n.t("portalChildCredentials"),
        }),
      );
      expect(
        (
          within(childDialog()).getByLabelText(
            i18n.t("portalChildLogin"),
          ) as HTMLInputElement
        ).value,
      ).toBe("");
      await fillChild("child_b_login");
      await waitFor(() =>
        expect(mocks.childCredentials).toHaveBeenCalledWith(
          11,
          "child_b_login",
          "child-password-123",
        ),
      );
      expect(mocks.childCredentials).toHaveBeenCalledOnce();
    } else {
      expect(
        within(profile()).queryByRole("button", {
          name: i18n.t("portalChildCredentials"),
        }),
      ).toBeNull();
    }
  },
);

it("does not close the new child's editor when the old child's pending credentials request succeeds", async () => {
  const pending = deferred<{ success: boolean }>();
  mocks.childCredentials.mockReturnValue(pending.promise);
  await openChildProfile();
  await fillChild("child_a_login");
  await waitFor(() =>
    expect(mocks.childCredentials).toHaveBeenCalledWith(
      10,
      "child_a_login",
      "child-password-123",
    ),
  );
  await refreshSession({ ...childSession(11), csrfToken: "pending-child-b" });
  await userEvent.click(
    within(profile()).getByRole("button", {
      name: i18n.t("portalChildCredentials"),
    }),
  );
  const login = within(childDialog()).getByLabelText(
    i18n.t("portalChildLogin"),
  ) as HTMLInputElement;
  await userEvent.type(login, "fresh_child_b_draft");
  await act(async () => pending.resolve({ success: true }));
  expect(childDialog()).toBeTruthy();
  expect(login.value).toBe("fresh_child_b_draft");
  expect(mocks.childCredentials).toHaveBeenCalledOnce();
});

it("cancels the second credentials step when the child context changes during reauthentication", async () => {
  const pending = deferred<{ success: boolean }>();
  mocks.reauthenticate.mockReturnValue(pending.promise);
  await openChildProfile();
  await fillChild("child_a_login");
  await waitFor(() => expect(mocks.reauthenticate).toHaveBeenCalledOnce());
  await refreshSession({ ...childSession(11), csrfToken: "reauth-child-b" });
  await act(async () => pending.resolve({ success: true }));
  expect(mocks.childCredentials).not.toHaveBeenCalled();
  expect(
    (
      within(profile()).getByLabelText(
        i18n.t("portalFullName"),
      ) as HTMLInputElement
    ).value,
  ).toBe("Learner account draft");
});

it("ignores a pending password response from a previous account", async () => {
  const pending = deferred<PortalSessionDto>();
  mocks.password.mockReturnValue(pending.promise);
  mount();
  await screen.findByRole("textbox", { name: "Courses workspace" });
  await userEvent.click(headerProfile());
  await userEvent.click(
    within(profile()).getByRole("button", {
      name: i18n.t("portalChangePassword"),
    }),
  );
  await fillPassword();
  await waitFor(() => expect(mocks.password).toHaveBeenCalledOnce());
  await refreshSession({
    ...session,
    account: { ...session.account!, id: 51, fullName: "Another account" },
    csrfToken: "account-b-token",
  });
  await act(async () =>
    pending.resolve({ ...session, csrfToken: "stale-account-a-token" }),
  );
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
  expect(
    (
      within(profile()).getByLabelText(
        i18n.t("portalFullName"),
      ) as HTMLInputElement
    ).value,
  ).toBe("Another account");
  expect(screen.getByTestId("csrf").textContent).toBe("account-b-token");
});

it("accepts same-account password session rotation without closing a reopened password draft", async () => {
  const pending = deferred<PortalSessionDto>();
  mocks.password.mockReturnValue(pending.promise);
  mount();
  await screen.findByRole("textbox", { name: "Courses workspace" });
  await userEvent.click(headerProfile());
  await userEvent.click(
    within(profile()).getByRole("button", {
      name: i18n.t("portalChangePassword"),
    }),
  );
  await fillPassword();
  const password = screen.getByRole("dialog", {
    name: i18n.t("portalChangePassword"),
  });
  fireEvent.click(
    within(password).getByRole("button", { name: i18n.t("close") }),
  );
  clickConfirmation("portalLeave");
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: i18n.t("portalChangePassword") }),
    ).toBeNull(),
  );
  await userEvent.click(
    within(profile()).getByRole("button", {
      name: i18n.t("portalChangePassword"),
    }),
  );
  const current = within(
    screen.getByRole("dialog", { name: i18n.t("portalChangePassword") }),
  ).getByLabelText(i18n.t("portalCurrentPassword")) as HTMLInputElement;
  await userEvent.type(current, "fresh password draft");
  await act(async () =>
    pending.resolve({ ...session, csrfToken: "rotated-current-account-token" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("csrf").textContent).toBe(
      "rotated-current-account-token",
    ),
  );
  expect(current.value).toBe("fresh password draft");
  expect(
    screen.getByRole("dialog", { name: i18n.t("portalChangePassword") }),
  ).toBeTruthy();
});

it("removes an old consent editor and cancels its pending reauthentication after a self-subject change", async () => {
  const pending = deferred<{ success: boolean }>();
  mocks.reauthenticate.mockReturnValue(pending.promise);
  const adultSession: PortalSessionDto = {
    ...session,
    subjects: [{ ...session.subjects[0], studentClassification: "adult" }],
  };
  mocks.session.mockResolvedValue(adultSession);
  mocks.representatives.mockResolvedValue([
    {
      linkId: 70,
      fullName: "Representative A",
      permissions: ["learning.read"],
      status: "active",
      relationship: "parent",
    },
  ]);
  mount();
  await screen.findByRole("textbox", { name: "Courses workspace" });
  await userEvent.click(headerProfile());
  await userEvent.type(
    within(profile()).getByLabelText(i18n.t("portalFullName")),
    " account draft",
  );
  await userEvent.click(
    await within(profile()).findByRole("button", {
      name: i18n.t("lmsStaffRevoke"),
    }),
  );
  const consent = screen.getByRole("alertdialog");
  await userEvent.type(
    within(consent).getByLabelText(i18n.t("portalVerifyPassword")),
    "old consent password",
  );
  await userEvent.click(
    within(consent).getByRole("button", { name: i18n.t("lmsStaffRevoke") }),
  );
  await waitFor(() => expect(mocks.reauthenticate).toHaveBeenCalledOnce());
  await refreshSession({
    ...adultSession,
    csrfToken: "next-self-token",
    subjects: [{ ...adultSession.subjects[0], linkId: 11, studentId: 21 }],
  });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(
    (
      within(profile()).getByLabelText(
        i18n.t("portalFullName"),
      ) as HTMLInputElement
    ).value,
  ).toBe("Learner account draft");
  await userEvent.click(
    await within(profile()).findByRole("button", {
      name: i18n.t("lmsStaffRevoke"),
    }),
  );
  expect(
    (
      within(screen.getByRole("alertdialog")).getByLabelText(
        i18n.t("portalVerifyPassword"),
      ) as HTMLInputElement
    ).value,
  ).toBe("");
  await act(async () => pending.resolve({ success: true }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(mocks.consent).not.toHaveBeenCalled();
});

it.each(["family", "no-access"])(
  "keeps profile editing modal for a %s account",
  async (kind) => {
    history.replaceState(null, "", "/learn");
    mocks.session.mockResolvedValue({
      ...session,
      subjects:
        kind === "no-access"
          ? []
          : [10, 11].map((linkId) => ({
              ...session.subjects[0],
              linkId,
              kind: "representative",
              relationship: "parent",
            })),
    });
    mount();
    await waitFor(() => expect(headerProfile()).toBeTruthy());
    await userEvent.click(headerProfile());
    expect(
      within(profile()).getByLabelText(i18n.t("portalFullName")),
    ).toBeTruthy();
    expect(
      within(main()).queryByLabelText(i18n.t("portalFullName")),
    ).toBeNull();
  },
);
