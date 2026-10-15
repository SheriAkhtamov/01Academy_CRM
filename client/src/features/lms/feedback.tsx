import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalLmsApi } from "../portal-app/api";
import {
  usePortal,
  useSubjectInfiniteQuery,
  useSubjectQuery,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalLoading,
  PortalError,
  PortalEmpty,
  PortalStatus,
  usePortalFormat,
} from "../portal-app/ui";

export function PortalFeedback({ initialId }: { initialId?: number }) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { subject } = usePortal();
  const query = useSubjectInfiniteQuery(
    "feedback",
    portalLmsApi.feedback,
    [],
    "feedback.read",
  );
  const [selected, setSelected] = useState<number | null>(initialId ?? null);
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
  const items = query.data.pages.flatMap((page) => page.items);
  return (
    <>
      <div className="space-y-3">
        {items.length === 0 && <PortalEmpty labelKey="portalHistoryEmpty" />}
        {items.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-0">
              <Button
                variant="ghost"
                className="h-auto min-h-16 w-full justify-between gap-3 whitespace-normal p-4 text-left"
                onClick={() => setSelected(item.id)}
              >
                <span>
                  <span className="block font-semibold">
                    {item.assignmentTitle}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {item.courseName} · {format.date(item.createdAt)}
                  </span>
                </span>
                <PortalStatus status={item.decision} />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {query.hasNextPage && (
        <Button
          className="min-h-11"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t("portalLoadMore")}
        </Button>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{t("portalFeedback")}</DialogTitle>
          <DialogDescription>{subject?.studentName}</DialogDescription>
          {selected !== null && (
            <FeedbackDetail id={selected} onClose={() => setSelected(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function FeedbackDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { allowed, guarded } = usePortal();
  const [, navigate] = useLocation();
  const query = useSubjectQuery(
    "feedback-detail",
    (link, signal) => portalLmsApi.feedbackDetail(link, id, signal),
    [id],
    "feedback.read",
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
  const data = query.data;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{data.assignmentTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.courseName} · {data.groupName}
        </p>
      </div>
      <PortalStatus status={data.decision} />
      <p className="whitespace-pre-wrap">{data.comment}</p>
      {data.score !== null && (
        <p>
          {t("portalPoints")}: {data.score}
          {data.maxScore !== null && ` / ${data.maxScore}`}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {data.reviewerName} · {format.date(data.createdAt)}
      </p>
      {allowed("learning.read") && (
        <Button
          className="min-h-11"
          variant="outline"
          onClick={() =>
            guarded(() => {
              onClose();
              navigate(`/learn/assignments/${data.recipientId}`);
            })
          }
        >
          {t("portalOpen")}
        </Button>
      )}
    </div>
  );
}
