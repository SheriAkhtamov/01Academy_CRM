import { useCallback, useEffect, useRef, useState } from "react";
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
export function StudentPortalAccessTab(props: StudentPortalAccessTabProps) {
  return <StudentPortalAccessSession
    key={`${props.studentId}:${props.staffAccountId ?? 0}:${props.enabled ?? true}:${props.canManageAccess}`}
    {...props}
  />;
}

function StudentPortalAccessSession({
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
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
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
  const errorStatus = (controls.query.error as { status?: number } | null)?.status;
  const unavailable = errorStatus === 401 || errorStatus === 403 || errorStatus === 404;
  useEffect(() => {
    if (!unavailable) return;
    setInviteOpen(false);
    setClassificationOpen(false);
    setEditing(null);
    setResetting(null);
    setRevoking(null);
    setStatusTarget(null);
    setDrafts({});
  }, [unavailable]);
  useEffect(() => {
    const currentData = controls.query.data;
    if (!currentData || controls.query.isError) return;
    const available = (target: PortalAccessLinkDto | null) => !target
      || currentData.links.some(link => link.id === target.id && link.status !== "revoked");
    if (!available(editing)) setEditing(null);
    if (!available(resetting)) setResetting(null);
    if (!available(revoking)) setRevoking(null);
    if (!available(statusTarget)) setStatusTarget(null);
  }, [controls.query.data, controls.query.isError, editing, resetting, revoking, statusTarget]);
  if (!enabled || !canManageAccess) return null;
  if (controls.query.isPending)
    return (
      <div role="status" aria-label={t("loading")} className="space-y-2.5">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  const queryError = controls.query.isError ? (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs">
        <p>{t("lmsStaffLoadFailed")}</p>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => void controls.query.refetch()}>
          {t("lmsStaffRetry")}
        </Button>
      </div>
    ) : null;
  if (unavailable || !controls.query.data) return queryError;
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
    if (!revoking || controls.revoke.isPending) return;
    try {
      await controls.revoke.mutateAsync(revoking.id);
      if (!active.current) return;
      setRevoking(null);
    } catch {
      /* The confirmation keeps the operation error visible. */
    }
  };
  const updateStatus = async () => {
    if (!statusTarget || controls.accountStatus.isPending) return;
    try {
      await controls.accountStatus.mutateAsync({
        accountId: statusTarget.account.id,
        status:
          statusTarget.account.status === "suspended" ? "active" : "suspended",
      });
      if (!active.current) return;
      setStatusTarget(null);
    } catch {
      /* The confirmation keeps the error visible. */
    }
  };
  return (
    <div className="space-y-3">
      {queryError}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("lmsStaffClassification")}:
          </span>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {t(classificationLabel[data.classification])}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            onClick={() => setClassificationOpen(true)}
          >
            <ShieldCheck className="size-3.5" data-icon="inline-start" />
            {t("lmsAccessConfirmIdentity")}
          </Button>
          <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-3.5" data-icon="inline-start" />
            {t("lmsStaffInvite")}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold">{t("lmsStaffAccess")}</h3>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
            {data.links.length}
          </Badge>
        </div>
      </div>

      {!data.links.length ? (
        <div className="rounded-lg border border-dashed py-5 text-center text-xs text-muted-foreground">
          {t("lmsStaffNoAccess")}
        </div>
      ) : (
        <div className="space-y-2">
          {data.links.map((link) => (
            <article key={link.id} className="space-y-2 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="break-words text-xs font-semibold leading-tight">
                      {link.account.fullName}
                    </p>
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                      {link.kind === "self"
                        ? t("lmsAccessExistingStudent")
                        : t(relationshipKeys[link.relationship ?? "other"])}
                    </Badge>
                  </div>
                  <p className="mt-0.5 break-all text-[11px] text-muted-foreground">
                    {link.account.login}
                  </p>
                </div>
                <Badge
                  variant={link.status === "active" ? "default" : "secondary"}
                  className="h-5 px-1.5 text-[10px]"
                >
                  {t(statusKeys[link.status])}
                </Badge>
              </div>
              {link.kind === "representative" && link.permissions.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {link.permissions.map((permission) => (
                    <Badge variant="outline" key={permission} className="h-5 px-1.5 text-[10px]">
                      {t(permissionLabels[permission])}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {link.invitation ? (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{t(invitationKeys[link.invitation.status])}</span>
                  <span>
                    {t("lmsAccessExpires")}: {date(link.invitation.expiresAt)}
                  </span>
                </div>
              ) : null}
              {link.status !== "revoked" ? (
                <div className="flex flex-wrap gap-1.5 border-t pt-2">
                  {link.kind === "representative" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setEditing(link)}
                    >
                      {t("lmsAccessEditPermissions")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setResetting(link)}
                  >
                    <KeyRound className="size-3.5" data-icon="inline-start" />
                    {t("lmsAccessReset")}
                  </Button>
                  {canSuspendAccounts ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
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
                    className="h-7 px-2 text-xs text-destructive"
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
        onDraftChange={permissionDraft}
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
