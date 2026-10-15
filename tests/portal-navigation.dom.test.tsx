// @vitest-environment jsdom
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { useLocation } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PortalSessionDto } from "../shared/contracts/portal-identity";
import { PortalShell } from "../client/src/features/portal-app/PortalShell";
import {
  PortalSessionProvider,
  portalSessionKey,
  usePortal,
} from "../client/src/features/portal-app/context";
import { ThemeProvider } from "../client/src/components/ux/ThemeProvider";
import { i18n } from "../client/src/lib/i18n";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  notifications: vi.fn(),
  logout: vi.fn(),
}));
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
      logout: mocks.logout,
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
  csrfToken: "navigation-test",
  subjects: [10, 11].map((linkId): PortalSessionDto["subjects"][number] => ({
    linkId,
    studentId: linkId + 10,
    studentName: `Learner ${linkId}`,
    kind: "self",
    relationship: null,
    permissions: ["learning.read", "attendance.read"],
    status: "active",
    studentClassification: "adult",
  })),
};

function Probe({ loaded = true }: { loaded?: boolean }) {
  const [path, navigate] = useLocation();
  const { subject, selectSubject, guarded } = usePortal();
  return (
    <PortalShell>
      <p data-testid="route">{path}</p>
      <p data-testid="subject">{subject?.linkId}</p>
      <button onClick={() => navigate("/learn/courses")}>Go courses</button>
      <button onClick={() => navigate("/learn")}>Go home</button>
      <button onClick={() => selectSubject(subject?.linkId === 10 ? 11 : 10)}>
        Switch learner
      </button>
      <button
        onClick={() =>
          guarded(() => {
            selectSubject(subject?.linkId === 10 ? 11 : 10);
            navigate("/learn/courses");
          })
        }
      >
        Switch learner and open courses
      </button>
      <DraftProbe key={`${path}:${subject?.linkId}`} />
      {loaded ? <section>Loaded lessons</section> : <p>Loading lessons</p>}
    </PortalShell>
  );
}
function DraftProbe() {
  const { setUnsaved } = usePortal();
  return <button onClick={() => setUnsaved(true)}>Edit answer</button>;
}

let client: QueryClient;
let resizeDesktop: (matches: boolean) => void;
function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="light">
      <QueryClientProvider client={client}>
        <PortalSessionProvider>{children}</PortalSessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
function mount(loaded = true) {
  return render(
    <Providers>
      <Probe loaded={loaded} />
    </Providers>,
  );
}
const main = () => screen.getByRole("main", { hidden: true });
const scroll = (top: number) => {
  main().scrollTop = top;
  fireEvent.scroll(main());
};
const currentRoute = (path: string) =>
  waitFor(() => expect(screen.getByTestId("route").textContent).toBe(path));
const focusMain = () =>
  waitFor(() => expect(document.activeElement).toBe(main()));
async function back(path: string) {
  act(() => history.back());
  await currentRoute(path);
}

beforeEach(() => {
  i18n.setLanguage("en");
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/learn");
  mocks.session.mockResolvedValue(session);
  mocks.logout.mockReset();
  mocks.logout.mockResolvedValue({ success: true });
  mocks.notifications.mockResolvedValue({
    items: [],
    nextCursor: null,
    unreadCount: 0,
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(portalSessionKey, session);
  if (!HTMLElement.prototype.scrollTo)
    HTMLElement.prototype.scrollTo = () => {};
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ) {
    const top = typeof options === "number" ? options : (options?.top ?? 0);
    this.scrollTop = Math.min(top, Number(this.dataset.scrollLimit ?? 2000));
    this.scrollLeft = 0;
    this.dispatchEvent(new Event("scroll"));
  });
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const desktop = {
    matches: false,
    media: "(min-width: 1024px)",
    onchange: null,
    addEventListener: (
      _: string,
      callback: (event: MediaQueryListEvent) => void,
    ) => listeners.add(callback),
    removeEventListener: (
      _: string,
      callback: (event: MediaQueryListEvent) => void,
    ) => listeners.delete(callback),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;
  resizeDesktop = (matches) => {
    Object.assign(desktop, { matches });
    listeners.forEach((listener) =>
      listener({ matches } as MediaQueryListEvent),
    );
  };
  vi.stubGlobal("matchMedia", (query: string) =>
    query === desktop.media
      ? desktop
      : {
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        },
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("portal viewport navigation", () => {
  it("approves a combined subject change and route navigation with one confirmation", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit answer" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Switch learner and open courses" }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: i18n.t("portalLeave"),
      }),
    );
    await currentRoute("/learn/courses");
    await waitFor(() =>
      expect(screen.getByTestId("subject").textContent).toBe("11"),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("preserves dirty registrations during an approved logout that fails", async () => {
    let rejectLogout!: (error: Error) => void;
    mocks.logout.mockReturnValue(
      new Promise((_, reject) => {
        rejectLogout = reject;
      }),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit answer" }));
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("portalSignOut") }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: i18n.t("portalLeave"),
      }),
    );
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => {
      rejectLogout(new Error("Logout failed"));
    });
    await screen.findByText(i18n.t("portalLmsLoadError"));
    fireEvent.click(screen.getByRole("button", { name: "Go courses" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByTestId("route").textContent).toBe("/learn");
  });

  it("finishes an approved asynchronous logout without a second navigation confirmation", async () => {
    let finishLogout!: (value: { success: boolean }) => void;
    mocks.logout.mockReturnValue(
      new Promise((resolveLogout) => {
        finishLogout = resolveLogout;
      }),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit answer" }));
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("portalSignOut") }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: i18n.t("portalLeave"),
      }),
    );
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    mocks.session.mockResolvedValue({
      account: null,
      subjects: [],
      csrfToken: "logged-out",
    });
    await act(async () => {
      finishLogout({ success: true });
    });
    await currentRoute("/login");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows only personal learning entries for a self-only subject menu", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Learner 10" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByText(i18n.t("portalMyLearning"))).toBeTruthy();
    expect(menu.queryByText(i18n.t("portalChildren"))).toBeNull();
    expect(menu.queryByRole("separator")).toBeNull();
    expect(menu.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("shows only children and preserves the family overview in a children-only subject menu", async () => {
    const children: PortalSessionDto = {
      ...session,
      subjects: session.subjects.map((subject) => ({
        ...subject,
        kind: "representative",
        relationship: "parent",
      })),
    };
    mocks.session.mockResolvedValue(children);
    client.setQueryData(portalSessionKey, children);
    mount();
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("portalFamily") }),
    );
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByText(i18n.t("portalChildren"))).toBeTruthy();
    expect(menu.queryByText(i18n.t("portalMyLearning"))).toBeNull();
    expect(menu.queryByRole("separator")).toBeNull();
    expect(
      menu.getByRole("menuitem", { name: i18n.t("portalFamilyOverview") }),
    ).toBeTruthy();
    expect(menu.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("starts push routes at the top, restores Back/Forward and focuses the main scroller", async () => {
    mount();
    scroll(420);
    fireEvent.click(screen.getByRole("button", { name: "Go courses" }));
    await currentRoute("/learn/courses");
    await focusMain();
    expect(main().scrollTop).toBe(0);
    scroll(180);
    await back("/learn");
    await focusMain();
    await waitFor(() => expect(main().scrollTop).toBe(420));
    act(() => history.forward());
    await currentRoute("/learn/courses");
    await waitFor(() => expect(main().scrollTop).toBe(180));
  });

  it("restores a cached list after its asynchronous loading content grows", async () => {
    const view = mount();
    scroll(640);
    fireEvent.click(screen.getByRole("button", { name: "Go courses" }));
    await currentRoute("/learn/courses");
    main().dataset.scrollLimit = "0";
    view.rerender(
      <Providers>
        <Probe loaded={false} />
      </Providers>,
    );
    await back("/learn");
    expect(main().scrollTop).toBe(0);
    main().dataset.scrollLimit = "2000";
    view.rerender(
      <Providers>
        <Probe loaded />
      </Providers>,
    );
    await waitFor(() => expect(main().scrollTop).toBe(640));
  });

  it("keeps saved positions separate between learners and focuses their new context", async () => {
    mount();
    scroll(510);
    fireEvent.click(screen.getByRole("button", { name: "Switch learner" }));
    await waitFor(() =>
      expect(screen.getByTestId("subject").textContent).toBe("11"),
    );
    await focusMain();
    expect(main().scrollTop).toBe(0);
    scroll(120);
    fireEvent.click(screen.getByRole("button", { name: "Go courses" }));
    await currentRoute("/learn/courses");
    await back("/learn");
    await waitFor(() => expect(main().scrollTop).toBe(120));
    fireEvent.click(screen.getByRole("button", { name: "Switch learner" }));
    await waitFor(() =>
      expect(screen.getByTestId("subject").textContent).toBe("10"),
    );
    await focusMain();
    expect(main().scrollTop).toBe(0);
  });

  it("closes the modal menu on external route changes and hands focus to main", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("openNavigation") }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => history.pushState(null, "", "/learn/courses"));
    await currentRoute("/learn/courses");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await focusMain();
  });

  it("keeps route and scroll on a cancelled dirty navigation, then closes the menu after approval", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit answer" }));
    scroll(300);
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("openNavigation") }),
    );
    const menu = screen.getByRole("dialog");
    const courses = within(menu).getByRole("button", {
      name: i18n.t("portalCourses"),
    });
    act(() => courses.focus());
    fireEvent.click(courses);
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: i18n.t("portalCancel"),
      }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByTestId("route").textContent).toBe("/learn");
    expect(main().scrollTop).toBe(300);
    expect(screen.getByRole("dialog")).toBe(menu);
    await waitFor(() => expect(document.activeElement).toBe(courses));
    fireEvent.click(courses);
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: i18n.t("portalLeave"),
      }),
    );
    await currentRoute("/learn/courses");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await focusMain();
    expect(main().scrollTop).toBe(0);
  });

  it("closes the modal drawer when resizing to the docked desktop navigation", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("openNavigation") }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => resizeDesktop(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await focusMain();
    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("releases the document viewport lock on unmount", () => {
    const view = mount();
    expect(
      document.documentElement.classList.contains("app-shell-active"),
    ).toBe(true);
    expect(history.scrollRestoration).toBe("manual");
    view.unmount();
    expect(
      document.documentElement.classList.contains("app-shell-active"),
    ).toBe(false);
  });

  it("unlocks the viewport and report dialog only in print report rules", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "client/src/features/portal-app/portal.css"),
      "utf8",
    );
    const print = styles.slice(styles.indexOf("@media print"));
    expect(print).toContain("html.app-shell-active:has(.portal-print-report)");
    expect(print).toMatch(
      /body\[data-scroll-locked\]:has\(\.portal-print-report\)\s*\{\s*overflow:\s*visible\s*!important;/,
    );
    expect(print).toContain(
      "body:has(.portal-print-report) .portal-shell-scroll",
    );
    expect(print).toMatch(
      /height:\s*auto;[\s\S]*max-height:\s*none;[\s\S]*overflow:\s*visible;/,
    );
    expect(print).toMatch(
      /body:has\(\.portal-print-report\) \[role="dialog"\][\s\S]*position:\s*static;[\s\S]*transform:\s*none;/,
    );
  });
});
