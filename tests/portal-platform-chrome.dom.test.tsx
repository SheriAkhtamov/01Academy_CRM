// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLocation } from "wouter";
import type { PortalSessionDto, PortalSubjectDto } from "@shared/contracts/portal-identity";
import type { LmsCourseDto, LmsThreadDto } from "@shared/contracts/lms";
import { PortalApiError } from "../client/src/features/portal-app/api";
import { PortalShell } from "../client/src/features/portal-app/PortalShell";
import { PortalCommandPalette } from "../client/src/features/portal-app/PortalCommandPalette";
import { PortalMessagesSheet } from "../client/src/features/portal-app/PortalMessagesSheet";
import { PortalSessionProvider, portalSessionKey, portalSubjectKey, usePortal } from "../client/src/features/portal-app/context";
import { ThemeProvider } from "../client/src/components/ux/ThemeProvider";
import { i18n } from "../client/src/lib/i18n";

vi.mock("../client/src/features/portal-app/realtime", () => ({ usePortalRealtime: vi.fn() }));

const learner: PortalSubjectDto = {
  linkId: 10, studentId: 20, studentName: "Learner One", kind: "self",
  relationship: null, studentClassification: "adult", status: "active",
  permissions: ["learning.read", "attendance.read", "communication.create"],
};
const child: PortalSubjectDto = {
  ...learner, linkId: 21, studentId: 31, studentName: "Child Two",
  kind: "representative", relationship: "parent",
};
const session: PortalSessionDto = {
  account: { id: 50, login: "learner", fullName: "Learner", email: null, phone: null, locale: "en", status: "active" },
  subjects: [learner], csrfToken: "chrome-test",
};
const course: LmsCourseDto = {
  id: 7, runId: 7, enrollmentId: 1, groupId: 2, groupName: "Design Group",
  courseName: "Visual Design", teacherName: "Teacher", status: "active",
  enrolledAt: "2026-10-01T10:00:00Z", endedAt: null, accessUntil: null,
  progress: { completed: 1, total: 10, percent: 10 },
};
const thread: LmsThreadDto = {
  id: 4, runId: 7, title: "Project question", audience: "student_teacher",
  status: "open", authorAccountId: 50, createdAt: "2026-10-01T10:00:00Z", comments: [],
};
let client: QueryClient;
let activeSession: PortalSessionDto;
let requests: { path: string; method: string; body: string | undefined }[];
let coursesDenied: number;
const page = (items: unknown[]) => ({ items, nextCursor: null, hasMore: false });

function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider defaultTheme="light"><QueryClientProvider client={client}>
    <PortalSessionProvider>{children}</PortalSessionProvider>
  </QueryClientProvider></ThemeProvider>;
}
function PathProbe() {
  const [path] = useLocation();
  return <p data-testid="path">{path}</p>;
}
function ShellProbe() {
  return <PortalShell><PathProbe /></PortalShell>;
}
function MessagesProbe() {
  const [open, setOpen] = useState(true);
  return <><PortalMessagesSheet open={open} onOpenChange={setOpen} /><p data-testid="messages-open">{String(open)}</p></>;
}
function SearchProbe({ dirty = false }: { dirty?: boolean }) {
  const [open, setOpen] = useState(true);
  const { setUnsaved } = usePortal();
  return <><PortalCommandPalette open={open} onOpenChange={setOpen} />
    <button onClick={() => setUnsaved(dirty)}>Mark draft</button>
    <PathProbe /><p data-testid="search-open">{String(open)}</p></>;
}
function mount(children: ReactNode, value = session, path = "/student-module") {
  activeSession = value;
  history.replaceState(null, "", path);
  client.setQueryData(portalSessionKey, value);
  return render(<Providers>{children}</Providers>);
}
const noStaffRequests = () => expect(requests.filter((request) => !request.path.startsWith("/api/portal/"))).toEqual([]);

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); i18n.setLanguage("en");
  document.cookie = "connect.sid=surviving-staff-session";
  activeSession = session; requests = []; coursesDenied = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    requests.push({ path, method: init?.method ?? "GET", body: init?.body as string | undefined });
    let body: unknown;
    let status = 200;
    if (path === "/api/portal/auth/session") body = activeSession;
    else if (path === "/api/portal/notifications") body = { ...page([]), unreadCount: 0 };
    else if (path === "/api/portal/auth/logout") {
      body = { success: true };
      activeSession = { ...activeSession, account: null, subjects: [] };
    }
    else if (path === "/api/portal/me/sessions") body = [];
    else if (path === "/api/portal/notifications/preferences") body = init?.method === "PUT"
      ? JSON.parse(String(init.body))
      : { categories: Object.fromEntries(["learning", "schedule", "feedback", "finance", "family", "security"].map((category) => [category, { inApp: true }])), weeklySummary: false };
    else if (/\/subjects\/\d+\/courses$/.test(path)) {
      body = coursesDenied ? { code: "portalUnavailable" } : page([course]); status = coursesDenied || 200;
    } else if (/\/subjects\/\d+\/threads\/4\/comments$/.test(path)) body = { id: 8 };
    else if (/\/subjects\/\d+\/threads\/4$/.test(path)) body = thread;
    else if (/\/subjects\/\d+\/threads$/.test(path)) body = page([thread]);
    else if (/\/subjects\/\d+\/communication-courses$/.test(path)) body = page([{ runId: 7, courseName: course.courseName, groupName: course.groupName }]);
    else { status = 404; body = { code: "portalNotFound" }; }
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.cookie = "connect.sid=; max-age=0";
});

it.each([
  ["student", [learner], "/student-module"],
  ["parent", [child], "/parent-module"],
  ["mixed", [learner, child], "/parent-module"],
  ["no access", [], "/student-module"],
] as const)("provides working CRM header controls and language navigation for %s without staff requests", async (_role, subjects, path) => {
  const user = userEvent.setup();
  mount(<ShellProbe />, { ...session, subjects: [...subjects] }, path);
  const header = document.querySelector("header")!;
  expect(document.querySelectorAll("header")).toHaveLength(1);
  expect(within(header).getAllByRole("button", { name: "Search" }).length).toBeGreaterThan(0);
  expect(within(header).getByRole("button", { name: "Messages" })).toBeTruthy();
  expect(within(header).getByRole("button", { name: "Current Account" })).toBeTruthy();
  for (const subject of subjects) expect(header.textContent).not.toContain(subject.studentName);
  await user.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(screen.getByRole("button", { name: "Switch language" })).toBeTruthy();
  expect(document.querySelector('a[href="/tasks"]')).toBeNull();
  expect(document.querySelector('a[href^="/admin"]')).toBeNull();
  expect(document.querySelector('a[href$="/profile"]')).toBeNull();
  expect(document.querySelector('a[href$="/notifications"]')).toBeNull();
  noStaffRequests();
});

it("wires the shared header to learner search, theme, notifications, messages, profile and logout", async () => {
  const user = userEvent.setup();
  mount(<ShellProbe />);
  await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
  expect(screen.getByRole("dialog", { name: "Search" })).toBeTruthy();
  await user.keyboard("{Escape}");
  fireEvent.keyDown(document, { key: "k", code: "KeyK", ctrlKey: true });
  expect(screen.getByRole("dialog", { name: "Search" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Toggle theme" }));
  await user.click(screen.getByRole("menuitem", { name: /Dark/ }));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await user.click(screen.getByRole("button", { name: "Notifications" }));
  expect(screen.getByRole("menu", { name: "Notifications" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Messages" }));
  expect(screen.getByRole("dialog", { name: "Messages" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Current Account" }));
  await user.click(screen.getByRole("menuitem", { name: "Profile" }));
  const profile = screen.getByRole("dialog", { name: "Profile" });
  expect(within(profile).getByRole("button", { name: "Save" })).toBeTruthy();
  await user.click(within(profile).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Current Account" }));
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/login"));
  expect(requests.some((request) => request.path === "/api/portal/auth/logout" && request.method === "POST")).toBe(true);
  noStaffRequests();
});

it("opens notification preferences inside the profile and protects their draft without discarding the profile", async () => {
  const user = userEvent.setup();
  mount(<ShellProbe />);
  await user.click(screen.getByRole("button", { name: "Current Account" }));
  await user.click(screen.getByRole("menuitem", { name: "Profile" }));
  const profile = screen.getByRole("dialog", { name: "Profile" });
  const name = within(profile).getByLabelText("Full name") as HTMLInputElement;
  await user.clear(name);
  await user.type(name, "Unsaved profile name");
  await user.click(within(profile).getByRole("button", { name: "Notification preferences" }));
  const preferences = screen.getByRole("dialog", { name: "Notification preferences" });
  const weekly = await within(preferences).findByRole("switch", { name: "Weekly summary" });
  await user.click(weekly);
  await user.keyboard("{Escape}");
  const confirmation = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
  await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(weekly.getAttribute("aria-checked")).toBe("true");
  expect(name.value).toBe("Unsaved profile name");
  await user.click(within(preferences).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(requests.some((entry) => entry.path === "/api/portal/notifications/preferences" && entry.method === "PUT")).toBe(true));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notification preferences" })).toBeNull());
  expect(name.value).toBe("Unsaved profile name");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  noStaffRequests();
});

it("uses the CRM language control in the parent's shared sidebar", async () => {
  const user = userEvent.setup();
  mount(<ShellProbe />, { ...session, subjects: [child] }, "/parent-module");
  await user.click(screen.getByRole("button", { name: "Open navigation" }));
  await user.click(screen.getByRole("button", { name: "Switch language" }));
  await user.click(screen.getByRole("menuitem", { name: /Russian/ }));
  expect(screen.getByRole("button", { name: "Сменить язык" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Модуль родителя", level: 1, hidden: true })).toBeTruthy();
  noStaffRequests();
});

it("searches only assigned role sections and own courses and opens a concrete learner link", async () => {
  const user = userEvent.setup();
  mount(<SearchProbe />);
  expect(screen.queryByRole("option", { name: "Administration" })).toBeNull();
  await user.type(screen.getByRole("combobox"), "Visual");
  await user.click(await screen.findByRole("option", { name: /Visual Design/ }));
  await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/student-module/courses/7"));
  expect(new URLSearchParams(location.search).get("linkId")).toBe("10");
  expect(requests.some((request) => request.path === "/api/portal/subjects/10/courses")).toBe(true);
  noStaffRequests();
});

it("keeps parent search away from student courses and staff search even with a staff cookie", async () => {
  const user = userEvent.setup();
  mount(<SearchProbe />, { ...session, subjects: [child] }, "/parent-module");
  expect(screen.queryByRole("option", { name: "Courses" })).toBeNull();
  expect(screen.queryByRole("option", { name: "Assignments" })).toBeNull();
  await user.type(screen.getByRole("combobox"), "Visual");
  await screen.findByText("No search results");
  expect(requests.some((request) => request.path.endsWith("/courses"))).toBe(false);
  noStaffRequests();
});

it("guards search navigation before closing the palette or discarding another form", async () => {
  const user = userEvent.setup();
  mount(<SearchProbe dirty />);
  fireEvent.click(screen.getByText("Mark draft"));
  await user.click(screen.getByRole("option", { name: "Schedule" }));
  const confirmation = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
  expect(screen.getByTestId("path").textContent).toBe("/student-module");
  expect(screen.getByTestId("search-open").textContent).toBe("true");
  await user.click(within(confirmation).getByRole("button", { name: "Leave" }));
  await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/student-module/schedule"));
  expect(screen.getByTestId("search-open").textContent).toBe("false");
  noStaffRequests();
});

it.each([401, 403, 404])("hides cached course search results immediately after %s", async (status) => {
  const user = userEvent.setup();
  mount(<SearchProbe />);
  await user.type(screen.getByRole("combobox"), "Visual");
  await screen.findByRole("option", { name: /Visual Design/ });
  coursesDenied = status;
  await act(async () => { await client.invalidateQueries({ queryKey: portalSubjectKey(session.account!, learner, "courses") }); });
  await waitFor(() => expect(screen.queryByRole("option", { name: /Visual Design/ })).toBeNull());
  expect(client.getQueryState(portalSubjectKey(session.account!, learner, "courses"))?.error).toBeInstanceOf(PortalApiError);
  noStaffRequests();
});

it("keeps cached own course search results available during a temporary server failure", async () => {
  const user = userEvent.setup();
  mount(<SearchProbe />);
  await user.type(screen.getByRole("combobox"), "Visual");
  await screen.findByRole("option", { name: /Visual Design/ });
  coursesDenied = 500;
  await act(async () => { await client.invalidateQueries({ queryKey: portalSubjectKey(session.account!, learner, "courses") }); });
  expect(screen.getByRole("option", { name: /Visual Design/ })).toBeTruthy();
  noStaffRequests();
});

it("opens own messages and preserves a reply draft when closing is cancelled", async () => {
  const user = userEvent.setup();
  mount(<MessagesProbe />);
  await user.click(await screen.findByRole("button", { name: "Open" }));
  const conversation = screen.getByRole("dialog", { name: "Project question" });
  await user.type(within(conversation).getByLabelText("Comment"), "My unsent reply");
  await user.keyboard("{Escape}");
  const confirmation = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
  await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect((within(conversation).getByLabelText("Comment") as HTMLTextAreaElement).value).toBe("My unsent reply");
  await user.click(within(conversation).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(requests.some((request) => request.path === "/api/portal/subjects/10/threads/4/comments" && request.body?.includes("My unsent reply"))).toBe(true));
  noStaffRequests();
});

it("lets a parent choose the concrete child for messages without exposing staff conversations", async () => {
  const user = userEvent.setup();
  const second = { ...child, linkId: 22, studentId: 32, studentName: "Child Three" };
  mount(<MessagesProbe />, { ...session, subjects: [child, second] }, "/parent-module");
  await user.click(screen.getByRole("combobox", { name: "Student" }));
  await user.click(screen.getByRole("option", { name: "Child Three" }));
  await screen.findByText("Project question");
  expect(requests.some((request) => request.path === "/api/portal/subjects/22/threads")).toBe(true);
  expect(requests.some((request) => request.path === "/api/portal/subjects/21/threads")).toBe(false);
  noStaffRequests();
});

it("does not request messages for a role without communication access", async () => {
  mount(<MessagesProbe />, { ...session, subjects: [{ ...child, permissions: ["attendance.read"] }] }, "/parent-module");
  expect(await screen.findByText("This section is unavailable.")).toBeTruthy();
  expect(requests.some((request) => request.path.includes("/threads"))).toBe(false);
  noStaffRequests();
});

it("preserves the selected child's reply when an unrelated sibling grant changes", async () => {
  const user = userEvent.setup();
  const second = { ...child, linkId: 22, studentId: 32, studentName: "Child Three" };
  const family = { ...session, subjects: [child, second] };
  mount(<MessagesProbe />, family, "/parent-module");
  await user.click(screen.getByRole("combobox", { name: "Student" }));
  await user.click(screen.getByRole("option", { name: "Child Two" }));
  await user.click(await screen.findByRole("button", { name: "Open" }));
  const conversation = screen.getByRole("dialog", { name: "Project question" });
  const textarea = within(conversation).getByLabelText("Comment") as HTMLTextAreaElement;
  await user.type(textarea, "Keep this reply");
  await act(async () => {
    activeSession = { ...family, subjects: [child, { ...second, permissions: ["attendance.read"] }] };
    client.setQueryData(portalSessionKey, activeSession);
  });
  expect(within(conversation).getByLabelText("Comment")).toBe(textarea);
  expect(textarea.value).toBe("Keep this reply");
  await user.keyboard("{Escape}");
  expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeTruthy();
  noStaffRequests();
});

it("keeps Messages open across an explicit child link change after cancelling or confirming a dirty recipient switch", async () => {
  const user = userEvent.setup();
  const second = { ...child, linkId: 22, studentId: 32, studentName: "Child Three" };
  sessionStorage.setItem("portal-context-50:parent", "21");
  mount(<ShellProbe />, { ...session, subjects: [child, second] }, "/parent-module/progress?linkId=21");
  await user.click(screen.getByRole("button", { name: "Messages" }));
  const messages = screen.getByRole("dialog", { name: "Messages" });
  await user.click(await screen.findByRole("button", { name: "Open" }));
  const conversation = screen.getByRole("dialog", { name: "Project question" });
  const comment = within(conversation).getByLabelText("Comment") as HTMLTextAreaElement;
  await user.type(comment, "Unsent child question");
  // The recipient picker belongs to the containing Sheet. Opening it through
  // its control also exercises a context switch while a nested editor is dirty.
  const selectRecipient = async () => {
    fireEvent.keyDown(screen.getByLabelText("Student"), { key: "ArrowDown" });
    fireEvent.keyDown(await screen.findByRole("option", { name: "Child Three" }), { key: "Enter" });
  };
  await selectRecipient();
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
  expect(new URLSearchParams(location.search).get("linkId")).toBe("21");
  expect(comment.value).toBe("Unsent child question");
  expect(messages.isConnected).toBe(true);
  expect(messages.getAttribute("data-state")).toBe("open");
  await selectRecipient();
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave" }));
  await waitFor(() => expect(new URLSearchParams(location.search).get("linkId")).toBe("22"));
  expect(screen.getByRole("dialog", { name: "Messages" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Project question" })).toBeNull();
  await waitFor(() => expect(requests.some((request) => request.path === "/api/portal/subjects/22/threads")).toBe(true));
  noStaffRequests();
});
