// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Dialog, DialogTitle } from "../client/src/components/ui/dialog";
import { Sheet, SheetTitle } from "../client/src/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogTitle,
} from "../client/src/components/ui/alert-dialog";
import {
  PortalDialogContent as SharedDialogContent,
  PortalSheetContent as SharedSheetContent,
  PortalAlertDialogContent as SharedAlertDialogContent,
} from "../client/src/features/learning-content/modal-content";
import {
  PortalDialogContent,
  PortalSheetContent,
  PortalAlertDialogContent,
} from "../client/src/features/portal-app/modal-content";

afterEach(cleanup);

const variants = [
  {
    name: "dialog",
    Root: Dialog,
    Title: DialogTitle,
    Shared: SharedDialogContent,
    Portal: PortalDialogContent,
    role: "dialog",
  },
  {
    name: "sheet",
    Root: Sheet,
    Title: SheetTitle,
    Shared: SharedSheetContent,
    Portal: PortalSheetContent,
    role: "dialog",
  },
  {
    name: "confirmation",
    Root: AlertDialog,
    Title: AlertDialogTitle,
    Shared: SharedAlertDialogContent,
    Portal: PortalAlertDialogContent,
    role: "alertdialog",
  },
] as const;

it.each(variants)(
  "keeps CRM $name styling unchanged",
  ({ Root, Title, Shared, role }) => {
    render(
      <Root open>
        <Shared aria-describedby={undefined} className="existing-crm-modal">
          <Title>Existing CRM record</Title>
        </Shared>
      </Root>,
    );

    const modal = screen.getByRole(role);
    expect(modal.classList.contains("existing-crm-modal")).toBe(true);
    expect(modal.classList.contains("portal-ui")).toBe(false);
    expect(modal.classList.contains("text-sm")).toBe(false);
  },
);

it.each(variants)(
  "keeps CRM text sizing for the role $name and forwards the original props and ref",
  ({ Root, Title, Portal, role }) => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Root open>
        <Portal
          ref={ref}
          aria-describedby={undefined}
          className="existing-lms-modal"
          data-testid="local-modal"
        >
          <Title>Learning record</Title>
        </Portal>
      </Root>,
    );

    const modal = screen.getByRole(role);
    expect(modal).toBe(screen.getByTestId("local-modal"));
    expect(modal).toBe(ref.current);
    expect(modal.classList.contains("existing-lms-modal")).toBe(true);
    expect(modal.classList.contains("portal-ui")).toBe(true);
    expect(modal.classList.contains("text-sm")).toBe(false);
  },
);
