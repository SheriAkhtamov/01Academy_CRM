import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import type { PortalAccessLinkDto } from "@shared/contracts/portal-identity";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudentPortalAccess } from "./queries";
import { InviteDialog } from "./ui/InviteDialog";
import {
  AccessConfirmation,
  ClassificationDialog,
  PermissionEditDialog,
  StaffRecoveryDialog,
} from "./ui/AccessEditDialogs";
import { permissionLabels } from "./ui/PermissionChecklist";

const statusKeys: Record<PortalAccessLinkDto["status"], TranslationKey> = {
  pending: "lmsStaffPending",
  active: "lmsStaffActive",
  suspended: "lmsStaffSuspended",
  revoked: "lmsStaffRevoked",
};
const invitationKeys: Record<
  NonNullable<PortalAccessLinkDto["invitation"]>["status"],
  TranslationKey
> = {
  created: "lmsAccessInvitationCreated",
  sent: "lmsAccessInvitationSent",
  delivery_failed: "lmsAccessInvitationFailed",
  accepted: "lmsAccessInvitationAccepted",
  expired: "lmsAccessInvitationExpired",
  revoked: "lmsStaffRevoked",
};
const relationshipKeys = {
  parent: "lmsStaffParent",
  guardian: "lmsStaffGuardian",
  payer: "lmsStaffPayer",
  other: "lmsStaffOther",
} as const;
export type StudentPortalAccessTabProps = {
  studentId: number;
  studentName: string;
  staffAccountId?: number;
  canManageAccess: boolean;
  canSuspendAccounts?: boolean;
  enabled?: boolean;
  onDraftChange?: (dirty: boolean, pending: boolean) => void;
  initialInvitationKind?: "self" | "representative";
};
export function StudentPortalAccessTab({
  studentId,
  studentName,
  staffAccountId = 0,
  canManageAccess,
  canSuspendAccounts = false,
  enabled = true,
  onDraftChange,
  initialInvitationKind = "self",
}: StudentPortalAccessTabProps) {
  const { t, language } = useTranslation();
  const controls = useStudentPortalAccess(
    studentId,
    staffAccountId,
    enabled && canManageAccess,
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [classificationOpen, setClassificationOpen] = useState(false);
  const [editing, setEditing] = useState<PortalAccessLinkDto | null>(null);
  const [resetting, setResetting] = useState<PortalAccessLinkDto | null>(null);
  const [revoking, setRevoking] = useState<PortalAccessLinkDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<PortalAccessLinkDto | null>(
    null,
  );
  const [drafts, setDrafts] = useState<
    Record<string, { dirty: boolean; pending: boolean }>
  >({});
  const setDraft = useCallback(
    (name: string, dirty: boolean, pending: boolean) =>
      setDrafts((current) =>
        current[name]?.dirty === dirty && current[name]?.pending === pending
          ? current
          : { ...current, [name]: { dirty, pending } },
      ),
    [],
  );
  const inviteDraft = useCallback(
    (dirty: boolean, pending: boolean) => setDraft("invite", dirty, pending),
    [setDraft],
  );
  const classificationDraft = useCallback(
    (dirty: boolean, pending: boolean) =>
      setDraft("classification", dirty, pending),
    [setDraft],
  );
  const permissionDraft = useCallback(
    (dirty: boolean, pending: boolean) =>
      setDraft("permissions", dirty, pending),
    [setDraft],
  );
  const recoveryDraft = useCallback(
    (dirty: boolean, pending: boolean) => setDraft("recovery", dirty, pending),
    [setDraft],
  );
  useEffect(() => {
    onDraftChange?.(
      Object.values(drafts).some((draft) => draft.dirty),
      controls.revoke.isPending ||
        controls.accountStatus.isPending ||
        Object.values(drafts).some((draft) => draft.pending),
    );
    return () => onDraftChange?.(false, false);
  }, [
    drafts,
    controls.revoke.isPending,
    controls.accountStatus.isPending,
    onDraftChange,
  ]);
  if (!enabled || !canManageAccess) return null;
  if (controls.query.isPending)
    return (
      <div role="status" aria-label={t("loading")} className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  if (controls.query.isError)
    return (
      <div role="alert" className="space-y-3 rounded-lg border p-4">
        <p>{t("lmsStaffLoadFailed")}</p>
        <Button variant="outline" onClick={() => void controls.query.refetch()}>
          {t("lmsStaffRetry")}
        </Button>
      </div>
    );
  const data = controls.query.data;
  if (!data) return null;
  const classificationLabel = {
    adult: "lmsStaffAdult",
    minor: "lmsStaffMinor",
    unverified: "lmsStaffUnverified",
  } as const;
  const date = (value: string) =>
    new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
      dateStyle: "medium",
      timeZone: "Asia/Tashkent",
    }).format(new Date(value));
  const revoke = async () => {
    if (!revoking) return;
    try {
      await controls.revoke.mutateAsync(revoking.id);
      setRevoking(null);
    } catch {
      /* The confirmation keeps the operation error visible. */
    }
  };
  const updateStatus = async () => {
    if (!statusTarget) return;
    try {
      await controls.accountStatus.mutateAsync({
        accountId: statusTarget.account.id,
        status:
          statusTarget.account.status === "suspended" ? "active" : "suspended",
      });
      setStatusTarget(null);
    } catch {
      /* The confirmation keeps the error visible. */
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {t("lmsStaffClassification")}
          </p>
          <Badge variant="secondary">
            {t(classificationLabel[data.classification])}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setClassificationOpen(true)}
        >
          <ShieldCheck data-icon="inline-start" />
          {t("lmsAccessConfirmIdentity")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{t("lmsStaffAccess")}</h3>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus data-icon="inline-start" />
          {t("lmsStaffInvite")}
        </Button>
      </div>
      {!data.links.length ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("lmsStaffNoAccess")}
        </div>
      ) : (
        <div className="space-y-3">
          {data.links.map((link) => (
            <article key={link.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    {link.account.fullName}
                  </p>
                  <p className="break-all text-sm text-muted-foreground">
                    {link.account.login}
                  </p>
                </div>
                <Badge
                  variant={link.status === "active" ? "default" : "secondary"}
                >
                  {t(statusKeys[link.status])}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {link.kind === "self"
                  ? t("lmsAccessExistingStudent")
                  : t(relationshipKeys[link.relationship ?? "other"])}
              </p>
              {link.kind === "representative" ? (
                <div className="flex flex-wrap gap-1">
                  {link.permissions.map((permission) => (
                    <Badge variant="outline" key={permission}>
                      {t(permissionLabels[permission])}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {link.invitation ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{t(invitationKeys[link.invitation.status])}</span>
                  <span>
                    {t("lmsAccessExpires")}: {date(link.invitation.expiresAt)}
                  </span>
                </div>
              ) : null}
              {link.status !== "revoked" ? (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {link.kind === "representative" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(link)}
                    >
                      {t("lmsAccessEditPermissions")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setResetting(link)}
                  >
                    <KeyRound data-icon="inline-start" />
                    {t("lmsAccessReset")}
                  </Button>
                  {canSuspendAccounts ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        controls.accountStatus.reset();
                        setStatusTarget(link);
                      }}
                    >
                      {link.account.status === "suspended"
                        ? t("lmsAccessResume")
                        : t("lmsAccessSuspend")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => {
                      controls.revoke.reset();
                      setRevoking(link);
                    }}
                  >
                    {t("lmsStaffRevoke")}
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        studentName={studentName}
        classification={data.classification}
        controls={controls}
        onDraftChange={inviteDraft}
        initialKind={initialInvitationKind}
      />
      <ClassificationDialog
        open={classificationOpen}
        onOpenChange={setClassificationOpen}
        studentName={studentName}
        classification={data.classification}
        controls={controls}
        onDraftChange={classificationDraft}
      />
      <PermissionEditDialog
        open={Boolean(editing)}
        onOpenChange={(value) => {
          if (!value) setEditing(null);
        }}
        link={editing}
        classification={data.classification}
        controls={controls}
        onDraftChange={classificationDraft}
      />
      <StaffRecoveryDialog
        open={Boolean(resetting)}
        onOpenChange={(value) => {
          if (!value) setResetting(null);
        }}
        link={resetting}
        controls={controls}
        onDraftChange={recoveryDraft}
      />
      <AccessConfirmation
        open={Boolean(statusTarget)}
        onOpenChange={(value) => {
          if (!value) setStatusTarget(null);
        }}
        title={
          statusTarget?.account.status === "suspended"
            ? t("lmsAccessResumeTitle")
            : t("lmsAccessSuspendTitle")
        }
        description={`${statusTarget?.account.fullName ?? ""}. ${statusTarget?.account.status === "suspended" ? t("lmsAccessResumeBody") : t("lmsAccessSuspendBody")}`}
        action={
          statusTarget?.account.status === "suspended"
            ? t("lmsAccessResume")
            : t("lmsAccessSuspend")
        }
        onConfirm={() => void updateStatus()}
        pending={controls.accountStatus.isPending}
        error={
          controls.accountStatus.isError
            ? controls.accountStatus.error.message
            : undefined
        }
      />
      <AccessConfirmation
        open={Boolean(revoking)}
        onOpenChange={(value) => {
          if (!value) setRevoking(null);
        }}
        title={t("lmsStaffRevokeTitle")}
        description={`${revoking?.account.fullName ?? ""} · ${studentName}. ${t("lmsStaffRevokeBody")}`}
        action={t("lmsStaffRevoke")}
        onConfirm={() => void revoke()}
        pending={controls.revoke.isPending}
        error={
          controls.revoke.isError ? controls.revoke.error.message : undefined
        }
      />
    </div>
  );
}
