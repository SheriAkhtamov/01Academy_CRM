import { useEffect, useState, type FormEvent } from "react";
import {
  portalPasswordSchema,
  type PortalAccessLinkDto,
  type PortalClassification,
  type PortalPermission,
} from "@shared/contracts/portal-identity";
import { useTranslation } from "@/hooks/useTranslation";
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from "@/components/ux/UnsavedChangesGuard";
import type { StudentPortalAccessControls } from "../queries";
import { PermissionChecklist } from "./PermissionChecklist";

type CommonProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controls: StudentPortalAccessControls;
  onDraftChange?: (dirty: boolean, pending: boolean) => void;
};
export function ClassificationDialog({
  open,
  onOpenChange,
  controls,
  classification,
  studentName,
  onDraftChange,
}: {
  classification: PortalClassification;
  studentName: string;
} & CommonProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(classification);
  const [method, setMethod] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const dirty = value !== classification || Boolean(method || birthDate);
  const pending = controls.classification.isPending;
  const guard = useUnsavedChangesGuard({
    open,
    isDirty: dirty,
    isPending: pending,
    onOpenChange,
  });
  useEffect(() => {
    if (open) {
      setValue(classification);
      setMethod("");
      setBirthDate("");
      setErrors({});
      setConfirm(false);
    }
  }, [open, classification]);
  useEffect(() => {
    onDraftChange?.(open && dirty, open && pending);
    return () => onDraftChange?.(false, false);
  }, [open, dirty, pending, onDraftChange]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (method.trim().length < 3) {
      setErrors({ method: t("lmsAccessFieldRequired") });
      document.getElementById("portal-classification-method")?.focus();
      return;
    }
    setErrors({});
    setConfirm(true);
  };
  const save = async () => {
    try {
      await controls.classification.mutateAsync({
        classification: value,
        verificationMethod: method.trim(),
        verifiedBirthDate: birthDate || null,
      });
      setConfirm(false);
      onOpenChange(false);
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : t("lmsStaffSaveFailed"),
      });
    }
  };
  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("lmsAccessConfirmIdentity")}</DialogTitle>
            <DialogDescription>{studentName}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="portal-classification-status">
                {t("lmsStaffClassification")}
              </Label>
              <Select
                value={value}
                onValueChange={(next) => setValue(next as PortalClassification)}
              >
                <SelectTrigger id="portal-classification-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adult">{t("lmsStaffAdult")}</SelectItem>
                  <SelectItem value="minor">{t("lmsStaffMinor")}</SelectItem>
                  <SelectItem value="unverified">
                    {t("lmsStaffUnverified")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-classification-date">
                {t("lmsAccessBirthDate")}
              </Label>
              <Input
                id="portal-classification-date"
                type="date"
                value={birthDate}
                max={new Date().toLocaleDateString("en-CA", {
                  timeZone: "Asia/Tashkent",
                })}
                onChange={(event) => setBirthDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-classification-method">
                {t("lmsStaffVerification")}
              </Label>
              <Input
                id="portal-classification-method"
                value={method}
                maxLength={120}
                onChange={(event) => setMethod(event.target.value)}
                aria-invalid={Boolean(errors.method)}
              />
              {errors.method ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.method}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => guard.handleOpenChange(false)}
              >
                {t("lmsStaffCancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("lmsStaffSave")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AccessConfirmation
        open={confirm}
        onOpenChange={setConfirm}
        title={t("lmsAccessClassificationTitle")}
        description={
          classification !== value
            ? t("lmsAccessClassificationBody")
            : studentName
        }
        action={t("lmsStaffSave")}
        onConfirm={() => void save()}
        pending={pending}
        error={errors.form}
      />
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
      />
    </>
  );
}
export function PermissionEditDialog({
  open,
  onOpenChange,
  controls,
  classification,
  link,
  onDraftChange,
}: {
  classification: PortalClassification;
  link: PortalAccessLinkDto | null;
} & CommonProps) {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<PortalPermission[]>([]);
  const [method, setMethod] = useState("");
  const [basis, setBasis] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const dirty =
    Boolean(method || basis || consent) ||
    JSON.stringify(permissions) !== JSON.stringify(link?.permissions ?? []);
  const pending = controls.permissions.isPending;
  const guard = useUnsavedChangesGuard({
    open,
    isDirty: dirty,
    isPending: pending,
    onOpenChange,
  });
  useEffect(() => {
    if (open) {
      setPermissions(link?.permissions ?? []);
      setMethod("");
      setBasis("");
      setConsent(false);
      setErrors({});
      setConfirm(false);
    }
  }, [open, link]);
  useEffect(() => {
    onDraftChange?.(open && dirty, open && pending);
    return () => onDraftChange?.(false, false);
  }, [open, dirty, pending, onDraftChange]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!permissions.length) next.permissions = t("lmsAccessChoosePermissions");
    if (method.trim().length < 3) next.method = t("lmsAccessFieldRequired");
    if (basis.trim().length < 3) next.basis = t("lmsAccessFieldRequired");
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(`portal-edit-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setConfirm(true);
  };
  const save = async () => {
    if (!link) return;
    try {
      await controls.permissions.mutateAsync({
        linkId: link.id,
        permissions,
        verificationMethod: method.trim(),
        verificationBasis: basis.trim(),
        adultConsent:
          classification === "adult" && consent
            ? { method: "in_person", confirmed: true }
            : undefined,
      });
      setConfirm(false);
      onOpenChange(false);
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : t("lmsStaffSaveFailed"),
      });
    }
  };
  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("lmsAccessEditPermissions")}</DialogTitle>
            <DialogDescription>{link?.account.fullName}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <fieldset
              id="portal-edit-permissions"
              tabIndex={-1}
              className="space-y-3"
            >
              <legend className="mb-3 text-sm font-medium">
                {t("lmsStaffPermissions")}
              </legend>
              <PermissionChecklist
                value={permissions}
                onChange={setPermissions}
                classification={classification}
                idPrefix="portal-edit"
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
                  id="portal-edit-consent"
                  checked={consent}
                  onCheckedChange={(value) => setConsent(value === true)}
                />
                <Label htmlFor="portal-edit-consent">
                  {t("lmsStaffAdultConsent")}
                </Label>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="portal-edit-method">
                {t("lmsStaffVerification")}
              </Label>
              <Input
                id="portal-edit-method"
                value={method}
                maxLength={120}
                onChange={(event) => setMethod(event.target.value)}
                aria-invalid={Boolean(errors.method)}
              />
              {errors.method ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.method}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-edit-basis">{t("lmsStaffBasis")}</Label>
              <Input
                id="portal-edit-basis"
                value={basis}
                maxLength={500}
                onChange={(event) => setBasis(event.target.value)}
                aria-invalid={Boolean(errors.basis)}
              />
              {errors.basis ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.basis}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => guard.handleOpenChange(false)}
              >
                {t("lmsStaffCancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("lmsStaffSave")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AccessConfirmation
        open={confirm}
        onOpenChange={setConfirm}
        title={t("lmsAccessPermissionsTitle")}
        description={t("lmsAccessPermissionsBody")}
        action={t("lmsStaffSave")}
        onConfirm={() => void save()}
        pending={pending}
        error={errors.form}
      />
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
      />
    </>
  );
}
export function StaffRecoveryDialog({
  open,
  onOpenChange,
  controls,
  link,
  onDraftChange,
}: { link: PortalAccessLinkDto | null } & CommonProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [method, setMethod] = useState("");
  const [basis, setBasis] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const dirty = Boolean(password || repeat || method || basis);
  const pending = controls.recovery.isPending;
  const guard = useUnsavedChangesGuard({
    open,
    isDirty: dirty,
    isPending: pending,
    onOpenChange,
  });
  useEffect(() => {
    if (open) {
      setPassword("");
      setRepeat("");
      setMethod("");
      setBasis("");
      setErrors({});
      setConfirm(false);
    }
  }, [open, link]);
  useEffect(() => {
    onDraftChange?.(open && dirty, open && pending);
    return () => onDraftChange?.(false, false);
  }, [open, dirty, pending, onDraftChange]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!portalPasswordSchema.safeParse(password).success)
      next.password = t("lmsAccessPasswordRequirements");
    if (password !== repeat) next.repeat = t("lmsAccessPasswordsMismatch");
    if (method.trim().length < 3) next.method = t("lmsAccessFieldRequired");
    if (basis.trim().length < 3) next.basis = t("lmsAccessFieldRequired");
    setErrors(next);
    if (Object.keys(next).length) {
      document
        .getElementById(`portal-recovery-${Object.keys(next)[0]}`)
        ?.focus();
      return;
    }
    setConfirm(true);
  };
  const save = async () => {
    if (!link) return;
    try {
      await controls.recovery.mutateAsync({
        accountId: link.account.id,
        password,
        verificationMethod: method.trim(),
        verificationBasis: basis.trim(),
      });
      setPassword("");
      setRepeat("");
      setConfirm(false);
      onOpenChange(false);
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : t("lmsStaffSaveFailed"),
      });
    }
  };
  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("lmsAccessReset")}</DialogTitle>
            <DialogDescription>{link?.account.fullName}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="portal-recovery-password">
                {t("lmsAccessNewPassword")}
              </Label>
              <Input
                id="portal-recovery-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(errors.password)}
              />
              {errors.password ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.password}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-recovery-repeat">
                {t("lmsAccessRepeatPassword")}
              </Label>
              <Input
                id="portal-recovery-repeat"
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                aria-invalid={Boolean(errors.repeat)}
              />
              {errors.repeat ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.repeat}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-recovery-method">
                {t("lmsStaffVerification")}
              </Label>
              <Input
                id="portal-recovery-method"
                value={method}
                maxLength={120}
                onChange={(event) => setMethod(event.target.value)}
                aria-invalid={Boolean(errors.method)}
              />
              {errors.method ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.method}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-recovery-basis">
                {t("lmsStaffBasis")}
              </Label>
              <Input
                id="portal-recovery-basis"
                value={basis}
                maxLength={500}
                onChange={(event) => setBasis(event.target.value)}
                aria-invalid={Boolean(errors.basis)}
              />
              {errors.basis ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.basis}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => guard.handleOpenChange(false)}
              >
                {t("lmsStaffCancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("lmsAccessReset")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AccessConfirmation
        open={confirm}
        onOpenChange={setConfirm}
        title={t("lmsAccessResetTitle")}
        description={`${link?.account.fullName ?? ""}. ${t("lmsAccessResetBody")}`}
        action={t("lmsAccessReset")}
        onConfirm={() => void save()}
        pending={pending}
        error={errors.form}
      />
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
      />
    </>
  );
}
export function AccessConfirmation({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  action: string;
  onConfirm: () => void;
  pending: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("lmsStaffCancel")}
          </AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
