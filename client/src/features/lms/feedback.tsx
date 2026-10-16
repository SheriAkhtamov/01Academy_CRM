import { useState } from "react";
import { usePortalLocation as useLocation } from "../portal-app/navigation";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ux/DataTable";
import {
  Dialog,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { portalLmsApi } from "../portal-app/api";
import {
  PortalFormScope,
  usePortalFormScope,
  usePortal,
  useSubjectInfiniteQuery,
  useSubjectQuery,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalLoading,
  PortalError,
  isPortalAccessError,
  PortalEmpty,
  PortalStatus,
  usePortalFormat,
} from "../portal-app/ui";
import { AssignmentDialog } from "./assignments";

export function PortalFeedback({ initialId }: { initialId?: number }) {
  const detailScope = usePortalFormScope();
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
  if (query.isPending) return <PortalLoading variant="section" />;
  if (query.data === undefined || isPortalAccessError(query.error))
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
      {query.error && (
        <PortalError error={query.error} retry={() => void query.refetch()} />
      )}
      {items.length === 0 ? (
        <PortalEmpty labelKey="portalNoFeedback" />
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
      <PortalFormScope id={detailScope.id}>
        <Dialog
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) detailScope.guarded(() => setSelected(null));
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
      </PortalFormScope>
    </>
  );
}
function FeedbackDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { subject, allowed, guarded } = usePortal();
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const query = useSubjectQuery(
    "feedback-detail",
    (link, signal) => portalLmsApi.feedbackDetail(link, id, signal),
    [id],
    "feedback.read",
  );
  if (query.isPending) return <PortalLoading variant="section" />;
  if (query.data === undefined || isPortalAccessError(query.error))
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
      {query.error && (
        <PortalError error={query.error} retry={() => void query.refetch()} />
      )}
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
        <DialogFooter className="border-t border-border/70 pt-4">
          <Button
            variant="outline"
            onClick={() =>
              guarded(() => {
                if (subject?.kind === "representative")
                  setAssignmentId(data.recipientId);
                else {
                  onClose();
                  navigate(`/learn/assignments/${data.recipientId}`);
                }
              })
            }
          >
            {t("portalOpen")}
          </Button>
        </DialogFooter>
      )}
      <AssignmentDialog id={assignmentId} onClose={() => setAssignmentId(null)} />
    </div>
  );
}
