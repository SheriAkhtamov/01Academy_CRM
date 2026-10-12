import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Logo from "@/components/Logo";
import { portalIdentityApi } from "../portal-app/api";
import { usePortal } from "../portal-app/context";
import { usePortalError } from "../portal-app/ui";

export function PortalLanguage() {
  const { t, language, setLanguage } = useTranslation();
  return (
    <select
      className="h-11 rounded-md border bg-background px-3 text-sm"
      aria-label={t("portalLanguage")}
      value={language}
      onChange={(event) => setLanguage(event.target.value as "ru" | "en")}
    >
      <option value="ru">{t("portalLanguageRussian")}</option>
      <option value="en">{t("portalLanguageEnglish")}</option>
    </select>
  );
}
export function PortalRecoveryHelp() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  return <main className="portal-ui flex min-h-dvh items-center justify-center bg-muted/30 p-4">
    <Card className="w-full max-w-[420px]"><CardHeader><Logo size="md" /><CardTitle>{t('portalRecovery')}</CardTitle></CardHeader>
      <CardContent className="space-y-5"><p>{t('portalRecoveryContactSchool')}</p><Button className="min-h-11 w-full" onClick={() => navigate('/login')}>{t('portalLogin')}</Button></CardContent>
    </Card>
  </main>;
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
        setValidation(t("portalPasswordRules"));
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
  const heading = "portalInvite";
  const button = "portalActivate";
  return (
    <main className="portal-ui flex min-h-dvh flex-col items-center justify-center bg-muted/30 p-4">
      <div className="mb-6 flex w-full max-w-[420px] items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo size="md" />
          <span className="text-lg font-semibold">
            {t("publicAttendanceBrand")}
          </span>
        </div>
        <PortalLanguage />
      </div>
      <Card className="w-full max-w-[420px]">
        <CardHeader>
          <CardTitle>{t(heading)}</CardTitle>
        </CardHeader>
        <CardContent>
          {(
            <form className="space-y-5" onSubmit={submit}>
              {mode === "invite" && !account && (
                <div className="space-y-2">
                  <Label htmlFor="portal-name">{t("portalFullName")}</Label>
                  <Input
                    id="portal-name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="min-h-11"
                  />
                </div>
              )}
              {!(mode === "invite" && account) && (
                <div className="space-y-2">
                  <Label htmlFor="portal-password">
                    {t(
                      "portalNewPassword",
                    )}
                  </Label>
                  <Input
                    id="portal-password"
                    type="password"
                    autoComplete={
                      "new-password"
                    }
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-h-11"
                  />
                  {mode === "invite" && (
                    <p className="text-sm text-muted-foreground">
                      {t("portalPasswordRules")}
                    </p>
                  )}
                </div>
              )}
              {(mode === "invite" && !account) && (
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
                    className="min-h-11"
                  />
                </div>
              )}
              {account && mode === "invite" && <p>{account.fullName}</p>}
              {(validation || action.error) && (
                <p role="alert" className="text-sm text-destructive">
                  {validation || message(action.error, "portalSaveError")}
                </p>
              )}
              <Button
                type="submit"
                disabled={action.isPending || !session?.csrfToken}
                className="min-h-11 w-full"
              >
                {t(button)}
              </Button>
              {mode === "invite" && (
                <Button
                  type="button"
                  variant="link"
                  className="min-h-11 w-full"
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
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
