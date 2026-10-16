import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  learningModuleBase,
  learningModuleForSubject,
  learningSubjectHref,
} from "@shared/platform-routes";
import { setActivePlatformRealm } from "@/lib/platformSession";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Logo from "@/components/Logo";
import { portalIdentityApi } from "../portal-app/api";
import {
  PortalFormScope,
  usePortalFormScope,
  usePortal,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  usePortalError,
} from "../portal-app/ui";
import { allowNavigation } from "@/lib/navigationGuard";

function PortalAuthFrame({
  titleKey,
  children,
}: {
  titleKey: TranslationKey;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <main className="portal-ui login-page">
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher />
      </div>
      <section className="login-card">
        <header className="login-card__header">
          <Logo size="lg" className="mx-auto mb-5" />
          <div className="login-card__title">{t("platformName")}</div>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">
            {t(titleKey)}
          </h1>
        </header>
        {children}
      </section>
    </main>
  );
}

export function PortalRecoveryHelp() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  return (
    <PortalAuthFrame titleKey="portalRecovery">
      <div className="space-y-5">
        <p className="text-center text-sm">{t("portalRecoveryUnavailable")}</p>
        <Button className="w-full" onClick={() => navigate("/login")}>
          {t("portalLogin")}
        </Button>
      </div>
    </PortalAuthFrame>
  );
}

export function PortalAuth({
  token,
}: {
  mode?: "invite";
  token?: string;
}) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const scope = usePortalFormScope();
  const { account } = usePortal();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const close = () => {
    if (!pending) scope.guarded(() => setOpen(false));
  };
  const login = () =>
    navigate(
      token
        ? `/login?next=${encodeURIComponent(`/activate#token=${encodeURIComponent(token)}`)}`
        : "/login",
    );
  return (
    <PortalAuthFrame titleKey="portalInvite">
      <div className="space-y-3">
        <Button ref={trigger} className="w-full" onClick={() => setOpen(true)}>
          {t("portalActivate")}
        </Button>
        <Button variant="ghost" className="w-full" onClick={login}>
          {t("portalLogin")}
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else close();
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (!trigger.current?.isConnected) return;
            event.preventDefault();
            trigger.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("portalActivate")}</DialogTitle>
          </DialogHeader>
          <PortalFormScope id={scope.id}>
            {open && (
              <PortalActivationForm
                key={`${token ?? ""}:${account?.id ?? "anonymous"}`}
                token={token}
                onClose={close}
                onPendingChange={setPending}
              />
            )}
          </PortalFormScope>
        </DialogContent>
      </Dialog>
    </PortalAuthFrame>
  );
}

function PortalActivationForm({
  token,
  onClose,
  onPendingChange,
}: {
  token?: string;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { acceptSession, account, session, setUnsaved, guarded } = usePortal();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [name, setName] = useState("");
  const [validation, setValidation] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const action = useMutation({
    mutationFn: () =>
      portalIdentityApi.activate(
        token ?? "",
        account ? undefined : password,
        account ? undefined : name,
      ),
    onSuccess: (activated) => {
      if (!mounted.current) return;
      setUnsaved(false);
      acceptSession(activated);
      setActivePlatformRealm("portal");
      const target = activated.activatedLink;
      if (target) {
        allowNavigation(() =>
          navigate(learningSubjectHref("/learn", target)),
        );
        return;
      }
      const own = activated.subjects.find((item) => item.kind === "self");
      const module = learningModuleForSubject(own ?? activated.subjects[0]);
      allowNavigation(() => navigate(learningModuleBase(module)));
    },
  });
  useEffect(() => {
    setUnsaved(Boolean(name || password || repeat || action.isPending));
    return () => setUnsaved(false);
  }, [name, password, repeat, action.isPending, setUnsaved]);
  useEffect(() => {
    onPendingChange(action.isPending);
    return () => onPendingChange(false);
  }, [action.isPending, onPendingChange]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    if (!account) {
      if (password.length < 12) {
        setValidation(t("portalPasswordLengthInvalid"));
        document.getElementById("portal-password")?.focus();
        return;
      }
      if (new TextEncoder().encode(password).length > 72) {
        setValidation(t("portalPasswordTooLong"));
        document.getElementById("portal-password")?.focus();
        return;
      }
      if (password !== repeat) {
        setValidation(t("portalPasswordMismatch"));
        document.getElementById("portal-repeat")?.focus();
        return;
      }
    }
    action.mutate();
  }
  return (
    <form className="space-y-5" onSubmit={submit}>
      <fieldset disabled={action.isPending} className="min-w-0 space-y-5">
        {!account && (
          <>
            <div className="space-y-2">
              <Label htmlFor="portal-name">{t("portalFullName")}</Label>
              <Input
                id="portal-name"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-password">
                {t("portalNewPassword")}
              </Label>
              <Input
                id="portal-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-repeat">
                {t("portalConfirmPassword")}
              </Label>
              <Input
                id="portal-repeat"
                type="password"
                autoComplete="new-password"
                required
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
              />
            </div>
          </>
        )}
        {account && <p className="text-sm font-medium">{account.fullName}</p>}
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(action.error, "portalSaveError")}
          </p>
        )}
        <DialogFooter className="flex-wrap gap-2 border-t border-border/70 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              guarded(() =>
                navigate(
                  token
                    ? `/login?next=${encodeURIComponent(`/activate#token=${encodeURIComponent(token)}`)}`
                    : "/login",
                ),
              )
            }
          >
            {t("portalLogin")}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("portalCancel")}
          </Button>
          <Button
            type="submit"
            disabled={action.isPending || !session?.csrfToken}
          >
            {t("portalActivate")}
          </Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
