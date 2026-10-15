import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import {
  PortalDialogContent as SharedDialogContent,
  PortalSheetContent as SharedSheetContent,
  PortalAlertDialogContent as SharedAlertDialogContent,
} from "../learning-content/modal-content";
import { cn } from "@/lib/utils";

export const PortalDialogContent = forwardRef<
  ElementRef<typeof SharedDialogContent>,
  ComponentPropsWithoutRef<typeof SharedDialogContent>
>(function PortalDialogContent({ className, ...props }, ref) {
  return (
    <SharedDialogContent
      ref={ref}
      {...props}
      className={cn("portal-ui text-sm", className)}
    />
  );
});

export const PortalSheetContent = forwardRef<
  ElementRef<typeof SharedSheetContent>,
  ComponentPropsWithoutRef<typeof SharedSheetContent>
>(function PortalSheetContent({ className, ...props }, ref) {
  return (
    <SharedSheetContent
      ref={ref}
      {...props}
      className={cn("portal-ui text-sm", className)}
    />
  );
});

export const PortalAlertDialogContent = forwardRef<
  ElementRef<typeof SharedAlertDialogContent>,
  ComponentPropsWithoutRef<typeof SharedAlertDialogContent>
>(function PortalAlertDialogContent({ className, ...props }, ref) {
  return (
    <SharedAlertDialogContent
      ref={ref}
      {...props}
      className={cn("portal-ui text-sm", className)}
    />
  );
});
