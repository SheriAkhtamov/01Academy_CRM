// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import {
  DEFAULT_LEARNING_SCHOOL_SETTINGS,
  type LearningSchoolSettingsDto,
} from "../shared/contracts/learning-settings";
import { SchoolSettingsCard } from "../client/src/features/learning-rollout/SchoolSettingsCard";
import { i18n } from "../client/src/lib/i18n";

const mocks = vi.hoisted(() => ({
  schoolSettings: vi.fn(),
  updateSchoolSettings: vi.fn(),
}));
vi.mock("../client/src/features/learning-rollout/api", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../client/src/features/learning-rollout/api")
    >();
  return {
    ...actual,
    learningRolloutApi: {
      ...actual.learningRolloutApi,
      schoolSettings: mocks.schoolSettings,
      updateSchoolSettings: mocks.updateSchoolSettings,
    },
  };
});
const settings: LearningSchoolSettingsDto = {
  settings: structuredClone(DEFAULT_LEARNING_SCHOOL_SETTINGS),
  version: 7,
  employees: [{ id: 60, fullName: "Coordinator Smith" }],
  emailConfigured: false,
  scannerConfigured: false,
};
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  i18n.setLanguage("ru");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.schoolSettings.mockResolvedValue(structuredClone(settings));
  mocks.updateSchoolSettings.mockImplementation(async (input) => ({
    ...structuredClone(settings),
    settings: input.settings,
    version: input.version + 1,
  }));
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  client.clear();
});
async function openSettings() {
  render(
    <QueryClientProvider client={client}>
      <SchoolSettingsCard enabled />
    </QueryClientProvider>,
  );
  const opener = screen.getByRole("button", {
    name: i18n.t("lmsRolloutConfiguration"),
  });
  await waitFor(() =>
    expect((opener as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(opener);
  await screen.findByLabelText(i18n.t("lmsSettingsMaxFileMiB"));
  return opener;
}
function changeFileLimit(value: string) {
  fireEvent.change(screen.getByLabelText(i18n.t("lmsSettingsMaxFileMiB")), {
    target: { value },
  });
}
function saveButton() {
  return screen.getByRole("button", { name: i18n.t("lmsRolloutSave") });
}

it("preserves an edited draft during background refetch and confirms a file-policy change with the version originally opened", async () => {
  await openSettings();
  changeFileLimit("37");
  mocks.schoolSettings.mockResolvedValue({
    ...settings,
    version: 8,
    settings: {
      ...structuredClone(settings.settings),
      maxFileMiB: 80,
      studentQuotaGiB: 12,
    },
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: ["learning-school-settings"] });
  });
  expect(
    (screen.getByLabelText(i18n.t("lmsSettingsMaxFileMiB")) as HTMLInputElement)
      .value,
  ).toBe("37");
  expect(
    (
      screen.getByLabelText(
        i18n.t("lmsSettingsStudentQuotaGiB"),
      ) as HTMLInputElement
    ).value,
  ).toBe("5");
  await userEvent.click(saveButton());
  const confirmation = screen.getByRole("alertdialog", {
    name: i18n.t("lmsSettingsSaveTitle"),
  });
  expect(confirmation.textContent).toContain(i18n.t("lmsSettingsSaveBody"));
  expect(mocks.updateSchoolSettings).not.toHaveBeenCalled();
  await userEvent.click(
    within(confirmation).getByRole("button", {
      name: i18n.t("lmsRolloutSave"),
    }),
  );
  await waitFor(() =>
    expect(mocks.updateSchoolSettings).toHaveBeenCalledWith(
      { version: 7, settings: { ...settings.settings, maxFileMiB: 37 } },
      expect.anything(),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("requires confirmation before making child payments visible and cancellation leaves the policy unpublished", async () => {
  await openSettings();
  await userEvent.click(
    screen.getByRole("tab", { name: i18n.t("lmsSettingsFinancePolicy") }),
  );
  const policy = screen.getByRole("checkbox", {
    name: i18n.t("lmsSettingsAllowChildPayments"),
  });
  expect(policy.getAttribute("aria-checked")).toBe("false");
  await userEvent.click(policy);
  await userEvent.click(saveButton());
  expect(mocks.updateSchoolSettings).not.toHaveBeenCalled();
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("cancel"),
    }),
  );
  expect(mocks.updateSchoolSettings).not.toHaveBeenCalled();
  expect(policy.getAttribute("aria-checked")).toBe("true");
  await userEvent.click(saveButton());
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("lmsRolloutSave"),
    }),
  );
  await waitFor(() =>
    expect(mocks.updateSchoolSettings).toHaveBeenCalledWith(
      {
        version: 7,
        settings: { ...settings.settings, childFinanceVisible: true },
      },
      expect.anything(),
    ),
  );
});

it("keeps policy changes after a failed save and protects closing until the user discards the edited draft", async () => {
  mocks.updateSchoolSettings.mockRejectedValue(new Error("Version changed"));
  await openSettings();
  changeFileLimit("37");
  await userEvent.click(saveButton());
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("lmsRolloutSave"),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      i18n.t("lmsStaffSaveFailed"),
    ),
  );
  const confirmation = screen.getByRole("alertdialog");
  await userEvent.click(
    within(confirmation).getByRole("button", { name: i18n.t("cancel") }),
  );
  expect(
    (screen.getByLabelText(i18n.t("lmsSettingsMaxFileMiB")) as HTMLInputElement)
      .value,
  ).toBe("37");
  await userEvent.click(screen.getByRole("button", { name: i18n.t("cancel") }));
  const warning = screen.getByRole("alertdialog", {
    name: i18n.t("unsavedChangesTitle"),
  });
  await userEvent.click(
    within(warning).getByRole("button", { name: i18n.t("keepEditing") }),
  );
  expect(
    (screen.getByLabelText(i18n.t("lmsSettingsMaxFileMiB")) as HTMLInputElement)
      .value,
  ).toBe("37");
  await userEvent.click(screen.getByRole("button", { name: i18n.t("cancel") }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("discardChanges"),
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.updateSchoolSettings).toHaveBeenCalledOnce();
});

it("does not offer saving an invalid file limit", async () => {
  await openSettings();
  changeFileLimit("101");
  expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(saveButton());
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(mocks.updateSchoolSettings).not.toHaveBeenCalled();
});
