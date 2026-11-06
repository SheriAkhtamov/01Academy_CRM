import { useEffect, useState } from "react";
import { FileText, Download } from "lucide-react";
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
      <PortalStudentContractCard />
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {t("portalPaid")}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums tracking-tight">
                {format.money(summary.paidUzs)}
              </p>
            </CardContent>
          </Card>
          {summary.refundedUzs > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("paymentStatusRefunded")}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums tracking-tight">
                  {format.money(summary.refundedUzs)}
                </p>
              </CardContent>
            </Card>
          )}
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
                  accessor: (item) => item.paidAt,
                  sortable: true,
                  render: (item) => (item.paidAt ? format.date(item.paidAt) : "—"),
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
        <Button loading={query.isFetchingNextPage}
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
      : ["paid", "completed", "confirmed"].includes(item.status)
        ? "portalPaid"
        : "paymentStatusPending";
  const variant =
    status === "portalPaid"
      ? "success"
      : status === "paymentStatusPending"
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
        {item.paidAt && (
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("portalPaymentDate")}
            </dt>
            <dd>{format.date(item.paidAt)}</dd>
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
        {summary && (
          <p>
            {t("portalPaid")}: {format.money(summary.paidUzs)}
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

function PortalStudentContractCard() {
  const { t } = useTranslation();
  const contractQuery = useSubjectQuery(
    "student-contract",
    portalResourcesApi.studentContract,
    [],
    "finance.read",
  );
  if (contractQuery.isPending || !contractQuery.data) return null;
  const contract = contractQuery.data;
  const sizeText = contract.fileSize
    ? contract.fileSize > 1024 * 1024
      ? `${(contract.fileSize / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.round(contract.fileSize / 1024)} KB`
    : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold">{t("portalStudentContract")}: № {contract.number}</p>
              {!contract.hasFile && (
                <Badge variant="secondary" className="text-xs">
                  {t("portalContractNoFile")}
                </Badge>
              )}
            </div>
            {contract.hasFile && contract.fileName && (
              <p className="text-xs text-muted-foreground">
                {contract.fileName} {sizeText ? `(${sizeText})` : ""}
              </p>
            )}
          </div>
        </div>
        {contract.hasFile && contract.downloadUrl ? (
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <a href={contract.downloadUrl} download={contract.fileName || "contract"}>
              <Download className="mr-1.5 size-4" />
              {t("portalDownloadContract")}
            </a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
