// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LmsStaffMaterialDto,
  LmsStaffRunDto,
} from "@shared/contracts/lms";
import { i18n } from "../client/src/lib/i18n";
import { LearningManagement } from "../client/src/features/lms-staff/management";
import { StaffMaterials } from "../client/src/features/lms-staff/materials";

const groups: LmsStaffRunDto[] = [1, 2].map((id) => ({
  groupId: id,
  groupName: `Group ${id}`,
  courseName: `Course ${id}`,
  runId: null,
  setupStatus: "needs_course",
  format: "online",
  teacherName: null,
  status: "active",
  studentCount: 5,
  courseVersionId: null,
}));
const materials: LmsStaffMaterialDto[] = ["lesson", "practice", "repeat"].map(
  (category, index) => ({
    id: index + 1,
    runId: 3,
    unitId: null,
    state: "draft",
    materialVersionId: index + 1,
    version: 1,
    title: `${category} material`,
    body: `Content ${index + 1}`,
    category: category as LmsStaffMaterialDto["category"],
    links: [],
    fileIds: [],
    publishAt: null,
  }),
);

let client: QueryClient;
function mount(element: ReactNode) {
  return render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
  );
}
beforeEach(() => {
  i18n.setLanguage("ru");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("/runs?") ? groups : materials;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe("staff LMS keyboard filters", () => {
  it("filters materials by keyboard with announced category state and a named search field", async () => {
    const user = userEvent.setup();
    mount(<StaffMaterials runId={3} enrollments={[]} />);
    const all = await screen.findByRole("button", {
      name: i18n.t("lmsStaffAllCategories"),
    });
    const practice = screen.getByRole("button", {
      name: i18n.t("portalPractice"),
    });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(practice.getAttribute("aria-pressed")).toBe("false");
    practice.focus();
    await user.keyboard("{Enter}");
    expect(practice.getAttribute("aria-pressed")).toBe("true");
    expect(all.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("practice material")).toBeTruthy();
    expect(screen.queryByText("lesson material")).toBeNull();
    expect(screen.queryByText("repeat material")).toBeNull();

    all.focus();
    await user.keyboard(" ");
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("lesson material")).toBeTruthy();
    const search = screen.getByRole("textbox", { name: i18n.t("search") });
    await user.type(search, "lesson");
    expect(screen.getByText("lesson material")).toBeTruthy();
    expect(screen.queryByText("practice material")).toBeNull();
    expect(screen.queryByText("repeat material")).toBeNull();
  });

  it.each(["{Enter}", " "])(
    "selects groups from keyboard chips with %s and updates pressed state",
    async (key) => {
      const user = userEvent.setup();
      mount(<LearningManagement />);
      const first = await screen.findByRole("button", {
        name: /^Group 1/,
        pressed: false,
      });
      const second = screen.getByRole("button", { name: /^Group 2/, pressed: false });
      expect(first.getAttribute("aria-pressed")).toBe("false");
      second.focus();
      await user.keyboard(key);
      expect(second.getAttribute("aria-pressed")).toBe("true");
      expect(
        (screen.getByLabelText(i18n.t("lmsStaffGroup")) as HTMLSelectElement)
          .value,
      ).toBe("2");

      first.focus();
      await user.keyboard(key);
      expect(first.getAttribute("aria-pressed")).toBe("true");
      expect(second.getAttribute("aria-pressed")).toBe("false");
      expect(
        (screen.getByLabelText(i18n.t("lmsStaffGroup")) as HTMLSelectElement)
          .value,
      ).toBe("1");
    },
  );

  it.each(["{Enter}", " "])(
    "opens a group from its whole-card button using %s",
    async (key) => {
      const user = userEvent.setup();
      const { container } = mount(<LearningManagement />);
      const card = await screen.findByRole("button", {
        name: /Group 2.*Course 2/,
      });
      expect(card.tagName).toBe("BUTTON");
      expect(card.querySelector("button")).toBeNull();
      card.focus();
      await user.keyboard(key);
      expect(
        (screen.getByLabelText(i18n.t("lmsStaffGroup")) as HTMLSelectElement)
          .value,
      ).toBe("2");
      expect(
        screen.getByRole("button", { name: /^Group 2/, pressed: true }).getAttribute(
          "aria-pressed",
        ),
      ).toBe("true");
      expect(container.contains(card)).toBe(false);
    },
  );
});
