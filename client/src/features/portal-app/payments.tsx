import { useEffect, useState } from "react";
import type { PortalPaymentDto } from "@shared/contracts/portal-resources";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FinanceQuestions } from "./finance-questions";
import { usePortalLocation as useLocation } from "./navigation";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ux/DataTable";
import { portalResourcesApi } from "./resources-api";
import {
  PortalFormScope,
  usePortalFormScope,
  useSubjectQuery,
  useSubjectInfiniteQuery,
  usePortal,
} from "./context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  isPortalAccessError,
  PortalError,
  PortalEmpty,
  usePortalFormat,
} from "./ui";
export function PortalPayments() {
  const paymentScope = usePortalFormScope();
  const { t } = useTranslation();
  const format = usePortalFormat();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { subject } = usePortal();
  const query = useSubjectInfiniteQuery(
    "payments-history",
    portalResourcesApi.paymentsPage,
    [],
    "finance.read",
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = items.find((payment) => payment.id === selectedId);
  useEffect(() => {
    if (selectedId !== null && query.isSuccess && !query.isFetching && !selected)
      setSelectedId(null);
  }, [selectedId, selected, query.isSuccess, query.isFetching]);
  if (query.isPending) return <PortalLoading />;
  if (query.error && (query.data === undefined || isPortalAccessError(query.error)))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const firstPage = query.data.pages[0];
  if (firstPage.state === "needs_review")
    return (
      <>
        <PortalTitle labelKey="portalPayments" />
        {query.error && <PortalError error={query.error} retry={() => void query.refetch()} />}
        <PortalEmpty labelKey="portalPaymentNeedsReview" />
        <FinanceQuestions />
      </>
    );
  const summary = firstPage.summary;
  return (
    <>
      <PortalTitle labelKey="portalPayments" />
      {query.error && <PortalError error={query.error} retry={() => void query.refetch()} />}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {t("portalPaidUntil")}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums tracking-tight">
                {summary.paidUntil ? format.date(summary.paidUntil) : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {t("portalDueAmount")}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums tracking-tight">
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
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {t("portalNextPayment")}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums tracking-tight">
                {summary.nextPaymentAt
                  ? format.date(summary.nextPaymentAt)
                  : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
      {items.length === 0 ? (
        <PortalEmpty labelKey="portalNoPayments" />
      ) : (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base">
              {t("portalPaymentHistory")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              focusOnRowClick
              data={items}
              keyExtractor={(item) => String(item.id)}
              onRowClick={(payment) => setSelectedId(payment.id)}
              pageSize={0}
              showPagination={false}
              columns={[
                {
                  key: "date",
                  header: t("portalDate"),
                  accessor: (item) => item.paidAt ?? item.dueAt,
                  sortable: true,
                  render: (item) => (
                    <div>
                      {item.paidAt || item.dueAt
                        ? format.date(item.paidAt ?? item.dueAt!)
                        : "—"}
                      {item.period && (
                        <p className="text-xs text-muted-foreground">
                          {item.period}
                        </p>
                      )}
                    </div>
                  ),
                },
                {
                  key: "amountUzs",
                  header: t("portalAmount"),
                  sortable: true,
                  mobilePrimary: true,
                  cellClassName: "font-semibold tabular-nums whitespace-nowrap",
                  render: (item) => format.money(item.amountUzs),
                },
                {
                  key: "status",
                  header: t("portalPaymentStatus"),
                  render: (item) => <PaymentStatus item={item} />,
                },
                {
                  key: "actions",
                  header: "",
                  className: "w-24",
                  render: (item) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedId(item.id)}
                    >
                      {t("portalOpen")}
                    </Button>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t("portalLoadMore")}
        </Button>
      )}
      <FinanceQuestions />
      <PortalFormScope id={paymentScope.id}>
        <Dialog
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) paymentScope.guarded(() => setSelectedId(null));
          }}
        >
          <DialogContent className="portal-ui">
            <DialogHeader>
              <DialogTitle>{t("portalPaymentDetails")}</DialogTitle>
              <DialogDescription>{subject?.studentName}</DialogDescription>
            </DialogHeader>
            {selected && <PaymentDetails key={selected.id} item={selected} />}
          </DialogContent>
        </Dialog>
      </PortalFormScope>
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
  const variant =
    status === "portalPaid"
      ? "success"
      : status === "paymentStatusOverdue"
        ? "destructive"
        : status === "portalUnpaid"
          ? "warning"
          : "secondary";
  return <Badge variant={variant}>{t(status)}</Badge>;
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
  if (query.isPending) return <PortalLoading variant="section" />;
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
      <CardHeader className="p-4">
        <CardTitle className="text-base">{t("portalPayments")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
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
          variant="outline"
          onClick={() => guarded(() => navigate("/learn/payments"))}
        >
          {t("portalPaymentHistory")}
        </Button>
      </CardContent>
    </Card>
  );
}
