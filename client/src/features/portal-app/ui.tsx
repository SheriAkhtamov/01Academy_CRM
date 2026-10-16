import type { ComponentProps, ReactNode } from "react";
import { Inbox, XCircle } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { toast } from "@/hooks/use-toast";
import { translations, type TranslationKey } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ux/EmptyState";
import { PageHeader } from "@/components/ux/PageHeader";
import {
  AlertDialog,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { PortalApiError } from "./api";
import { PortalAlertDialogContent } from "./modal-content";
export {
  PortalDialogContent,
  PortalSheetContent,
  PortalAlertDialogContent,
} from "./modal-content";

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
export function isPortalAccessError(error: unknown): boolean {
  return error instanceof PortalApiError && [401, 403, 404].includes(error.status);
}
export function usePortalError() {
  const { t } = useTranslation();
  const localKeys: Partial<Record<TranslationKey, TranslationKey>> = {
    portalLoadError: "portalLmsLoadError",
    portalOffline: "portalLmsOffline",
    portalConflict: "portalLmsConflict",
  };
  const localized = (key: TranslationKey) => t(localKeys[key] ?? key);
  return (error: unknown, fallback: TranslationKey = "portalLmsLoadError") => {
    if (!(error instanceof PortalApiError)) return localized(fallback);
    if (error.status === 0) return t("portalLmsOffline");
    const key = error.code as TranslationKey;
    if (key in translations) return localized(key);
    if (error.status === 409) return t("portalLmsConflict");
    if (error.status === 429) return t("portalTooManyAttempts");
    if (error.status === 401) return t("portalWrongCredentials");
    if (error.status === 403 || error.status === 404)
      return t("portalUnavailable");
    return localized(fallback);
  };
}
export function PortalLoading({ variant = "page" }: { variant?: "page" | "section" }) {
  const { t } = useTranslation();
  if (variant === "section") {
    return (
      <div role="status" aria-label={t("portalLoading")} className="space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
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
      <CardContent className="p-6" role="alert">
        <EmptyState
          icon={XCircle}
          title={message(error)}
          action={retry && (
            <Button type="button" variant="outline" onClick={retry}>
              {t("portalRetry")}
            </Button>
          )}
          className="py-6"
        />
      </CardContent>
    </Card>
  );
}
export function PortalEmpty({
  labelKey,
  embedded = false,
}: {
  labelKey: TranslationKey;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  if (embedded) return <EmptyState icon={Inbox} title={t(labelKey)} />;
  return (
    <Card>
      <CardContent className="p-6">
        <EmptyState icon={Inbox} title={t(labelKey)} className="py-6" />
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
  return <PageHeader title={t(labelKey)} actions={children} />;
}
const destructiveActions = new Set<TranslationKey>([
  "portalRemove",
  "portalWithdraw",
  "portalArchiveProject",
  "portalRevoke",
  "portalRevokeSession",
  "portalLeave",
  "lmsStaffReload",
]);

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
  variant,
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
  variant?: "default" | "destructive";
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
        <AlertDialogHeader>
          <AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
          {objectName && <p className="break-words font-medium">{objectName}</p>}
          <AlertDialogDescription>
            {description in translations
              ? t(description as TranslationKey)
              : description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("portalCancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={
              variant ?? (destructiveActions.has(action) ? "destructive" : "default")
            }
            disabled={pending}
            onClick={onConfirm}
          >
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
  soon: "portalUpcoming",
  available: "portalAvailable",
  studied: "portalLearned",
};
const statusVariants: Record<string, ComponentProps<typeof Badge>["variant"]> = {
  assigned: "info",
  submitted: "warning",
  revision_required: "warning",
  accepted: "success",
  present: "success",
  absent: "destructive",
  planned: "info",
  scheduled: "info",
  completed: "success",
  conducted: "success",
  needed: "warning",
  in_progress: "info",
  open: "info",
  answered: "success",
  resolved: "success",
  soon: "secondary",
  available: "info",
  studied: "success",
};
export function portalStatusVariant(status: string | null) {
  return statusVariants[status ?? ""] ?? "secondary";
}
export function PortalStatus({ status }: { status: string | null }) {
  const { t } = useTranslation();
  return (
    <Badge variant={portalStatusVariant(status)}>
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
