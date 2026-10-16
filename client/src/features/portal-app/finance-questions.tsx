import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ux/DataTable";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { portalResourcesApi } from "./resources-api";
import { usePortalFormMounted } from "./usePortalFormMounted";
import {
  PortalFormScope,
  usePortalFormScope,
  usePortal,
  useSubjectQuery,
  useSubjectInfiniteQuery,
  useInvalidateSubject,
} from "./context";
import {
  PortalDialogContent as DialogContent,
  PortalLoading,
  isPortalAccessError,
  PortalError,
  PortalStatus,
  PortalEmpty,
  usePortalError,
  usePortalFormat,
} from "./ui";
export function FinanceQuestions({
  paymentId = null,
}: {
  paymentId?: number | null;
}) {
  const questionScope = usePortalFormScope();
  const conversationScope = usePortalFormScope();
  const { t } = useTranslation();
  const { subject } = usePortal();
  const format = usePortalFormat();
  const query = useSubjectInfiniteQuery(
    "finance-questions-list",
    portalResourcesApi.financeQuestionsPage,
    [],
    "finance.read",
  );
  const [ask, setAsk] = useState(false);
  const [selected, setSelected] = useState<number | null>(() =>
    paymentId === null
      ? Number(new URLSearchParams(window.location.search).get("question")) ||
        null
      : null,
  );
  const items =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter((item) => paymentId === null || item.paymentId === paymentId) ??
    [];
  if (isPortalAccessError(query.error))
    return <PortalError error={query.error} retry={() => void query.refetch()} />;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          {t("portalFinanceQuestions")}
        </h2>
        <Button variant="outline" onClick={() => setAsk(true)}>
          {t("portalPaymentQuestion")}
        </Button>
      </div>
      {query.isPending ? (
        <PortalLoading variant="section" />
      ) : query.error ? (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : items.length === 0 && !query.hasNextPage ? (
        <PortalEmpty labelKey="portalNoFinanceQuestions" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTable
              focusOnRowClick
              data={items}
              keyExtractor={(item) => String(item.id)}
              onRowClick={(item) => setSelected(item.id)}
              pageSize={0}
              showPagination={false}
              columns={[
                {
                  key: "subject",
                  header: t("portalQuestionTitle"),
                  mobilePrimary: true,
                  cellClassName: "font-medium",
                },
                {
                  key: "updatedAt",
                  header: t("portalDate"),
                  render: (item) => format.date(item.updatedAt),
                },
                {
                  key: "status",
                  header: t("status"),
                  render: (item) => <PortalStatus status={item.status} />,
                },
                {
                  key: "actions",
                  header: "",
                  className: "w-24",
                  render: (item) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected(item.id)}
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
      <PortalFormScope id={questionScope.id}>
        <Dialog
          open={ask}
          onOpenChange={(open) => {
            if (!open) questionScope.guarded(() => setAsk(false));
          }}
        >
          <DialogContent className="portal-ui">
            <DialogHeader>
              <DialogTitle>{t("portalPaymentQuestion")}</DialogTitle>
              <DialogDescription>{subject?.studentName}</DialogDescription>
            </DialogHeader>
            {ask && (
              <FinanceQuestionForm
                paymentId={paymentId}
                onCreated={(id) => {
                  setAsk(false);
                  setSelected(id);
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      </PortalFormScope>
      <PortalFormScope id={conversationScope.id}>
        <Dialog
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) conversationScope.guarded(() => setSelected(null));
          }}
        >
          <DialogContent className="portal-ui">
            <DialogHeader>
              <DialogTitle>{t("portalFinanceQuestions")}</DialogTitle>
              <DialogDescription>{subject?.studentName}</DialogDescription>
            </DialogHeader>
            {selected !== null && (
              <FinanceConversation key={selected} id={selected} />
            )}
          </DialogContent>
        </Dialog>
      </PortalFormScope>
    </section>
  );
}
function FinanceQuestionForm({
  paymentId,
  onCreated,
}: {
  paymentId: number | null;
  onCreated: (id: number) => void;
}) {
  const { t } = useTranslation();
  const mounted = usePortalFormMounted();
  const message = usePortalError();
  const { subject, setUnsaved } = usePortal();
  const invalidate = useInvalidateSubject();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const key = useRef<{ fingerprint: string; id: string } | null>(null);
  const action = useMutation({
    mutationFn: () => {
      const fingerprint = JSON.stringify([paymentId, title, body]);
      if (key.current?.fingerprint !== fingerprint)
        key.current = { fingerprint, id: crypto.randomUUID() };
      return portalResourcesApi.askFinance(subject!.linkId, {
        paymentId,
        subject: title,
        body,
        idempotencyKey: key.current!.id,
      });
    },
    onSuccess: (data) => {
      void invalidate();
      if (!mounted.current) return;
      setUnsaved(false);
      onCreated(data.id);
    },
  });
  useEffect(() => {
    setUnsaved(Boolean(title || body));
    return () => setUnsaved(false);
  }, [title, body, setUnsaved]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate();
      }}
    >
      <fieldset disabled={action.isPending} className="min-w-0 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="finance-title">{t("portalQuestionTitle")}</Label>
          <Input
            id="finance-title"
            required
            maxLength={255}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="finance-body">{t("portalQuestionText")}</Label>
          <Textarea
            id="finance-body"
            required
            maxLength={10000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
          />
        </div>
        {action.error && (
          <p role="alert" className="text-destructive">
            {message(action.error, "portalSaveError")}
          </p>
        )}
        <DialogFooter className="border-t border-border/70 pt-4">
          <Button disabled={action.isPending || !title.trim() || !body.trim()}>
            {t("portalSend")}
          </Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
function FinanceConversation({ id }: { id: number }) {
  const { t } = useTranslation();
  const mounted = usePortalFormMounted();
  const message = usePortalError();
  const format = usePortalFormat();
  const { subject, account, setUnsaved } = usePortal();
  const invalidate = useInvalidateSubject();
  const query = useSubjectQuery(
    "finance-question",
    (link, signal) => portalResourcesApi.financeQuestion(link, id, signal),
    [id],
    "finance.read",
  );
  const [body, setBody] = useState("");
  const key = useRef<{ body: string; id: string } | null>(null);
  const action = useMutation({
    mutationFn: () => {
      if (key.current?.body !== body)
        key.current = { body, id: crypto.randomUUID() };
      return portalResourcesApi.replyFinance(subject!.linkId, id, {
        body,
        idempotencyKey: key.current!.id,
      });
    },
    onSuccess: () => {
      void invalidate();
      if (!mounted.current) return;
      setBody("");
      void query.refetch();
    },
  });
  useEffect(() => {
    setUnsaved(Boolean(body));
    return () => setUnsaved(false);
  }, [body, setUnsaved]);
  if (query.isPending) return <PortalLoading variant="section" />;
  if (query.error && (query.data === undefined || isPortalAccessError(query.error)))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <div className="space-y-4">
      {query.error && <PortalError error={query.error} retry={() => void query.refetch()} />}
      <h2 className="text-lg font-semibold">{query.data.subject}</h2>
      <PortalStatus status={query.data.status} />
      {query.data.messages.map((item) => (
        <div
          key={item.id}
          className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-4"
        >
          <p className="text-sm font-medium">
            {item.author === "staff"
              ? t("portalFinanceDepartment")
              : account?.fullName}{" "}
            · {format.date(item.createdAt)}
          </p>
          <p className="whitespace-pre-wrap">{item.body}</p>
        </div>
      ))}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        <fieldset disabled={action.isPending} className="min-w-0 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="finance-reply">{t("portalComment")}</Label>
            <Textarea
              id="finance-reply"
              required
              maxLength={10000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          {action.error && (
            <p role="alert" className="text-destructive">
              {message(action.error, "portalSaveError")}
            </p>
          )}
          <DialogFooter className="border-t border-border/70 pt-4">
            <Button disabled={action.isPending || !body.trim()}>
              {t("portalSend")}
            </Button>
          </DialogFooter>
        </fieldset>
      </form>
    </div>
  );
}
