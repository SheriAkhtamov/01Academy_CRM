import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, UserRound, UsersRound } from "lucide-react";
import { z } from "zod";
import {
  portalInvitationCreateSchema,
  portalLoginSchema,
  type PortalClassification,
  type PortalInvitationCreateCommand,
  type PortalInvitationResultDto,
  type PortalPermission,
} from "@shared/contracts/portal-identity";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from "@/components/ux/UnsavedChangesGuard";
import type { StudentPortalAccessControls } from "../queries";
import type { ExistingPortalAccount } from "../api";
import { PermissionChecklist, permissionLabels } from "./PermissionChecklist";
import type { PortalContactMatches, PortalContactMatch } from "@shared/contracts/portal-contact-checks";

export function InviteDialog({
  open,
  onOpenChange,
  studentName,
  classification,
  controls,
  onDraftChange,
  initialKind = "self",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentName: string;
  classification: PortalClassification;
  controls: StudentPortalAccessControls;
  onDraftChange?: (dirty: boolean, pending: boolean) => void;
  initialKind?: "self" | "representative";
}) {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<"self" | "representative">("self");
  const [accountMode, setAccountMode] = useState<"new" | "existing">("new");
  const [login, setLogin] = useState("");
  const [fullName, setFullName] = useState(studentName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<ExistingPortalAccount | null>(null);
  const [lookupDone, setLookupDone] = useState(false);
  const [contactMatches, setContactMatches] = useState<(PortalContactMatches & { fingerprint: string }) | null>(null);
  const [separateAccountConfirmed, setSeparateAccountConfirmed] = useState(false);
  const contactFingerprint = JSON.stringify([email.trim().toLowerCase(), phone.replace(/\D/g, "")]);
  const contactFingerprintRef = useRef(contactFingerprint);
  contactFingerprintRef.current = contactFingerprint;
  const loginRef = useRef(login);
  loginRef.current = login;
  const currentMatches = contactMatches?.fingerprint === contactFingerprint ? contactMatches : null;
  const hasMatches = Boolean(currentMatches && (currentMatches.items.length || currentMatches.additionalMatches));
  const [relationship, setRelationship] = useState<
    "parent" | "guardian" | "payer" | "other"
  >("parent");
  const [permissions, setPermissions] = useState<PortalPermission[]>([
    "learning.read",
    "attendance.read",
    "feedback.read",
    "communication.create",
  ]);
  const [method, setMethod] = useState("");
  const [basis, setBasis] = useState("");
  const [consent, setConsent] = useState(false);
  const channel = "manual";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PortalInvitationResultDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const dirty =
    !result &&
    Boolean(
      step ||
      login ||
      fullName !== (initialKind === "self" ? studentName : "") ||
      email ||
      phone ||
      method ||
      basis,
    );
  const pending = controls.invitation.isPending || controls.lookup.isPending || controls.checkContacts.isPending;
  const guard = useUnsavedChangesGuard({
    open,
    isDirty: dirty,
    isPending: pending,
    onOpenChange,
  });
  const resetInvitation = controls.invitation.reset;
  const resetLookup = controls.lookup.reset;
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setKind(initialKind);
    setAccountMode("new");
    setLogin("");
    setFullName(initialKind === "self" ? studentName : "");
    setEmail("");
    setPhone("");
    setFound(null);
    setLookupDone(false);
    setContactMatches(null);
    setSeparateAccountConfirmed(false);
    setMethod("");
    setBasis("");
    setConsent(false);
    setErrors({});
    setResult(null);
    setCopied(false);
    setIdempotencyKey(crypto.randomUUID());
    resetInvitation();
    resetLookup();
  }, [open, studentName, initialKind, resetInvitation, resetLookup]);
  useEffect(() => {
    onDraftChange?.(open && dirty, open && pending);
    return () => onDraftChange?.(false, false);
  }, [open, dirty, pending, onDraftChange]);
  const focusError = (values: Record<string, string>) => {
    setErrors(values);
    requestAnimationFrame(() =>
      document
        .getElementById(`portal-invite-${Object.keys(values)[0]}`)
        ?.focus(),
    );
  };
  const validation = () => {
    const next: Record<string, string> = {};
    if (
      step === 0 &&
      kind === "representative" &&
      classification === "unverified"
    )
      next.kind = t("lmsAccessVerificationRequired");
    if (step === 1) {
      if (accountMode === "new") {
        if (!portalLoginSchema.safeParse(login).success)
          next.login = t("lmsAccessInvalidLogin");
        if (!fullName.trim()) next.fullName = t("lmsAccessFieldRequired");
        if (email && !z.string().email().safeParse(email.trim()).success)
          next.email = t("lmsAccessInvalidEmail");
      } else if (!found) next.login = t("lmsAccessAccountMissing");
    }
    if (step === 2) {
      if (method.trim().length < 3) next.method = t("lmsAccessFieldRequired");
      if (basis.trim().length < 3) next.basis = t("lmsAccessFieldRequired");
      if (kind === "representative" && !permissions.length)
        next.permissions = t("lmsAccessChoosePermissions");
    }
    return next;
  };
  const checkContacts = async (advance: boolean) => {
    const fingerprint = contactFingerprint;
    setErrors({});
    try {
      const matches = await controls.checkContacts.mutateAsync({ email: email.trim().toLowerCase() || null, phone: phone.trim() || null });
      if (contactFingerprintRef.current !== fingerprint) { setErrors({ contacts: t("lmsAccessContactsChanged") }); return; }
      setContactMatches({ ...matches, fingerprint });
      setSeparateAccountConfirmed(false);
      if (advance && !matches.items.length && !matches.additionalMatches) setStep((current) => current + 1);
    } catch { setErrors({ contacts: t("lmsAccessContactCheckFailed") }); }
  };
  const chooseContactAccount = (account: PortalContactMatch) => {
    if (!account.canUse) return;
    setAccountMode("existing");
    setLogin(account.login);
    setFound({ id: account.id, login: account.login, fullName: account.fullName, status: account.status });
    setLookupDone(true);
    setErrors({});
  };
  const next = async () => {
    const issues = validation();
    if (Object.keys(issues).length) {
      focusError(issues);
      return;
    }
    setErrors({});
    if (step === 1 && accountMode === "new" && (email.trim() || phone.trim())) {
      if (!currentMatches) { await checkContacts(true); return; }
      if (hasMatches && !separateAccountConfirmed) { setErrors({ contacts: t("lmsAccessContactCheckRequired") }); return; }
    }
    setStep((current) => current + 1);
  };
  const lookup = async () => {
    const identifier = login.trim().toLowerCase();
    setErrors({});
    setFound(null);
    setLookupDone(false);
    try {
      const account = await controls.lookup.mutateAsync(
        identifier,
      );
      if (loginRef.current.trim().toLowerCase() !== identifier) return;
      setFound(account);
      setLookupDone(true);
    } catch {
      setErrors({ login: t("lmsStaffLoadFailed") });
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step < 3) {
      await next();
      return;
    }
    const issues = validation();
    if (Object.keys(issues).length) {
      focusError(issues);
      return;
    }
    const raw = {
      accountId: accountMode === "existing" ? found?.id : undefined,
      account:
        accountMode === "new"
          ? {
              login,
              fullName,
              email: email.trim() || null,
              phone: phone.trim() || null,
              locale: language,
            }
          : undefined,
      kind,
      relationship: kind === "representative" ? relationship : null,
      permissions: kind === "representative" ? permissions : [],
      verificationMethod: method.trim(),
      verificationBasis: basis.trim(),
      adultConsent:
        kind === "representative" && classification === "adult" && consent
          ? { method: "in_person", confirmed: true }
          : undefined,
      channel,
      idempotencyKey,
    };
    const parsed = portalInvitationCreateSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors({ form: t("lmsStaffSaveFailed") });
      return;
    }
    try {
      setResult(
        await controls.invitation.mutateAsync(
          parsed.data as PortalInvitationCreateCommand,
        ),
      );
      setErrors({});
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : t("lmsStaffSaveFailed"),
      });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result!.activationUrl!);
      setCopied(true);
      toast({ title: t("lmsStaffCopied") });
    } catch {
      setErrors({ form: t("lmsStaffSaveFailed") });
    }
  };
  const titles = [
    "lmsAccessRecipientStep",
    "lmsAccessAccountStep",
    "lmsAccessPermissionsStep",
    "lmsAccessReview",
  ] as const;
  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {result ? t("lmsStaffInvitationReady") : t("lmsStaffInvite")}
            </DialogTitle>
            <DialogDescription>{studentName}</DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("lmsAccessExpires")}
                </p>
                <p className="font-medium">
                  {new Intl.DateTimeFormat(
                    language === "ru" ? "ru-RU" : "en-GB",
                    {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Tashkent",
                    },
                  ).format(new Date(result.expiresAt))}
                </p>
              </div>
              {result.activationUrl ? (
                <div className="space-y-2">
                  <Label htmlFor="portal-activation-link">
                    {t("lmsStaffCopyLink")}
                  </Label>
                  <Input
                    id="portal-activation-link"
                    readOnly
                    value={result.activationUrl}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void copy()}
                  >
                    {copied ? (
                      <Check data-icon="inline-start" />
                    ) : (
                      <Copy data-icon="inline-start" />
                    )}
                    {copied ? t("lmsStaffCopied") : t("lmsStaffCopyLink")}
                  </Button>
                </div>
              ) : null}
              {errors.form && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.form}
                </p>
              )}
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>
                  {t("lmsAccessFinish")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <ol
                className="grid grid-cols-4 gap-2"
                aria-label={t("lmsStaffInvite")}
              >
                {titles.map((title, index) => (
                  <li
                    key={title}
                    aria-current={step === index ? "step" : undefined}
                    className={`border-t-2 pt-2 text-xs ${step === index ? "border-primary font-semibold" : "border-muted text-muted-foreground"}`}
                  >
                    {t(title)}
                  </li>
                ))}
              </ol>
              {step === 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={kind === "self" ? "default" : "outline"}
                    className="h-auto min-h-24 flex-col gap-3 whitespace-normal"
                    onClick={() => {
                      setKind("self");
                      setFullName(studentName);
                    }}
                  >
                    <UserRound className="size-5" />
                    {t("lmsStaffForStudent")}
                  </Button>
                  <Button
                    id="portal-invite-kind"
                    type="button"
                    variant={kind === "representative" ? "default" : "outline"}
                    className="h-auto min-h-24 flex-col gap-3 whitespace-normal"
                    onClick={() => {
                      setKind("representative");
                      setFullName("");
                    }}
                  >
                    <UsersRound className="size-5" />
                    {t("lmsStaffForRepresentative")}
                  </Button>
                  {kind === "representative" &&
                  classification === "unverified" ? (
                    <p
                      role="alert"
                      className="text-sm text-destructive sm:col-span-2"
                    >
                      {t("lmsAccessVerificationRequired")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {step === 1 ? (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={accountMode === "new" ? "default" : "outline"}
                      onClick={() => {
                        setAccountMode("new");
                        setErrors({});
                      }}
                    >
                      {t("lmsStaffNewAccount")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        accountMode === "existing" ? "default" : "outline"
                      }
                      onClick={() => {
                        setAccountMode("existing");
                        setErrors({});
                      }}
                    >
                      {t("lmsStaffExistingAccount")}
                    </Button>
                  </div>
                  <Field
                    id="login"
                    label={t("lmsStaffLogin")}
                    error={errors.login}
                  >
                    <Input
                      id="portal-invite-login"
                      value={login}
                      maxLength={accountMode === "new" ? 32 : 254}
                      autoComplete="off"
                      autoCapitalize="none"
                      onChange={(event) => {
                        setLogin(event.target.value);
                        setFound(null);
                        setLookupDone(false);
                      }}
                      aria-invalid={Boolean(errors.login)}
                    />
                  </Field>
                  {accountMode === "existing" ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void lookup()}
                        disabled={!login.trim() || controls.lookup.isPending}
                      >
                        {t("lmsStaffFindAccount")}
                      </Button>
                      {found ? (
                        <div className="rounded-lg border p-3">
                          <p className="font-medium">{found.fullName}</p>
                          <p className="text-sm text-muted-foreground">
                            {found.login}
                          </p>
                        </div>
                      ) : lookupDone ? (
                        <p className="text-sm text-destructive">
                          {t("lmsAccessAccountMissing")}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Field
                        id="fullName"
                        label={t("lmsStaffFullName")}
                        error={errors.fullName}
                      >
                        <Input
                          id="portal-invite-fullName"
                          value={fullName}
                          maxLength={255}
                          autoComplete="name"
                          onChange={(event) => setFullName(event.target.value)}
                          aria-invalid={Boolean(errors.fullName)}
                        />
                      </Field>
                      <Field
                        id="email"
                        label={t("lmsStaffEmail")}
                        error={errors.email}
                      >
                        <Input
                          id="portal-invite-email"
                          value={email}
                          type="email"
                          maxLength={254}
                          autoComplete="email"
                          onChange={(event) => setEmail(event.target.value)}
                          aria-invalid={Boolean(errors.email)}
                        />
                      </Field>
                      <Field id="phone" label={t("lmsStaffPhone")}>
                        <Input
                          id="portal-invite-phone"
                          value={phone}
                          type="tel"
                          maxLength={50}
                          autoComplete="tel"
                          onChange={(event) => setPhone(event.target.value)}
                        />
                      </Field>
                      {email.trim() || phone.trim() ? (
                        <div className="space-y-3" id="portal-invite-contacts" tabIndex={-1}>
                          <Button type="button" variant="outline" disabled={pending} onClick={() => void checkContacts(false)}>
                            {t("lmsAccessCheckContacts")}
                          </Button>
                          {contactMatches && !currentMatches ? <p role="status" className="text-sm">{t("lmsAccessContactsChanged")}</p> : null}
                          {hasMatches && currentMatches ? (
                            <div className="space-y-3 rounded-lg border border-amber-500/50 p-3">
                              <p role="status" className="text-sm font-medium">{t("lmsAccessContactMatches")}</p>
                              {currentMatches.items.map((account) => (
                                <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
                                  <div className="min-w-0">
                                    <p className="break-words font-medium">{account.fullName}</p>
                                    <p className="break-all text-sm">{account.login}</p>
                                    <p className="text-sm text-muted-foreground">{account.matchedBy.map((match) => t(match === "email" ? "lmsAccessMatchEmail" : "lmsAccessMatchPhone")).join(" · ")}</p>
                                  </div>
                                  <Button type="button" variant="outline" disabled={!account.canUse || pending} onClick={() => chooseContactAccount(account)}>{t("lmsAccessUseAccount")}</Button>
                                </div>
                              ))}
                              <Button type="button" variant={separateAccountConfirmed ? "default" : "outline"} disabled={pending} onClick={() => { setSeparateAccountConfirmed(true); setErrors({}); }}>
                                {t("lmsAccessKeepNewAccount")}
                              </Button>
                            </div>
                          ) : null}
                          {errors.contacts ? <p role="alert" className="text-sm text-destructive">{errors.contacts}</p> : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
              {step === 2 ? (
                <div className="space-y-4">
                  {kind === "representative" ? (
                    <>
                      <Label htmlFor="portal-invite-relationship">
                        {t("lmsStaffRelationship")}
                      </Label>
                      <Select
                        value={relationship}
                        onValueChange={(value) =>
                          setRelationship(value as typeof relationship)
                        }
                      >
                        <SelectTrigger id="portal-invite-relationship">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="parent">
                            {t("lmsStaffParent")}
                          </SelectItem>
                          <SelectItem value="guardian">
                            {t("lmsStaffGuardian")}
                          </SelectItem>
                          <SelectItem value="payer">
                            {t("lmsStaffPayer")}
                          </SelectItem>
                          <SelectItem value="other">
                            {t("lmsStaffOther")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <fieldset
                        id="portal-invite-permissions"
                        tabIndex={-1}
                        className="space-y-3"
                      >
                        <legend className="mb-3 text-sm font-medium">
                          {t("lmsStaffPermissions")}
                        </legend>
                        <PermissionChecklist
                          classification={classification}
                          value={permissions}
                          onChange={setPermissions}
                        />
                        {errors.permissions ? (
                          <p role="alert" className="text-sm text-destructive">
                            {errors.permissions}
                          </p>
                        ) : null}
                      </fieldset>
                      {classification === "adult" ? (
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id="portal-invite-consent"
                            checked={consent}
                            onCheckedChange={(value) =>
                              setConsent(value === true)
                            }
                          />
                          <Label
                            htmlFor="portal-invite-consent"
                            className="text-sm leading-5"
                          >
                            {t("lmsStaffAdultConsent")}
                          </Label>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <Field
                    id="method"
                    label={t("lmsStaffVerification")}
                    error={errors.method}
                  >
                    <Input
                      id="portal-invite-method"
                      value={method}
                      maxLength={120}
                      onChange={(event) => setMethod(event.target.value)}
                      aria-invalid={Boolean(errors.method)}
                    />
                  </Field>
                  <Field
                    id="basis"
                    label={t("lmsStaffBasis")}
                    error={errors.basis}
                  >
                    <Input
                      id="portal-invite-basis"
                      value={basis}
                      maxLength={500}
                      onChange={(event) => setBasis(event.target.value)}
                      aria-invalid={Boolean(errors.basis)}
                    />
                  </Field>
                </div>
              ) : null}
              {step === 3 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4">
                    <p className="font-medium">
                      {accountMode === "new" ? fullName : found?.fullName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {accountMode === "new" ? login : found?.login}
                    </p>
                    <p className="mt-3 text-sm">
                      {kind === "self"
                        ? t("lmsStaffForStudent")
                        : t("lmsStaffForRepresentative")}
                    </p>
                    {kind === "representative" ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {permissions.map((permission) => (
                          <Badge key={permission} variant="secondary">
                            {t(permissionLabels[permission])}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>


                  {errors.email ? (
                    <p role="alert" className="text-sm text-destructive">
                      {errors.email}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {errors.form ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.form}
                </p>
              ) : null}
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    step
                      ? setStep((current) => current - 1)
                      : guard.handleOpenChange(false)
                  }
                >
                  {step ? t("lmsAccessBack") : t("lmsStaffCancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {step === 3
                    ? t("lmsStaffCreateInvitation")
                    : t("lmsAccessNext")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
      />
    </>
  );
}
function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`portal-invite-${id}`}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
