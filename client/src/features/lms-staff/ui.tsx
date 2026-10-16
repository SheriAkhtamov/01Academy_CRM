import {
  PortalDialogContent as DialogContent,
  PortalAlertDialogContent as AlertDialogContent,
} from "../learning-content/modal-content";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react";
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
  AlertDialog,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type {
  LmsStaffEnrollmentDto,
  LmsStaffRunDto,
} from "@shared/contracts/lms";
import { LmsStaffApiError } from "./api";
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
    <div aria-label={t("portalLoading")} role="status" className="space-y-3">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
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
    <Card className="border-rose-500/30 bg-rose-500/[0.03]">
      <CardContent
        className="flex flex-wrap items-center justify-between gap-4 p-5"
        role="alert"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium">
            {message(error, "lmsStaffLoadFailed")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={retry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          {t("lmsStaffRetry")}
        </Button>
      </CardContent>
    </Card>
  );
}
export function StaffEmpty() {
  const { t } = useTranslation();
  return (
    <Card className="border-dashed bg-muted/15 shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="h-5 w-5" />
        </div>
        <p className="font-medium text-foreground/80">{t("lmsStaffNoItems")}</p>
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
    <Card className="border-amber-500/30 bg-amber-500/[0.04]">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
            {status === "preparing" ? (
              <Clock className="h-4 w-4" />
            ) : (
              <Settings2 className="h-4 w-4" />
            )}
          </div>
          <p className="text-sm font-medium text-foreground">
            {t(labels[status ?? ""] ?? "lmsStaffGroupNotReady")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canFormat && (
            <Button variant="outline" size="sm" onClick={onFormat}>
              {t("lmsStaffSelectFormat")}
            </Button>
          )}
          {canReviewProgram && (
            <Button variant="outline" size="sm" onClick={onProgram}>
              {t("lmsStaffReviewProgram")}
            </Button>
          )}
          {canRetry && retry && (
            <Button variant="outline" size="sm" onClick={retry}>
              {t("lmsStaffRetry")}
            </Button>
          )}
        </div>
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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
        <AlertDialogDescription>{t(description)}</AlertDialogDescription>
        {children}
        {Boolean(error) && (
          <p role="alert" className="text-sm text-destructive">
            {message(error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("lmsStaffCancel")}
          </AlertDialogCancel>
          <Button disabled={pending || disabled} onClick={onConfirm}>
            {t(action)}
          </Button>
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
  const active = items.filter((item) => item.status === "active");
  return (
    <fieldset className="space-y-3 rounded-xl border bg-muted/15 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary" />
          {t("lmsStaffRecipients")}
        </legend>
        <Badge variant="secondary" className="text-xs">
          {t("lmsStaffRecipientsCount").replace(
            "{count}",
            String(selected.length),
          )}
        </Badge>
      </div>
      <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/40">
        <input
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
      <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border bg-background p-2.5 sm:grid-cols-2">
        {active.map((item) => (
          <label
            key={item.id}
            className={cn(
              "flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/40",
              selected.includes(item.id) && "bg-primary/5 font-medium",
            )}
          >
            <input
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
  const tones: Record<string, string> = {
    published:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    accepted:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    resolved:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    submitted:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    open: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    needed:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    revision_required:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    cancelled:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    answered: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    in_progress:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    draft: "border-border bg-muted/60 text-muted-foreground",
    archived: "border-border bg-muted/60 text-muted-foreground",
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        tones[state] ??
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      )}
    >
      {["published", "accepted", "resolved"].includes(state) && (
        <CheckCircle2 className="h-3 w-3" />
      )}
      {t(keys[state] ?? "lmsStaffActive")}
    </Badge>
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
