// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PortalSessionDto, PortalSubjectDto } from "../shared/contracts/portal-identity";
import { PlatformProviders } from "../client/src/app/PlatformProviders";
import { PortalApp } from "../client/src/features/portal-app/PortalApp";
import { PortalShell } from "../client/src/features/portal-app/PortalShell";
import { PortalNotifications } from "../client/src/features/portal-app/notifications";
import { PortalSessionProvider, portalGrantFingerprint, portalSessionKey, usePortal, useSubjectQuery } from "../client/src/features/portal-app/context";
import { usePortalLocation } from "../client/src/features/portal-app/navigation";
import { initializeNavigationGuard } from "../client/src/lib/navigationGuard";
import { i18n } from "../client/src/lib/i18n";

const mocks = vi.hoisted(() => ({ session: vi.fn(), notifications: vi.fn(), load: vi.fn() }));
vi.mock("../client/src/features/portal-app/realtime", () => ({ usePortalRealtime: vi.fn() }));
vi.mock("../client/src/features/portal-app/api", async (importActual) => {
  const actual = await importActual<typeof import("../client/src/features/portal-app/api")>();
  return { ...actual, portalIdentityApi: { ...actual.portalIdentityApi, session: mocks.session, support: async () => null } };
});
vi.mock("../client/src/features/portal-app/resources-api", async (importActual) => {
  const actual = await importActual<typeof import("../client/src/features/portal-app/resources-api")>();
  return { ...actual, portalResourcesApi: { ...actual.portalResourcesApi, notifications: mocks.notifications } };
});
vi.mock("../client/src/features/lms/overview", () => ({
  PortalDay: () => <Probe />,
  FamilyOverview: () => <Probe />,
  PortalLimitedOverview: () => <Probe />,
}));
vi.mock("../client/src/features/lms/courses", () => ({
  PortalCourses: () => <Probe />,
  PortalCourse: () => <Probe />,
  PortalMaterial: () => <Probe />,
}));
vi.mock("../client/src/features/lms/assignments", () => ({ PortalAssignments: () => <Probe /> }));

initializeNavigationGuard();
const own: PortalSubjectDto = {
  linkId: 1, studentId: 10, studentName: "Own learning", kind: "self",
  relationship: null, permissions: ["learning.read", "assignments.submit"],
  status: "active", studentClassification: "adult",
};
const child: PortalSubjectDto = {
  ...own, linkId: 2, studentId: 20, studentName: "First child", kind: "representative",
  relationship: "parent", permissions: ["learning.read", "finance.read"], studentClassification: "minor",
};
const sibling: PortalSubjectDto = { ...child, linkId: 3, studentId: 30, studentName: "Second child" };
const session: PortalSessionDto = {
  account: { id: 50, login: "family", fullName: "Family account", email: null, phone: null, locale: "en", status: "active" },
  subjects: [own, child, sibling], csrfToken: "module-test-csrf",
};
let client: QueryClient;

function Probe() {
  const { learningModule, subject, subjects, allSubjects, selectSubject, guarded, setUnsaved } = usePortal();
  const [, navigate] = usePortalLocation();
  const [draft, setDraft] = useState("");
  useEffect(() => { setUnsaved(Boolean(draft)); return () => setUnsaved(false); }, [draft, setUnsaved]);
  const query = useSubjectQuery("module-probe", mocks.load);
  return <div>
    <output aria-label="module">{learningModule}</output>
    <output aria-label="subject">{subject?.studentName ?? "family"}</output>
    <output aria-label="visible links">{subjects.map((item) => item.linkId).join(",")}</output>
    <output aria-label="all links">{allSubjects.map((item) => item.linkId).join(",")}</output>
    <output aria-label="loaded learning">{query.data as string}</output>
    <label>Draft<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
    <button onClick={() => selectSubject(1)}>Select self</button>
    <button onClick={() => selectSubject(2)}>Select child</button>
    <button onClick={() => selectSubject(null)}>Select family</button>
    <button onClick={() => guarded(() => navigate("/student-module"))}>Student route</button>
    <button onClick={() => guarded(() => navigate("/parent-module"))}>Parent route</button>
    <button onClick={() => guarded(() => navigate("/learn/courses/8?tab=active#lesson"))}>Open course</button>
  </div>;
}

function mountContext(value = session, notices = false) {
  client.setQueryData(portalSessionKey, value);
  return render(<PlatformProviders><QueryClientProvider client={client}>
    <PortalSessionProvider><PortalShell><Probe />{notices && <PortalNotifications embedded />}</PortalShell></PortalSessionProvider>
  </QueryClientProvider></PlatformProviders>);
}
const value = (name: string) => screen.getByLabelText(name).textContent;
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); i18n.setLanguage("en");
  history.replaceState(null, "", "/student-module");
  mocks.session.mockReset().mockResolvedValue(session);
  mocks.load.mockReset().mockImplementation(async (linkId: number) => `Learning for ${linkId}`);
  mocks.notifications.mockReset().mockResolvedValue({ items: [], unreadCount: 2, nextCursor: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it("limits each module to its own link kind even with a stored selection from the other role", async () => {
  sessionStorage.setItem("portal-context-50", "2");
  mountContext();
  expect(value("subject")).toBe("Own learning");
  expect(value("visible links")).toBe("1");
  expect(value("all links")).toBe("1,2,3");
  await waitFor(() => expect(value("loaded learning")).toBe("Learning for 1"));
  await userEvent.click(screen.getByRole("button", { name: "Parent route" }));
  expect(value("module")).toBe("parent");
  expect(value("visible links")).toBe("2,3");
  expect(value("subject")).toBe("First child");
  await waitFor(() => expect(value("loaded learning")).toBe("Learning for 2"));
});

it("rejects programmatic cross-role selection and does not call a subject API for that role", async () => {
  history.replaceState(null, "", "/parent-module");
  mountContext();
  expect(value("subject")).toBe("family");
  await userEvent.click(screen.getByRole("button", { name: "Select self" }));
  expect(value("subject")).toBe("family");
  expect(mocks.load).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Select child" }));
  await waitFor(() => expect(value("loaded learning")).toBe("Learning for 2"));
  expect(mocks.load.mock.calls.every(([id]) => id === 2)).toBe(true);
});

it("keeps a dirty draft until a module switch is explicitly confirmed", async () => {
  mountContext();
  await userEvent.type(screen.getByLabelText("Draft"), "Unsubmitted work");
  await userEvent.click(screen.getByRole("button", { name: "Parent route" }));
  const confirmation = await screen.findByRole("alertdialog");
  await userEvent.click(within(confirmation).getByRole("button", { name: i18n.t("portalCancel") }));
  expect(location.pathname).toBe("/student-module");
  expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Unsubmitted work");
  await userEvent.click(screen.getByRole("button", { name: "Parent route" }));
  await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: i18n.t("portalLeave") }));
  expect(location.pathname).toBe("/parent-module");
  expect(value("subject")).toBe("family");
});

it("retains account-wide notification queries when switching the module of a mixed account", async () => {
  mountContext(session, true);
  await waitFor(() => expect(mocks.notifications).toHaveBeenCalledTimes(2));
  const fingerprint = portalGrantFingerprint(session.subjects);
  expect(client.getQueryData(["portal-account", 50, "notifications-badge", fingerprint])).toBeTruthy();
  expect(client.getQueryData(["portal-account", 50, "notifications", fingerprint])).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Parent route" }));
  await act(async () => { await Promise.resolve(); });
  expect(client.getQueryData(["portal-account", 50, "notifications-badge", fingerprint])).toBeTruthy();
  expect(client.getQueryData(["portal-account", 50, "notifications", fingerprint])).toBeTruthy();
  expect(mocks.notifications).toHaveBeenCalledTimes(2);
});

it("keeps in-module content navigation canonical with its query and fragment", async () => {
  history.replaceState(null, "", "/parent-module");
  mountContext();
  await userEvent.click(screen.getByRole("button", { name: "Open course" }));
  expect(location.pathname + location.search + location.hash).toBe("/parent-module/courses/8?tab=active#lesson");
});

it.each([
  ["/learn/courses/8?linkId=2&tab=active#lesson", "/parent-module/courses/8?linkId=2&tab=active#lesson", "First child"],
  ["/learn/assignments/9?linkId=1#draft", "/student-module/assignments/9?linkId=1#draft", "Own learning"],
  ["/", "/student-module", "Own learning"],
  ["/learn/?linkId=2", "/parent-module?linkId=2", "First child"],
])("replaces legacy/root %s with the proper role module", async (from, expected, expectedSubject) => {
  history.replaceState(null, "", from);
  const length = history.length;
  render(<PlatformProviders><PortalApp /></PlatformProviders>);
  await waitFor(() => expect(location.pathname + location.search + location.hash).toBe(expected));
  await waitFor(() => expect(value("subject")).toBe(expectedSubject));
  expect(history.length).toBe(length);
});

it("does not render a deep-linked learning screen for a link belonging to the other module", async () => {
  history.replaceState(null, "", "/parent-module/courses/8?linkId=1");
  render(<PlatformProviders><PortalApp /></PlatformProviders>);
  await screen.findByText(i18n.t("portalUnavailable"));
  expect(screen.queryByLabelText("loaded learning")).toBeNull();
  expect(mocks.load).not.toHaveBeenCalled();
});

it("opens the platform root in the parent module for a parent-only account", async () => {
  history.replaceState(null, "", "/");
  mocks.session.mockResolvedValue({ ...session, subjects: [child, sibling] });
  render(<PlatformProviders><PortalApp /></PlatformProviders>);
  await waitFor(() => expect(location.pathname).toBe("/parent-module"));
  expect(value("subject")).toBe("family");
  expect(value("visible links")).toBe("2,3");
});
