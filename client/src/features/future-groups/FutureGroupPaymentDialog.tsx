import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useTranslation } from "@/hooks/useTranslation";
import {
  useUnsavedChangesGuard,
  UnsavedChangesDialog,
} from "@/components/ux/UnsavedChangesGuard";
import { paymentsApi } from "@/features/payments/api";
import type { FutureGroupMember } from "@shared/contracts/future-groups";
import { futureGroupsKey } from "./api";

export function FutureGroupPaymentDialog({
  groupId,
  member,
  onClose,
}: {
  groupId: number;
  member: FutureGroupMember;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const sending = useRef(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [type, setType] = useState("prepayment");
  const [error, setError] = useState("");
  const payment = useMutation({
    mutationFn: () =>
      paymentsApi.create({
        leadId: member.leadId,
        studentId: member.id,
        groupId,
        amountUzs: Number(amount),
        method,
        type,
        comment: "",
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
    onError: () => setError(t("futureGroupPaymentFailed")),
    onSettled: () => {
      sending.current = false;
    },
  });
  const guard = useUnsavedChangesGuard({
    open: true,
    isDirty: Boolean(amount),
    isPending: payment.isPending,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });
  return (
    <>
      {" "}
      <Dialog open onOpenChange={guard.handleOpenChange}>
        <DialogContent className="compact-modal max-w-lg p-0">
          <form
            className="flex min-h-0 flex-col"
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
            <DialogHeader className="compact-modal-header">
              <DialogTitle>{t("futureGroupRecordPayment")}</DialogTitle>
            </DialogHeader>
            <div className="compact-modal-body space-y-4">
              <p className="break-words text-sm font-semibold">
                {member.studentName || member.contactName}
              </p>
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
              <div className="space-y-1">
                <Label htmlFor="future-payment-method">
                  {t("paymentMethod")}
                </Label>
                <Select
                  value={method}
                  onValueChange={setMethod}
                  disabled={payment.isPending}
                >
                  <SelectTrigger id="future-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">
                      {t("paymentMethodCash")}
                    </SelectItem>
                    <SelectItem value="transfer">
                      {t("paymentMethodTransfer")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="future-payment-type">{t("paymentType")}</Label>
                <Select
                  value={type}
                  onValueChange={setType}
                  disabled={payment.isPending}
                >
                  <SelectTrigger id="future-payment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prepayment">
                      {t("paymentTypePrepayment")}
                    </SelectItem>
                    <SelectItem value="full">{t("paymentTypeFull")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
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
