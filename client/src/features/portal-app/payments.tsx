import { useState } from "react";
import type { PortalPaymentDto } from "@shared/contracts/portal-resources";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FinanceQuestions } from "./finance-questions";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { portalResourcesApi } from "./resources-api";
import { useSubjectQuery, useSubjectInfiniteQuery, usePortal } from "./context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  PortalEmpty,
  usePortalFormat,
} from "./ui";
export function PortalPayments() {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const [selected, setSelected] = useState<PortalPaymentDto | null>(null);
  const { subject, guarded } = usePortal();
  const query = useSubjectInfiniteQuery(
    "payments-history",
    portalResourcesApi.paymentsPage,
    [],
    "finance.read",
  );
  if (query.isPending) return <PortalLoading />;
  if (query.error)
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const firstPage = query.data.pages[0];
  const items = query.data.pages.flatMap((page) => page.items);
  if (firstPage.state === "needs_review")
    return (
      <>
        <PortalTitle labelKey="portalPayments" />
        <PortalEmpty labelKey="portalPaymentNeedsReview" />
        <FinanceQuestions />
      </>
    );
  const summary = firstPage.summary;
  return (
    <>
      <PortalTitle labelKey="portalPayments" />
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("portalPaidUntil")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {summary.paidUntil ? format.date(summary.paidUntil) : "—"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("portalDueAmount")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-2xl font-semibold">
                {format.money(summary.dueUzs)}
              </p>
              {summary.nextPaymentAt && (
                <p className="text-sm text-muted-foreground">
                  {format.date(summary.nextPaymentAt)}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("portalNextPayment")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {summary.nextPaymentAt ? format.date(summary.nextPaymentAt) : "—"}
            </CardContent>
          </Card>
        </div>
      )}
      {items.length === 0 ? (
        <PortalEmpty labelKey="portalNoPayments" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("portalPaymentHistory")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-3 md:hidden">
              {items.map((item) => (
                <Button
                  key={item.id}
                  variant="outline"
                  className="h-auto min-h-20 w-full justify-between gap-3 whitespace-normal p-4 text-left"
                  onClick={() => setSelected(item)}
                >
                  <span>
                    <span className="block font-medium">
                      {format.money(item.amountUzs)}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {item.paidAt || item.dueAt
                        ? format.date(item.paidAt ?? item.dueAt!)
                        : "—"}
                    </span>
                    {item.period && (
                      <span className="block text-sm text-muted-foreground">
                        {item.period}
                      </span>
                    )}
                  </span>
                  <PaymentStatus item={item} />
                </Button>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("portalDate")}</TableHead>
                    <TableHead>{t("portalAmount")}</TableHead>
                    <TableHead>{t("portalPaymentStatus")}</TableHead>
                    <TableHead>
                      <span className="sr-only">
                        {t("portalPaymentDetails")}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.paidAt || item.dueAt
                          ? format.date(item.paidAt ?? item.dueAt!)
                          : "—"}
                        {item.period && (
                          <span className="block text-sm text-muted-foreground">
                            {item.period}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {format.money(item.amountUzs)}
                      </TableCell>
                      <TableCell>
                        <PaymentStatus item={item} />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          className="min-h-11"
                          onClick={() => setSelected(item)}
                        >
                          {t("portalOpen")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t("portalLoadMore")}
        </Button>
      )}
      <FinanceQuestions />
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) guarded(() => setSelected(null));
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{t("portalPaymentDetails")}</DialogTitle>
          <DialogDescription>{subject?.studentName}</DialogDescription>
          {selected && <PaymentDetails key={selected.id} item={selected} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PaymentStatus({ item }: { item: PortalPaymentDto }) {
  const { t } = useTranslation();
  const status =
    item.status === "refunded"
      ? "paymentStatusRefunded"
      : item.status === "overdue"
        ? "paymentStatusOverdue"
        : ["paid", "completed", "confirmed"].includes(item.status)
          ? "portalPaid"
          : "portalUnpaid";
  return <Badge variant="secondary">{t(status)}</Badge>;
}
function PaymentDetails({ item }: { item: PortalPaymentDto }) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const method =
    item.method === "card"
      ? "paymentMethodCard"
      : item.method === "cash"
        ? "paymentMethodCash"
        : item.method === "transfer"
          ? "paymentMethodTransfer"
          : "portalPaymentOtherMethod";
  const type =
    item.type === "full"
      ? "paymentTypeFull"
      : item.type === "prepayment"
        ? "paymentTypePrepayment"
        : item.type === "monthly"
          ? "paymentTypeMonthly"
          : item.type === "installment_1_2"
            ? "paymentTypeInstallmentOne"
            : item.type === "installment_2_2"
              ? "paymentTypeInstallmentTwo"
              : "portalPaymentOtherType";
  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">{t("portalAmount")}</dt>
          <dd className="text-xl font-semibold">
            {format.money(item.amountUzs)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            {t("portalPaymentStatus")}
          </dt>
          <dd>
            <PaymentStatus item={item} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            {t("paymentMethod")}
          </dt>
          <dd>{t(method)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("paymentType")}</dt>
          <dd>{t(type)}</dd>
        </div>
        {item.period && (
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("portalPaymentPeriod")}
            </dt>
            <dd>{item.period}</dd>
          </div>
        )}
        {item.paidAt && (
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("portalPaymentDate")}
            </dt>
            <dd>{format.date(item.paidAt)}</dd>
          </div>
        )}
        {item.dueAt && (
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("portalPaymentDueDate")}
            </dt>
            <dd>{format.date(item.dueAt)}</dd>
          </div>
        )}
        {item.paidUntil && (
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("portalPaidUntil")}
            </dt>
            <dd>{format.date(item.paidUntil)}</dd>
          </div>
        )}
      </dl>
      <FinanceQuestions paymentId={item.id} />
    </div>
  );
}

export function PortalPaymentSummary() {
  const { t } = useTranslation();
  const { guarded } = usePortal();
  const [, navigate] = useLocation();
  const format = usePortalFormat();
  const query = useSubjectQuery(
    "payments",
    portalResourcesApi.payments,
    [],
    "finance.read",
  );
  if (query.isPending) return <PortalLoading />;
  if (query.error)
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  if (query.data.state === "needs_review")
    return <PortalEmpty labelKey="portalPaymentNeedsReview" />;
  const summary = query.data.summary;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("portalPayments")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary?.paidUntil && (
          <p>
            {t("portalPaidUntil")}: {format.date(summary.paidUntil)}
          </p>
        )}
        {summary && summary.dueUzs > 0 && (
          <p>
            {t("portalNextPayment")}: {format.money(summary.dueUzs)}
            {summary.nextPaymentAt &&
              ` · ${format.date(summary.nextPaymentAt)}`}
          </p>
        )}
        <Button
          className="min-h-11"
          variant="outline"
          onClick={() => guarded(() => navigate("/learn/payments"))}
        >
          {t("portalPaymentHistory")}
        </Button>
      </CardContent>
    </Card>
  );
}
