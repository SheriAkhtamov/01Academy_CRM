import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ux/DataTable";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
      {items.length === 0 ? (
        <PortalEmpty labelKey="portalHistoryEmpty" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTable
              data={items}
              keyExtractor={(item) => String(item.id)}
              onRowClick={(item) => setSelected(item.id)}
              pageSize={0}
              showPagination={false}
              columns={[
                {
                  key: "assignmentTitle",
                  header: t("portalAssignments"),
                  mobilePrimary: true,
                  cellClassName: "font-medium",
                },
                { key: "courseName", header: t("portalCourses") },
                {
                  key: "decision",
                  header: t("portalFeedback"),
                  render: (item) => <PortalStatus status={item.decision} />,
                },
                {
                  key: "createdAt",
                  header: t("portalDate"),
                  sortable: true,
                  render: (item) => format.date(item.createdAt),
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
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="portal-ui">
          <DialogHeader>
            <DialogTitle>{t("portalFeedback")}</DialogTitle>
            <DialogDescription>{subject?.studentName}</DialogDescription>
          </DialogHeader>
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
        <h2 className="text-lg font-semibold">{data.assignmentTitle}</h2>
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
