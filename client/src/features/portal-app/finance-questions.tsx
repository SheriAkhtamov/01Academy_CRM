import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalResourcesApi } from "./resources-api";
import {
  usePortal,
  useSubjectQuery,
  useSubjectInfiniteQuery,
  useInvalidateSubject,
} from "./context";
import {
  PortalDialogContent as DialogContent,
  PortalLoading,
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
  const { t } = useTranslation();
  const { subject, guarded } = usePortal();
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
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("portalFinanceQuestions")}</h2>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setAsk(true)}
        >
          {t("portalPaymentQuestion")}
        </Button>
      </div>
      {query.isPending ? (
        <PortalLoading />
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
        items.map((item) => (
          <Button
            key={item.id}
            variant="outline"
            className="h-auto min-h-14 w-full justify-between gap-3 whitespace-normal p-4 text-left"
            onClick={() => setSelected(item.id)}
          >
            <span>
              <span className="block font-medium">{item.subject}</span>
              <span className="block text-sm text-muted-foreground">
                {format.date(item.updatedAt)}
              </span>
            </span>
            <PortalStatus status={item.status} />
          </Button>
        ))
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
      <Dialog
        open={ask}
        onOpenChange={(open) => {
          if (!open) guarded(() => setAsk(false));
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{t("portalPaymentQuestion")}</DialogTitle>
          <DialogDescription>{subject?.studentName}</DialogDescription>
          {ask && (
            <FinanceQuestionForm
              paymentId={paymentId}
              onCreated={(id) => {
                setAsk(false);
                setSelected(id);
                void query.refetch();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) guarded(() => setSelected(null));
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{t("portalFinanceQuestions")}</DialogTitle>
          <DialogDescription>{subject?.studentName}</DialogDescription>
          {selected !== null && (
            <FinanceConversation key={selected} id={selected} />
          )}
        </DialogContent>
      </Dialog>
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
  const message = usePortalError();
  const { subject, setUnsaved } = usePortal();
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
      <Label htmlFor="finance-title">{t("portalQuestionTitle")}</Label>
      <Input
        id="finance-title"
        required
        maxLength={255}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="min-h-11"
      />
      <Label htmlFor="finance-body">{t("portalQuestionText")}</Label>
      <Textarea
        id="finance-body"
        required
        maxLength={10000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={5}
      />
      {action.error && (
        <p role="alert" className="text-destructive">
          {message(action.error, "portalSaveError")}
        </p>
      )}
      <Button
        className="min-h-11"
        disabled={action.isPending || !title.trim() || !body.trim()}
      >
        {t("portalSend")}
      </Button>
    </form>
  );
}
function FinanceConversation({ id }: { id: number }) {
  const { t } = useTranslation();
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
      setBody("");
      void query.refetch();
      void invalidate();
    },
  });
  useEffect(() => {
    setUnsaved(Boolean(body));
    return () => setUnsaved(false);
  }, [body, setUnsaved]);
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
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{query.data.subject}</h2>
      <PortalStatus status={query.data.status} />
      {query.data.messages.map((item) => (
        <div key={item.id} className="space-y-2 rounded-md border p-3">
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
        <Label htmlFor="finance-reply">{t("portalComment")}</Label>
        <Textarea
          id="finance-reply"
          required
          maxLength={10000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {action.error && (
          <p role="alert" className="text-destructive">
            {message(action.error, "portalSaveError")}
          </p>
        )}
        <Button
          className="min-h-11"
          disabled={action.isPending || !body.trim()}
        >
          {t("portalSend")}
        </Button>
      </form>
    </div>
  );
}
