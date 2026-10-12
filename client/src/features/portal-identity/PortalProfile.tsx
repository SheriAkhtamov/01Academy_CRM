import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalIdentityApi } from "../portal-app/api";
import {
  AlertDialog,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { PortalAlertDialogContent } from "../learning-content/modal-content";
import { usePortal } from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  ConfirmAction,
  usePortalError,
  usePortalFormat,
} from "../portal-app/ui";

const permissionKeys: Record<PortalPermission, TranslationKey> = {
  "learning.read": "lmsStaffPermissionLearning",
  "attendance.read": "lmsStaffPermissionAttendance",
  "feedback.read": "lmsStaffPermissionFeedback",
  "finance.read": "lmsStaffPermissionFinance",
  "communication.create": "lmsStaffPermissionCommunication",
  "portfolio.approve": "lmsStaffPermissionPortfolio",
  "child_credentials.manage": "lmsStaffPermissionCredentials",
  "assignments.submit": "portalSubmit",
  "quizzes.attempt": "portalStartTest",
  "portfolio.edit": "portalEditProject",
};
export function PortalProfile() {
  const { t, language, setLanguage } = useTranslation();
  const message = usePortalError();
  const {
    account,
    subject,
    allowed,
    acceptSession,
    refresh,
    guarded,
    setUnsaved,
  } = usePortal();
  const [name, setName] = useState(account?.fullName ?? "");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [child, setChild] = useState(false);
  useEffect(() => {
    setUnsaved(
      name !== account?.fullName ||
        language !== account?.locale,
    );
    return () => setUnsaved(false);
  }, [
    name,
    language,
    account?.fullName,
    account?.locale,
    setUnsaved,
  ]);
  const save = useMutation({
    mutationFn: () =>
      portalIdentityApi.profile({ fullName: name, locale: language }),
    onSuccess: refresh,
  });
  return (
    <>
      <PortalTitle labelKey="portalProfile" />
      <Card>
        <CardContent className="space-y-5 p-6">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="profile-name">{t("portalFullName")}</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="min-h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-language">{t("portalLanguage")}</Label>
              <select
                id="profile-language"
                className="min-h-11 w-full rounded-md border bg-background px-3"
                value={language}
                onChange={(event) =>
                  setLanguage(event.target.value as "ru" | "en")
                }
              >
                <option value="ru">{t("portalLanguageRussian")}</option>
                <option value="en">{t("portalLanguageEnglish")}</option>
              </select>
            </div>
            {save.error && (
              <p role="alert" className="text-destructive">
                {message(save.error, "portalSaveError")}
              </p>
            )}
            {save.isSuccess && (
              <p role="status" className="text-muted-foreground">
                {t("portalSaved")}
              </p>
            )}
            <Button className="min-h-11" disabled={save.isPending}>
              {t("portalSave")}
            </Button>
          </form>

        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("portalAccessSettings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {subject?.kind === "representative" && (
            <div className="space-y-3">
              <p className="font-medium">{subject.studentName}</p>
              <p>
                {t(
                  subject.relationship === "guardian"
                    ? "portalGuardian"
                    : subject.relationship === "payer"
                      ? "portalPayer"
                      : subject.relationship === "parent"
                        ? "portalParent"
                        : "portalOther",
                )}
              </p>
              <ul className="space-y-1 text-sm">
                {subject.permissions.map((permission) => (
                  <li key={permission}>{t(permissionKeys[permission])}</li>
                ))}
              </ul>
            </div>
          )}
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setPasswordOpen(true)}
          >
            {t("portalChangePassword")}
          </Button>
          {allowed("child_credentials.manage") &&
            subject?.kind === "representative" &&
            subject.studentClassification === "minor" && (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => setChild(true)}
              >
                {t("portalChildCredentials")}
              </Button>
            )}
        </CardContent>
      </Card>
      <PortalSessions />
      {subject?.kind === "self" &&
        subject.studentClassification === "adult" && <PortalRepresentatives />}
      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          if (!open) guarded(() => setPasswordOpen(false));
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{t("portalChangePassword")}</DialogTitle>
          <DialogDescription>{account?.fullName}</DialogDescription>
          {passwordOpen && (
            <PasswordForm
              onClose={() => setPasswordOpen(false)}
              onSuccess={acceptSession}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={child}
        onOpenChange={(open) => {
          if (!open) guarded(() => setChild(false));
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{t("portalChildCredentials")}</DialogTitle>
          <DialogDescription>{subject?.studentName}</DialogDescription>
          {child && <ChildCredentials onClose={() => setChild(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
function PasswordForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: ReturnType<typeof usePortal>["acceptSession"];
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { setUnsaved } = usePortal();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: () => portalIdentityApi.password(current, password),
    onSuccess: (session) => {
      setUnsaved(false);
      onSuccess(session);
      onClose();
    },
  });
  useEffect(() => {
    setUnsaved(Boolean(current || password || repeat));
    return () => setUnsaved(false);
  }, [current, password, repeat, setUnsaved]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setValidation("");
        if (password.length < 12) {
          setValidation(t("portalPasswordRules"));
          return;
        }
        if (password !== repeat) {
          setValidation(t("portalPasswordMismatch"));
          return;
        }
        action.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="current-password">{t("portalCurrentPassword")}</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          required
          className="min-h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">{t("portalNewPassword")}</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="min-h-11"
        />
        <p className="text-sm text-muted-foreground">
          {t("portalPasswordRules")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="repeat-password">{t("portalConfirmPassword")}</Label>
        <Input
          id="repeat-password"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          required
          className="min-h-11"
        />
      </div>
      {(validation || action.error) && (
        <p role="alert" className="text-destructive">
          {validation || message(action.error, "portalSaveError")}
        </p>
      )}
      <Button className="min-h-11" disabled={action.isPending}>
        {t("portalSave")}
      </Button>
    </form>
  );
}
function ChildCredentials({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { subject, setUnsaved } = usePortal();
  const [current, setCurrent] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [validation, setValidation] = useState("");
  const [confirm, setConfirm] = useState(false);
  const action = useMutation({
    mutationFn: async () => {
      await portalIdentityApi.reauthenticate(current);
      await portalIdentityApi.childCredentials(
        subject!.linkId,
        login,
        password,
      );
    },
    onSuccess: () => {
      setUnsaved(false);
      onClose();
    },
  });
  useEffect(() => {
    setUnsaved(Boolean(current || login || password));
    return () => setUnsaved(false);
  }, [current, login, password, setUnsaved]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setValidation("");
        if (!/^[a-z0-9._-]{4,32}$/.test(login)) {
          setValidation(t("portalInvalidChildLogin"));
          return;
        }
        if (password.length < 12) {
          setValidation(t("portalPasswordRules"));
          return;
        }
        setConfirm(true);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="child-login">{t("portalChildLogin")}</Label>
        <Input
          id="child-login"
          autoComplete="off"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          required
          className="min-h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="child-password">{t("portalNewPassword")}</Label>
        <Input
          id="child-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="min-h-11"
        />
        <p className="text-sm text-muted-foreground">
          {t("portalPasswordRules")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="parent-password">{t("portalVerifyPassword")}</Label>
        <Input
          id="parent-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          required
          className="min-h-11"
        />
      </div>
      {(validation || action.error) && (
        <p role="alert" className="text-destructive">
          {validation || message(action.error, "portalSaveError")}
        </p>
      )}
      <Button className="min-h-11" disabled={action.isPending}>
        {t("portalSave")}
      </Button>
      <ConfirmAction
        open={confirm}
        onOpenChange={setConfirm}
        titleKey="portalChildCredentialsConfirmTitle"
        description="portalChildCredentialsConfirmDescription"
        objectName={subject?.studentName}
        action="portalSave"
        pending={action.isPending}
        error={
          action.error ? message(action.error, "portalSaveError") : undefined
        }
        onConfirm={() => action.mutate()}
      />
    </form>
  );
}
function PortalSessions() {
  const { t } = useTranslation();
  const message = usePortalError();
  const format = usePortalFormat();
  const { account, refresh } = usePortal();
  const [revoke, setRevoke] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["portal-account", account?.id, "sessions"],
    queryFn: ({ signal }) => portalIdentityApi.sessions(signal),
    enabled: Boolean(account),
  });
  const action = useMutation({
    mutationFn: () => portalIdentityApi.revokeSession(revoke!),
    onSuccess: () => {
      setRevoke(null);
      void query.refetch();
      refresh();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("portalSessions")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending ? (
          <PortalLoading />
        ) : query.error ? (
          <PortalError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : (
          query.data.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div>
                <p>
                  {item.current
                    ? t("portalCurrentSession")
                    : format.date(item.createdAt)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {format.date(item.lastSeenAt)} ·{" "}
                  {format.time(item.lastSeenAt)}
                </p>
              </div>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => setRevoke(item.id)}
              >
                {t("portalRevokeSession")}
              </Button>
            </div>
          ))
        )}
        <ConfirmAction
          open={Boolean(revoke)}
          onOpenChange={(open) => {
            if (!open) setRevoke(null);
          }}
          titleKey="portalRevokeSessionTitle"
          objectName={
            query.data?.find((item) => item.id === revoke)?.current
              ? t("portalCurrentSession")
              : query.data?.find((item) => item.id === revoke)?.createdAt
                ? format.date(
                    query.data.find((item) => item.id === revoke)!.createdAt,
                  )
                : undefined
          }
          description="portalRevokeSessionDescription"
          action="portalRevokeSession"
          pending={action.isPending}
          error={
            action.error ? message(action.error, "portalSaveError") : undefined
          }
          onConfirm={() => action.mutate()}
        />
      </CardContent>
    </Card>
  );
}
function PortalRepresentatives() {
  const { t } = useTranslation();
  const message = usePortalError();
  const { account } = usePortal();
  const query = useQuery({
    queryKey: ["portal-account", account?.id, "representatives"],
    queryFn: ({ signal }) => portalIdentityApi.representatives(signal),
  });
  const [selected, setSelected] = useState<{
    linkId: number;
    fullName: string;
    permissions: PortalPermission[];
    status: string;
  } | null>(null);
  const [password, setPassword] = useState("");
  const action = useMutation({
    mutationFn: async () => {
      await portalIdentityApi.reauthenticate(password);
      await portalIdentityApi.consent(
        selected!.linkId,
        selected!.permissions,
        selected!.status !== "active",
      );
    },
    onSuccess: () => {
      setSelected(null);
      setPassword("");
      void query.refetch();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("portalRepresentatives")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending ? (
          <PortalLoading />
        ) : query.error ? (
          <PortalError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : (
          query.data.map((item) => (
            <div key={item.linkId} className="space-y-3 rounded-md border p-4">
              <p className="font-medium">{item.fullName}</p>
              <p className="text-sm text-muted-foreground">
                {item.permissions
                  .map((permission) => t(permissionKeys[permission]))
                  .join(" · ")}
              </p>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setPassword("");
                  action.reset();
                  setSelected(item);
                }}
              >
                {t(
                  item.status === "active" ? "lmsStaffRevoke" : "portalApprove",
                )}
              </Button>
            </div>
          ))
        )}
      </CardContent>
      <AlertDialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !action.isPending) {
            setSelected(null);
            setPassword("");
          }
        }}
      >
        <PortalAlertDialogContent className="portal-ui">
          <AlertDialogTitle>
            {t(
              selected?.status === "active"
                ? "portalRevokeAccessTitle"
                : "portalCurrentAccess",
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>{selected?.fullName}</AlertDialogDescription>
          {selected?.status === "active" && (
            <p>{t("portalRevokeAccessDescription")}</p>
          )}
          <p className="text-sm">
            {selected?.permissions
              .map((permission) => t(permissionKeys[permission]))
              .join(" · ")}
          </p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              action.mutate();
            }}
          >
            <Label htmlFor="consent-password">
              {t("portalVerifyPassword")}
            </Label>
            <Input
              id="consent-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="min-h-11"
            />
            {action.error && (
              <p role="alert" className="text-destructive">
                {message(action.error, "portalSaveError")}
              </p>
            )}
            <AlertDialogCancel
              type="button"
              className="min-h-11"
              disabled={action.isPending}
            >
              {t("portalCancel")}
            </AlertDialogCancel>
            <Button className="min-h-11" disabled={action.isPending}>
              {t(
                selected?.status === "active"
                  ? "lmsStaffRevoke"
                  : "portalApprove",
              )}
            </Button>
          </form>
        </PortalAlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
