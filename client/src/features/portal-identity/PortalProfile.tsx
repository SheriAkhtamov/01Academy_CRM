import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ux/DataTable";
import { Badge } from "@/components/ui/badge";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { portalIdentityApi } from "../portal-app/api";
import {
  AlertDialog,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { PortalAlertDialogContent } from "../learning-content/modal-content";
import { usePortal } from "../portal-app/context";
import { PortalSelect } from "../portal-app/controls";
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
    setUnsaved(name !== account?.fullName || language !== account?.locale);
    return () => setUnsaved(false);
  }, [name, language, account?.fullName, account?.locale, setUnsaved]);
  const save = useMutation({
    mutationFn: () =>
      portalIdentityApi.profile({ fullName: name, locale: language }),
    onSuccess: refresh,
  });
  return (
    <>
      <PortalTitle labelKey="portalProfile" />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-base">{t("portalProfile")}</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-language">{t("portalLanguage")}</Label>
                <PortalSelect
                  id="profile-language"
                  value={language}
                  onValueChange={(value) => setLanguage(value as "ru" | "en")}
                  options={[
                    { value: "ru", label: t("portalLanguageRussian") },
                    { value: "en", label: t("portalLanguageEnglish") },
                  ]}
                />
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
              <DialogFooter className="border-t border-border/70 pt-4">
                <Button disabled={save.isPending}>{t("portalSave")}</Button>
              </DialogFooter>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-base">
              {t("portalAccessSettings")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
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
                <ul className="flex flex-wrap gap-2 text-sm">
                  {subject.permissions.map((permission) => (
                    <li key={permission}>
                      <Badge variant="secondary">
                        {t(permissionKeys[permission])}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPasswordOpen(true)}>
                {t("portalChangePassword")}
              </Button>
              {allowed("child_credentials.manage") &&
                subject?.kind === "representative" &&
                subject.studentClassification === "minor" && (
                  <Button variant="outline" onClick={() => setChild(true)}>
                    {t("portalChildCredentials")}
                  </Button>
                )}
            </div>
          </CardContent>
        </Card>
      </div>
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
          <DialogHeader>
            <DialogTitle>{t("portalChangePassword")}</DialogTitle>
            <DialogDescription>{account?.fullName}</DialogDescription>
          </DialogHeader>
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
          <DialogHeader>
            <DialogTitle>{t("portalChildCredentials")}</DialogTitle>
            <DialogDescription>{subject?.studentName}</DialogDescription>
          </DialogHeader>
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
          setValidation(t("portalPasswordLengthInvalid"));
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
        />
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
        />
      </div>
      {(validation || action.error) && (
        <p role="alert" className="text-destructive">
          {validation || message(action.error, "portalSaveError")}
        </p>
      )}
      <DialogFooter className="border-t border-border/70 pt-4">
        <Button disabled={action.isPending}>{t("portalSave")}</Button>
      </DialogFooter>
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
          setValidation(t("portalPasswordLengthInvalid"));
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
        />
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
        />
      </div>
      {(validation || action.error) && (
        <p role="alert" className="text-destructive">
          {validation || message(action.error, "portalSaveError")}
        </p>
      )}
      <DialogFooter className="border-t border-border/70 pt-4">
        <Button disabled={action.isPending}>{t("portalSave")}</Button>
      </DialogFooter>
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
      <CardHeader className="p-4">
        <CardTitle className="text-base">{t("portalSessions")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
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
          <DataTable
            data={query.data}
            keyExtractor={(item) => item.id}
            pageSize={0}
            showPagination={false}
            columns={[
              {
                key: "createdAt",
                header: t("portalDate"),
                mobilePrimary: true,
                render: (item) =>
                  item.current ? (
                    <Badge variant="secondary">
                      {t("portalCurrentSession")}
                    </Badge>
                  ) : (
                    format.date(item.createdAt)
                  ),
              },
              {
                key: "lastSeenAt",
                header: t("portalLastActivity"),
                render: (item) =>
                  `${format.date(item.lastSeenAt)} · ${format.time(item.lastSeenAt)}`,
              },
              {
                key: "actions",
                header: "",
                render: (item) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevoke(item.id)}
                  >
                    {t("portalRevokeSession")}
                  </Button>
                ),
              },
            ]}
          />
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
      <CardHeader className="p-4">
        <CardTitle className="text-base">
          {t("portalRepresentatives")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
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
          <DataTable
            data={query.data}
            keyExtractor={(item) => String(item.linkId)}
            pageSize={0}
            showPagination={false}
            columns={[
              {
                key: "fullName",
                header: t("portalFullName"),
                mobilePrimary: true,
                cellClassName: "font-medium",
              },
              {
                key: "permissions",
                header: t("lmsStaffPermissions"),
                render: (item) => (
                  <div className="flex flex-wrap gap-1.5">
                    {item.permissions.map((permission) => (
                      <Badge key={permission} variant="secondary">
                        {t(permissionKeys[permission])}
                      </Badge>
                    ))}
                  </div>
                ),
              },
              {
                key: "actions",
                header: "",
                render: (item) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPassword("");
                      action.reset();
                      setSelected(item);
                    }}
                  >
                    {t(
                      item.status === "active"
                        ? "lmsStaffRevoke"
                        : "portalApprove",
                    )}
                  </Button>
                ),
              },
            ]}
          />
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
            />
            {action.error && (
              <p role="alert" className="text-destructive">
                {message(action.error, "portalSaveError")}
              </p>
            )}
            <AlertDialogFooter className="border-t border-border/70 pt-4">
              <AlertDialogCancel type="button" disabled={action.isPending}>
                {t("portalCancel")}
              </AlertDialogCancel>
              <Button
                variant={
                  selected?.status === "active" ? "destructive" : "default"
                }
                disabled={action.isPending}
              >
                {t(
                  selected?.status === "active"
                    ? "lmsStaffRevoke"
                    : "portalApprove",
                )}
              </Button>
            </AlertDialogFooter>
          </form>
        </PortalAlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
