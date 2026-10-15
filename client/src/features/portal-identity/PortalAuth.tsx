import { useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Logo from "@/components/Logo";
import { portalIdentityApi } from "../portal-app/api";
import { usePortal } from "../portal-app/context";
import { usePortalError } from "../portal-app/ui";

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
  mode = "invite",
  token,
}: {
  mode?: "invite";
  token?: string;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { acceptSession, account, session } = usePortal();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [name, setName] = useState("");
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: async () => {
      if (mode === "invite") {
        const session = await portalIdentityApi.activate(
          token ?? "",
          account ? undefined : password,
          account ? undefined : name,
        );
        acceptSession(session);
        navigate("/learn");
      }
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    if (mode === "invite" && !account) {
      if (
        password.length < 12 ||
        new TextEncoder().encode(password).length > 72
      ) {
        setValidation(t("portalPasswordLengthInvalid"));
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
    <PortalAuthFrame titleKey="portalInvite">
      <form className="space-y-5" onSubmit={submit}>
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
              <Label htmlFor="portal-password">{t("portalNewPassword")}</Label>
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
              <Label htmlFor="portal-repeat">{t("portalConfirmPassword")}</Label>
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
        <div className="space-y-2">
          <Button
            type="submit"
            disabled={action.isPending || !session?.csrfToken}
            className="w-full"
          >
            {t("portalActivate")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() =>
              navigate(
                token
                  ? `/login?next=${encodeURIComponent(`/learn/invite#token=${encodeURIComponent(token)}`)}`
                  : "/login",
              )
            }
          >
            {t("portalLogin")}
          </Button>
        </div>
      </form>
    </PortalAuthFrame>
  );
}
