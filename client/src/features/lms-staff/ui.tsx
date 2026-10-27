import { isLmsLearningRecipient } from "@shared/contracts/lms";
import {
  PortalDialogContent as DialogContent,
  PortalAlertDialogContent as AlertDialogContent,
} from "../learning-content/modal-content";
import { useState, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { translations, type TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialogBody,
  AlertDialogHeader,
  AlertDialog,
  AlertDialogAction,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type {
  LmsStaffEnrollmentDto,
  LmsStaffRunDto,
} from "@shared/contracts/lms";
import { LmsStaffApiError } from "./api";
import { LoadingRegion } from '@/components/ui/loading-region';
import { NativeCheckbox } from "@/components/ui/checkbox";
export function useStaffError() {
  const { t } = useTranslation();
  return (error: unknown, fallback: TranslationKey = "lmsStaffSaveFailed") => {
    if (error instanceof LmsStaffApiError) {
      if (error.status === 0) return t("portalOffline");
      if (error.status === 403 || error.status === 404)
        return t("portalUnavailable");
      if (error.code in translations) return t(error.code as TranslationKey);
      if (error.status === 409) return t("lmsStaffReviewConflict");
    }
    return t(fallback);
  };
}
export function StaffLoading() {
  const { t } = useTranslation();
  return (
    <LoadingRegion aria-label={t("portalLoading")} role="status" className="space-y-3">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </LoadingRegion>
  );
}
export function StaffError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  return (
    <Card>
      <CardContent className="space-y-3 p-5" role="alert">
        <p>{message(error, "lmsStaffLoadFailed")}</p>
        <Button variant="outline" onClick={retry}>
          {t("lmsStaffRetry")}
        </Button>
      </CardContent>
    </Card>
  );
}
export function StaffEmpty() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="p-6 text-sm text-muted-foreground">
        {t("lmsStaffNoItems")}
      </CardContent>
    </Card>
  );
}
export function StaffGroupSetup({
  run,
  retry,
  onFormat,
  onProgram,
}: {
  run: LmsStaffRunDto;
  retry?: () => void;
  onFormat?: () => void;
  onProgram?: () => void;
}) {
  const { t } = useTranslation();
  const labels: Record<string, TranslationKey> = {
    preparing: "lmsStaffGroupPreparing",
    needs_format: "lmsStaffGroupNeedsFormat",
    needs_course: "lmsStaffGroupNeedsCourse",
    needs_program_review: "lmsStaffGroupProgramReview",
  };
  const status = run.setupStatus;
  const canFormat =
    status === "needs_format" &&
    run.permissions?.includes("content.manage") &&
    onFormat;
  const canRetry = status === "preparing" || !status;
  const canReviewProgram =
    status === "needs_program_review" &&
    run.runId &&
    run.courseId &&
    run.permissions?.includes("content.manage") &&
    onProgram;
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="text-sm text-muted-foreground">
          {t(labels[status ?? ""] ?? "lmsStaffGroupNotReady")}
        </p>
        {canFormat && (
          <Button variant="outline" onClick={onFormat}>
            {t("lmsStaffSelectFormat")}
          </Button>
        )}
        {canReviewProgram && (
          <Button variant="outline" onClick={onProgram}>
            {t("lmsStaffReviewProgram")}
          </Button>
        )}
        {canRetry && retry && (
          <Button variant="outline" onClick={retry}>
            {t("lmsStaffRetry")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
export function StaffField({
  id,
  labelKey,
  children,
}: {
  id: string;
  labelKey: TranslationKey;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      {children}
    </div>
  );
}
export function StaffConfirm({
  open,
  onOpenChange,
  titleKey,
  description,
  action,
  onConfirm,
  pending,
  disabled,
  error,
  children,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  titleKey: TranslationKey;
  description: TranslationKey;
  action: TranslationKey;
  onConfirm: () => void;
  pending?: boolean;
  disabled?: boolean;
  error?: unknown;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange} pending={pending}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>{t(description)}</AlertDialogDescription>
          {children}
          {Boolean(error) && (
            <p role="alert" className="text-sm text-destructive">
              {message(error)}
            </p>
          )}
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("lmsStaffCancel")}
          </AlertDialogCancel>
          <AlertDialogAction asChild onClick={(event) => { event.preventDefault(); onConfirm(); }}>
            <Button loading={pending} disabled={pending || disabled}>
              {pending ? t('confirmProcessing') : t(action)}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function StaffDialog({
  open,
  onClose,
  titleKey,
  description,
  dirty = false,
  pending = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  titleKey: TranslationKey;
  description?: string;
  dirty?: boolean;
  pending?: boolean;
  children: ReactNode;
}) {
  const [discard, setDiscard] = useState(false);
  const { t } = useTranslation();
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !pending) {
            if (dirty) setDiscard(true);
            else onClose();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t(titleKey)}</DialogTitle>
            <DialogDescription>
              {description ?? t("lmsStaffTitle")}
            </DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
      <StaffConfirm
        open={discard}
        onOpenChange={setDiscard}
        titleKey="portalUnsavedTitle"
        description="portalUnsavedDescription"
        action="portalLeave"
        onConfirm={() => {
          setDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
export function StaffRecipients({
  items,
  selected,
  onChange,
}: {
  items: LmsStaffEnrollmentDto[];
  selected: number[];
  onChange: (value: number[]) => void;
}) {
  const { t } = useTranslation();
  const active = items.filter(isLmsLearningRecipient);
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">
        {t("lmsStaffRecipients")}
      </legend>
      <label className="flex min-h-11 items-center gap-3">
        <NativeCheckbox
          type="checkbox"
          checked={
            active.length > 0 &&
            active.every((item) => selected.includes(item.id))
          }
          onChange={(event) =>
            onChange(event.target.checked ? active.map((item) => item.id) : [])
          }
        />
        {t("lmsStaffAllRecipients")}
      </label>
      <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
        {active.map((item) => (
          <label key={item.id} className="flex min-h-11 items-center gap-3">
            <NativeCheckbox
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
            />
            <span className="min-w-0 break-words">{item.studentName}</span>
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("lmsStaffRecipientsCount").replace(
          "{count}",
          String(selected.length),
        )}
      </p>
    </fieldset>
  );
}
export function StaffStatus({ state }: { state: string }) {
  const { t } = useTranslation();
  const keys: Record<string, TranslationKey> = {
    draft: "lmsStaffDraft",
    published: "lmsStaffPublished",
    archived: "lmsStaffArchiveMaterial",
    accepted: "portalAccepted",
    submitted: "portalSubmitted",
    revision_required: "portalRevisionRequired",
    open: "portalOpenQuestion",
    answered: "portalAnswered",
    resolved: "portalResolved",
  };
  return (
    <Badge variant="secondary">{t(keys[state] ?? "lmsStaffActive")}</Badge>
  );
}
export function useStaffFormat() {
  const { language } = useTranslation();
  return (value: string) =>
    new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tashkent",
    }).format(new Date(value));
}
export function staffDateInput(value?: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tashkent",
  }).formatToParts(new Date(value));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function staffDateIso(value: string) {
  return new Date(`${value}:00+05:00`).toISOString();
}
export function safeStaffLink(value: string) {
  try {
    const link = new URL(value);
    return link.protocol === "https:" && !link.username && !link.password;
  } catch {
    return false;
  }
}
