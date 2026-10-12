// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PortalProjectComparisonDto,
  PortalProjectDto,
} from "@shared/contracts/portal-resources";
import { i18n } from "../client/src/lib/i18n";
import { ProjectComparison } from "../client/src/features/lms/progress";
import { PortalApiError } from "../client/src/features/portal-app/api";
const mocks = vi.hoisted(() => ({
  projects: vi.fn(),
  comparison: vi.fn(),
  save: vi.fn(),
  unsaved: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/context", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../client/src/features/portal-app/context")
    >();
  function useSubjectQuery<T>(
    name: string,
    load: (linkId: number, signal: AbortSignal) => Promise<T>,
    extra: unknown[] = [],
  ) {
    return useQuery({
      queryKey: [name, ...extra],
      queryFn: ({ signal }) => load(10, signal),
    });
  }
  return {
    ...actual,
    useSubjectQuery,
    usePortal: () => ({
      account: { id: 50 },
      subject: { linkId: 10, studentName: "Learner", kind: "self" },
      allowed: () => true,
      guarded: (action: () => void) => action(),
      setUnsaved: mocks.unsaved,
    }),
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
        projects: mocks.projects,
        projectComparison: mocks.comparison,
        saveComparison: mocks.save,
      },
    };
  },
);
const projects: PortalProjectDto[] = [1, 2, 3, 4].map((id) => ({
  id,
  studentId: 20,
  runId: 2,
  courseName: "Course",
  title: `Project ${id}`,
  description: `Description ${id}`,
  sourceSubmissionId: null,
  links: [],
  files: [],
  coverFileId: null,
  teacherReview: null,
  version: 1,
  createdAt: `2026-10-0${id}T10:00:00Z`,
  updatedAt: "2026-10-11T10:00:00Z",
  archivedAt: null,
  shares: [],
}));
const saved = (
  version: number,
  firstProjectId = 1,
  latestProjectId = 3,
): PortalProjectComparisonDto => ({
  firstProjectId,
  latestProjectId,
  runId: 2,
  selectedByName: "Teacher",
  selectedByRole: "teacher",
  version,
  updatedAt: "2026-10-11T10:00:00Z",
  firstProject: projects.find((project) => project.id === firstProjectId)!,
  latestProject: projects.find((project) => project.id === latestProjectId)!,
});
let client: QueryClient;
const mount = () =>
  render(
    <QueryClientProvider client={client}>
      <ProjectComparison />
    </QueryClientProvider>,
  );
const firstSelect = () =>
  screen.getByLabelText(i18n.t("portalFirstWork"), {
    selector: "select",
  }) as HTMLSelectElement;
const lastSelect = () =>
  screen.getByLabelText(i18n.t("portalLatestWork"), {
    selector: "select",
  }) as HTMLSelectElement;
beforeEach(() => {
  i18n.setLanguage("ru");
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  mocks.projects.mockResolvedValue(projects);
  mocks.comparison.mockResolvedValue(saved(1));
  mocks.save.mockRejectedValue(new PortalApiError(409, "lmsVersionConflict"));
});
afterEach(async () => {
  cleanup();
  client.clear();
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
});
describe("learner comparison draft version", () => {
  it("keeps both editing selections and the original CAS version through a teacher refresh and a conflict", async () => {
    mount();
    await screen.findByText(/Teacher/);
    await userEvent.selectOptions(firstSelect(), "2");
    act(() => client.setQueryData(["project-comparison", 2], saved(8, 4, 1)));
    expect(firstSelect().value).toBe("2");
    expect(lastSelect().value).toBe("3");
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("portalComparisonSave") }),
    );
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(10, {
        runId: 2,
        firstProjectId: 2,
        latestProjectId: 3,
        version: 1,
      }),
    );
    await screen.findByText(i18n.t("lmsVersionConflict"));
    expect(firstSelect().value).toBe("2");
    expect(lastSelect().value).toBe("3");
  });

  it("retains the draft when reload is cancelled and adopts the new baseline only after explicit confirmation", async () => {
    mount();
    await screen.findByText(/Teacher/);
    await userEvent.selectOptions(firstSelect(), "2");
    act(() => client.setQueryData(["project-comparison", 2], saved(8, 4, 1)));
    mocks.comparison.mockResolvedValue(saved(8, 4, 1));
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("portalComparisonSave") }),
    );
    await screen.findByText(i18n.t("lmsVersionConflict"));
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffReload") }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: i18n.t("portalCancel"),
      }),
    );
    expect(firstSelect().value).toBe("2");
    expect(lastSelect().value).toBe("3");
    expect(mocks.comparison).toHaveBeenCalledOnce();
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffReload") }),
    );
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: i18n.t("lmsStaffReload"),
      }),
    );
    await waitFor(() => expect(firstSelect().value).toBe("4"));
    expect(lastSelect().value).toBe("1");
    await userEvent.selectOptions(firstSelect(), "2");
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("portalComparisonSave") }),
    );
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(10, {
        runId: 2,
        firstProjectId: 2,
        latestProjectId: 1,
        version: 8,
      }),
    );
  });

  it("adopts current server choices when the view is reopened instead of restoring its discarded draft", async () => {
    const view = mount();
    await screen.findByText(/Teacher/);
    await userEvent.selectOptions(firstSelect(), "2");
    mocks.comparison.mockResolvedValue(saved(8, 4, 1));
    act(() => client.setQueryData(["project-comparison", 2], saved(8, 4, 1)));
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    mount();
    await waitFor(() => expect(firstSelect().value).toBe("4"));
    expect(lastSelect().value).toBe("1");
  });
});
