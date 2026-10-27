import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PortalPermission,
  PortalSessionDto,
} from "@shared/contracts/portal-identity";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ux/DataTable";
import { Badge } from "@/components/ui/badge";
import { DialogFooter } from "@/components/ui/dialog";
import { UserPhotoPicker } from "@/features/employees/UserPhotoPicker";
import { withUserPhoto } from "@/features/employees/user-photo-api";
import { getActivePlatformRealm } from "@/lib/platformSession";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { portalIdentityApi } from "../portal-app/api";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { PortalAlertDialogContent } from "../portal-app/modal-content";
import {
  usePortal,
  portalSessionKey,
  portalGrantFingerprint,
  usePortalFormScope,
  PortalFormScope,
} from "../portal-app/context";
import { PortalSelect } from "../portal-app/controls";
import { PortalNotificationPreferencesDialog } from "../portal-app/notifications";
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
export function PortalProfile({
  embedded = false,
  onClose,
}: {
  embedded?: boolean;
  onClose?: () => void;
}) {
  const { t, language, setLanguage } = useTranslation();
  const message = usePortalError();
  const { account, subject, allowed, acceptSession, setUnsaved } = usePortal();
  const passwordScope = usePortalFormScope();
  const client = useQueryClient();
  const mounted = useProfileFormMounted();
  const currentAccount = useRef(account?.id);
  currentAccount.current = account?.id;
  const [name, setName] = useState(account?.fullName ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [notificationPreferencesOpen, setNotificationPreferencesOpen] = useState(false);
  const subjectKey = `${account?.id}:${subject ? portalGrantFingerprint([subject]) : "family"}`;
  const dirty = name !== account?.fullName || language !== account?.locale || Boolean(photo);
  const isCurrentAccount = (accountId: number | undefined) =>
    mounted.current && accountId !== undefined && currentAccount.current === accountId &&
    getActivePlatformRealm() !== "staff" && getActivePlatformRealm() !== "signed-out" &&
    client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id === accountId;
  const save = useMutation({
    mutationFn: (submitted: {
      accountId: number | undefined;
      fullName: string;
      locale: "ru" | "en";
      photo: File | null;
    }) => {
      if (!isCurrentAccount(submitted.accountId)) throw new DOMException("", "AbortError");
      return portalIdentityApi.profile(withUserPhoto({ fullName: submitted.fullName, locale: submitted.locale }, submitted.photo));
    },
    onSuccess: (saved, submitted) => {
      if (!isCurrentAccount(submitted.accountId) || saved.id !== submitted.accountId) return;
      client.setQueryData<PortalSessionDto>(portalSessionKey, (current) =>
        current?.account?.id === saved.id
          ? { ...current, account: saved }
          : current,
      );
      if (
        client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id !==
        saved.id
      )
        return;
      setName((current) =>
        current === submitted.fullName ? saved.fullName : current,
      );
      setPhoto((current) => current === submitted.photo ? null : current);
    },
  });
  useEffect(() => {
    setUnsaved(dirty || save.isPending);
    return () => setUnsaved(false);
  }, [dirty, save.isPending, setUnsaved]);
  return (
    <>
      {!embedded && <PortalTitle labelKey="portalProfile" />}
      <div className="space-y-6">
        <Card className={embedded ? "border-0 bg-transparent shadow-none" : undefined}>
          {!embedded && (
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-base">{t("portalProfile")}</CardTitle>
            </CardHeader>
          )}
          <CardContent className={embedded ? "p-0" : "p-4"}>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!save.isPending) save.mutate({ accountId: account?.id, fullName: name, locale: language, photo });
              }}
            >
              <div className="md:col-span-2">
                <UserPhotoPicker
                  photo={photo}
                  onChange={setPhoto}
                  currentPhotoUrl={account?.avatarUrl}
                  fullName={name}
                  disabled={save.isPending}
                />
              </div>
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
                <p role="alert" className="text-destructive md:col-span-2">
                  {message(save.error, "portalSaveError")}
                </p>
              )}
              {save.isSuccess && !dirty && (
                <p role="status" className="text-muted-foreground md:col-span-2">
                  {t("portalSaved")}
                </p>
              )}
              <DialogFooter className="border-t border-border/70 pt-4 md:col-span-2">
                {onClose && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onClose}
                    disabled={save.isPending}
                  >
                    {t("portalCancel")}
                  </Button>
                )}
                <Button loading={save.isPending} disabled={save.isPending}>{t("portalSave")}</Button>
              </DialogFooter>
            </form>
          </CardContent>
        </Card>
        <Card className={embedded ? "border-0 bg-transparent shadow-none" : undefined}>
          <CardHeader className={embedded ? "p-0 pb-4" : "p-4 pb-0"}>
            <CardTitle className={embedded ? "text-sm" : "text-base"}>
              {t("portalAccessSettings")}
            </CardTitle>
          </CardHeader>
          <CardContent className={embedded ? "space-y-4 p-0" : "space-y-4 p-4"}>
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
              <Button variant="outline" onClick={() => setNotificationPreferencesOpen(true)}>
                {t("portalNotificationSettings")}
              </Button>
              {allowed("child_credentials.manage") &&
                subject?.kind === "representative" &&
                subject.studentClassification === "minor" && (
                  <ChildCredentialsDialog
                    key={subjectKey}
                    linkId={subject.linkId}
                    studentName={subject.studentName}
                  />
                )}
            </div>
          </CardContent>
        </Card>
      </div>
      <PortalSessions />
      <PortalNotificationPreferencesDialog
        open={notificationPreferencesOpen}
        onClose={() => setNotificationPreferencesOpen(false)}
      />
      {subject?.kind === "self" &&
        subject.studentClassification === "adult" && (
          <PortalRepresentatives key={subjectKey} />
        )}
      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          if (!open) passwordScope.guarded(() => setPasswordOpen(false));
        }}
      >
        <DialogContent className="portal-ui">
          <DialogHeader>
            <DialogTitle>{t("portalChangePassword")}</DialogTitle>
            <DialogDescription>{account?.fullName}</DialogDescription>
          </DialogHeader>
          <PortalFormScope id={passwordScope.id}>
            {passwordOpen && (
              <PasswordForm
                onClose={() => setPasswordOpen(false)}
                onSuccess={acceptSession}
              />
            )}
          </PortalFormScope>
        </DialogContent>
      </Dialog>
    </>
  );
}

function useProfileFormMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function ChildCredentialsDialog({
  linkId,
  studentName,
}: {
  linkId: number;
  studentName: string;
}) {
  const { t } = useTranslation();
  const scope = usePortalFormScope();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("portalChildCredentials")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) scope.guarded(() => setOpen(false));
        }}
      >
        <DialogContent className="portal-ui">
          <DialogHeader>
            <DialogTitle>{t("portalChildCredentials")}</DialogTitle>
            <DialogDescription>{studentName}</DialogDescription>
          </DialogHeader>
          <PortalFormScope id={scope.id}>
            {open && (
              <ChildCredentials
                linkId={linkId}
                studentName={studentName}
                onClose={() => setOpen(false)}
              />
            )}
          </PortalFormScope>
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
  const { account, setUnsaved } = usePortal();
  const client = useQueryClient();
  const mounted = useProfileFormMounted();
  const [accountId] = useState(account?.id);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: () => portalIdentityApi.password(current, password),
    onSuccess: (session) => {
      if (
        accountId === undefined ||
        session.account?.id !== accountId ||
        client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id !==
          accountId
      )
        return;
      setUnsaved(false);
      onSuccess(session);
      if (mounted.current) onClose();
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
      <fieldset disabled={action.isPending} className="min-w-0 space-y-4">
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
          <Button loading={action.isPending} disabled={action.isPending}>{t("portalSave")}</Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
function ChildCredentials({
  linkId,
  studentName,
  onClose,
}: {
  linkId: number;
  studentName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { setUnsaved } = usePortal();
  const mounted = useProfileFormMounted();
  const [current, setCurrent] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [validation, setValidation] = useState("");
  const [confirm, setConfirm] = useState(false);
  const action = useMutation({
    mutationFn: async () => {
      await portalIdentityApi.reauthenticate(current);
      if (!mounted.current) return;
      await portalIdentityApi.childCredentials(linkId, login, password);
    },
    onSuccess: () => {
      if (!mounted.current) return;
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
      <fieldset disabled={action.isPending} className="min-w-0 space-y-4">
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
          <Button loading={action.isPending} disabled={action.isPending}>{t("portalSave")}</Button>
        </DialogFooter>
        <ConfirmAction
          open={confirm}
          onOpenChange={setConfirm}
          titleKey="portalChildCredentialsConfirmTitle"
          description="portalChildCredentialsConfirmDescription"
          objectName={studentName}
          action="portalSave"
          pending={action.isPending}
          error={
            action.error ? message(action.error, "portalSaveError") : undefined
          }
          onConfirm={() => action.mutate()}
        />
      </fieldset>
    </form>
  );
}
function PortalSessions() {
  const { t } = useTranslation();
  const mounted = useProfileFormMounted();
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
      if (!mounted.current) return;
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
          <PortalLoading variant="section" />
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
  const mounted = useProfileFormMounted();
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
  const confirming = useRef(false);
  const action = useMutation({
    mutationFn: async () => {
      await portalIdentityApi.reauthenticate(password);
      if (!mounted.current) return;
      await portalIdentityApi.consent(
        selected!.linkId,
        selected!.permissions,
        selected!.status !== "active",
      );
    },
    onSuccess: () => {
      if (!mounted.current) return;
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
          <PortalLoading variant="section" />
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
        pending={action.isPending}
        onOpenChange={(open) => {
          if (!open && !action.isPending) {
            setSelected(null);
            setPassword("");
          }
        }}
      >
        <PortalAlertDialogContent className="portal-ui">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                selected?.status === "active"
                  ? "portalRevokeAccessTitle"
                  : "portalCurrentAccess",
              )}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (action.isPending || confirming.current || !selected) return;
              confirming.current = true;
              action.mutate(undefined, { onSettled: () => { confirming.current = false; } });
            }}
          >
            <fieldset disabled={action.isPending} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AlertDialogBody>
                <AlertDialogDescription>{selected?.fullName}</AlertDialogDescription>
                {selected?.status === "active" && <p>{t("portalRevokeAccessDescription")}</p>}
                <p className="text-sm">
                  {selected?.permissions.map((permission) => t(permissionKeys[permission])).join(" · ")}
                </p>
                <div className="space-y-2">
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
                </div>
              </AlertDialogBody>
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={action.isPending}>
                  {t("portalCancel")}
                </AlertDialogCancel>
                <Button loading={action.isPending}
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
            </fieldset>
          </form>
        </PortalAlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
