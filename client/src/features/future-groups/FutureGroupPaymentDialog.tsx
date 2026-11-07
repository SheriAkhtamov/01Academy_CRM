import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, UserRound } from "lucide-react";
import { PAYMENT_METHODS } from "@shared/academy";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompactModalSection } from "@/components/ux/CompactModalSection";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/i18n";
import {
  useUnsavedChangesGuard,
  UnsavedChangesDialog,
} from "@/components/ux/UnsavedChangesGuard";
import { paymentsApi } from "@/features/payments/api";
import type { FutureGroupMember } from "@shared/contracts/future-groups";
import { futureGroupsKey } from "./api";

const METHOD_KEYS: Record<(typeof PAYMENT_METHODS)[number], TranslationKey> = {
  cash: "paymentMethodCash",
  transfer: "paymentMethodTransfer",
  card: "paymentMethodCard",
};

const TYPE_KEYS = [
  { value: "prepayment", key: "paymentTypePrepayment" },
  { value: "full", key: "paymentTypeFull" },
  { value: "monthly", key: "paymentTypeMonthly" },
  { value: "installment_1_2", key: "paymentTypeInstallmentOne" },
  { value: "installment_2_2", key: "paymentTypeInstallmentTwo" },
] as const satisfies ReadonlyArray<{ value: string; key: TranslationKey }>;

export function FutureGroupPaymentDialog({
  groupId,
  member,
  onClose,
}: {
  groupId: number;
  member: FutureGroupMember;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const client = useQueryClient();
  const sending = useRef(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [type, setType] = useState("prepayment");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const money = (value: number) =>
    new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US").format(value);
  const payment = useMutation({
    mutationFn: () =>
      paymentsApi.create({
        leadId: member.leadId,
        studentId: member.id,
        groupId,
        amountUzs: Number(amount),
        method,
        type,
        comment: comment.trim(),
        status: "paid",
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: futureGroupsKey }),
        client.invalidateQueries({
          queryKey: ["future-group-members", groupId],
        }),
      ]);
      onClose();
    },
    onError: (e: Error & { rawMessage?: string }) => {
      const code = e.rawMessage ?? e.message;
      setError(
        code === "accessDenied" || e.message === t("accessDenied")
          ? t("accessDenied")
          : t("futureGroupPaymentFailed"),
      );
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  const guard = useUnsavedChangesGuard({
    open: true,
    isDirty: Boolean(amount || comment.trim()),
    isPending: payment.isPending,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });
  return (
    <>
      <Dialog open onOpenChange={guard.handleOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="compact-modal flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden p-0"
        >
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              // Portal events still bubble through the surrounding group form in React.
              event.stopPropagation();
              if (!sending.current) {
                sending.current = true;
                setError("");
                payment.mutate();
              }
            }}
          >
            <DialogHeader
              className="compact-modal-header"
              data-topographic="header"
            >
              <div className="flex items-center gap-2.5 pr-8">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20"
                  aria-hidden="true"
                >
                  <CreditCard className="size-4" />
                </span>
                <DialogTitle>{t("futureGroupRecordPayment")}</DialogTitle>
              </div>
            </DialogHeader>
            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-300"
                    aria-hidden="true"
                  >
                    <UserRound className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-foreground">
                      {member.studentName || member.contactName}
                    </p>
                    {member.studentName && (
                      <p className="truncate text-xs text-muted-foreground">
                        {member.contactName}
                      </p>
                    )}
                  </div>
                </div>
                {member.paidAmountUzs > 0 ? (
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {money(member.paidAmountUzs)} {t("currencyUzs")}
                  </span>
                ) : null}
              </div>

              <CompactModalSection
                title={t("payment")}
                icon={CreditCard}
                tone="sky"
                collapsible={false}
                contentClassName="space-y-3"
              >
                <div className="space-y-1">
                  <Label htmlFor="future-payment-amount">
                    {t("amount")} · {t("currencyUzs")}
                  </Label>
                  <Input
                    id="future-payment-amount"
                    type="number"
                    min="1"
                    max="2147483647"
                    step="1"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={payment.isPending}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="future-payment-method">
                      {t("paymentMethod")}
                    </Label>
                    <Select
                      value={method}
                      onValueChange={setMethod}
                      disabled={payment.isPending}
                    >
                      <SelectTrigger id="future-payment-method" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((item) => (
                          <SelectItem key={item} value={item}>
                            {t(METHOD_KEYS[item])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="future-payment-type">
                      {t("paymentType")}
                    </Label>
                    <Select
                      value={type}
                      onValueChange={setType}
                      disabled={payment.isPending}
                    >
                      <SelectTrigger id="future-payment-type" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_KEYS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(option.key)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="future-payment-comment">
                    {t("comment")}
                  </Label>
                  <Input
                    id="future-payment-comment"
                    value={comment}
                    maxLength={500}
                    onChange={(e) => setComment(e.target.value)}
                    disabled={payment.isPending}
                  />
                </div>
              </CompactModalSection>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="compact-modal-footer">
              <Button
                type="button"
                variant="outline"
                disabled={payment.isPending}
                onClick={() => guard.handleOpenChange(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={payment.isPending}>
                {t("confirmPayment")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
        isPending={payment.isPending}
      />
    </>
  );
}
