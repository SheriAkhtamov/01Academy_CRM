import type { ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { toast } from "@/hooks/use-toast";
import { translations, type TranslationKey } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { PortalApiError } from "./api";
import { PortalAlertDialogContent } from "../learning-content/modal-content";
export {
  PortalDialogContent,
  PortalSheetContent,
  PortalAlertDialogContent,
} from "../learning-content/modal-content";

export function usePortalContent() {
  const { t } = useTranslation();
  return (value: string) =>
    value in translations ? t(value as TranslationKey) : value;
}
export function usePortalSuccess() {
  const { t } = useTranslation();
  return (key: TranslationKey = "portalSaved") => {
    toast({ title: t(key) });
  };
}
export function usePortalError() {
  const { t } = useTranslation();
  return (error: unknown, fallback: TranslationKey = "portalLoadError") => {
    if (!(error instanceof PortalApiError)) return t(fallback);
    if (error.status === 0) return t("portalOffline");
    const key = error.code as TranslationKey;
    if (key in translations) return t(key);
    if (error.status === 409) return t("portalConflict");
    if (error.status === 429) return t("portalTooManyAttempts");
    if (error.status === 401) return t("portalWrongCredentials");
    if (error.status === 403 || error.status === 404)
      return t("portalUnavailable");
    return t(fallback);
  };
}
export function PortalLoading() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t("portalLoading")} className="space-y-4">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>
  );
}
export function PortalError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  return (
    <Card>
      <CardContent className="space-y-4 p-6" role="alert">
        <p>{message(error)}</p>
        {retry && (
          <Button variant="outline" className="min-h-11" onClick={retry}>
            {t("portalRetry")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
export function PortalEmpty({ labelKey }: { labelKey: TranslationKey }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="p-6 text-muted-foreground">
        {t(labelKey)}
      </CardContent>
    </Card>
  );
}
export function PortalTitle({
  labelKey,
  children,
}: {
  labelKey: TranslationKey;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
        {t(labelKey)}
      </h1>
      {children}
    </div>
  );
}
export function ConfirmAction({
  open,
  onOpenChange,
  titleKey,
  description,
  action = "portalRemove",
  onConfirm,
  pending = false,
  error,
  objectName,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  titleKey: TranslationKey;
  description: TranslationKey | string;
  action?: TranslationKey;
  onConfirm: () => void;
  pending?: boolean;
  error?: string;
  objectName?: string;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <PortalAlertDialogContent className="portal-ui">
        <AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
        {objectName && <p className="break-words font-medium">{objectName}</p>}
        <AlertDialogDescription>
          {description in translations
            ? t(description as TranslationKey)
            : description}
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("portalCancel")}
          </AlertDialogCancel>
          <Button disabled={pending} onClick={onConfirm}>
            {t(action)}
          </Button>
        </AlertDialogFooter>
      </PortalAlertDialogContent>
    </AlertDialog>
  );
}
const statusKeys: Record<string, TranslationKey> = {
  assigned: "portalAssigned",
  submitted: "portalSubmitted",
  revision_required: "portalRevisionRequired",
  accepted: "portalAccepted",
  excused: "portalExcused",
  cancelled: "portalCancelled",
  present: "portalPresent",
  absent: "portalAbsent",
  planned: "portalUpcoming",
  scheduled: "portalUpcoming",
  completed: "portalCompleted",
  conducted: "portalCompleted",
  needed: "portalMakeupNeeded",
  in_progress: "portalMakeupInProgress",
  not_required: "portalCompleted",
  open: "portalOpenQuestion",
  answered: "portalAnswered",
  resolved: "portalResolved",
};
export function PortalStatus({ status }: { status: string | null }) {
  const { t } = useTranslation();
  return (
    <Badge variant="secondary">
      {t(statusKeys[status ?? ""] ?? "portalUnmarked")}
    </Badge>
  );
}
export function usePortalFormat() {
  const { language } = useTranslation();
  const locale = language === "ru" ? "ru-RU" : "en-GB";
  return {
    date: (value: string | Date) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "Asia/Tashkent",
      }).format(new Date(value)),
    time: (value: string | Date) =>
      new Intl.DateTimeFormat(locale, {
        timeStyle: "short",
        timeZone: "Asia/Tashkent",
      }).format(new Date(value)),
    money: (value: number, currency = "UZS") =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value),
  };
}
export function safeHttps(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
