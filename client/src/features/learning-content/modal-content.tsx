import {
  forwardRef,
  useRef,
  type ElementRef,
  type ComponentPropsWithoutRef,
} from "react";
import { DialogContent as PrimitiveDialogContent } from "@/components/ui/dialog";
import { SheetContent as PrimitiveSheetContent } from "@/components/ui/sheet";
import { AlertDialogContent as PrimitiveAlertDialogContent } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

function usePortalModalFocus(props: {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      props.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      props.onCloseAutoFocus?.(event);
      if (event.defaultPrevented || !opener.current?.isConnected) return;
      const openDialogs = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
        ),
      ];
      event.preventDefault();
      const topDialog = openDialogs.at(-1);
      if (!topDialog || topDialog.contains(opener.current))
        opener.current.focus();
    },
  };
}
export const PortalDialogContent = forwardRef<
  ElementRef<typeof PrimitiveDialogContent>,
  ComponentPropsWithoutRef<typeof PrimitiveDialogContent>
>(function PortalDialogContent(props, ref) {
  const focus = usePortalModalFocus(props);
  return (
    <PrimitiveDialogContent
      ref={ref}
      {...props}
      className={cn("portal-ui text-sm", props.className)}
      {...focus}
    />
  );
});
export const PortalSheetContent = forwardRef<
  ElementRef<typeof PrimitiveSheetContent>,
  ComponentPropsWithoutRef<typeof PrimitiveSheetContent>
>(function PortalSheetContent(props, ref) {
  const focus = usePortalModalFocus(props);
  return (
    <PrimitiveSheetContent
      ref={ref}
      {...props}
      className={cn("portal-ui text-sm", props.className)}
      {...focus}
    />
  );
});
export const PortalAlertDialogContent = forwardRef<
  ElementRef<typeof PrimitiveAlertDialogContent>,
  ComponentPropsWithoutRef<typeof PrimitiveAlertDialogContent>
>(function PortalAlertDialogContent(props, ref) {
  const focus = usePortalModalFocus(props);
  return (
    <PrimitiveAlertDialogContent
      ref={ref}
      {...props}
      className={cn("portal-ui text-sm", props.className)}
      {...focus}
    />
  );
});
