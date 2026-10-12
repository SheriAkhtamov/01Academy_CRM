import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { PortalNotificationPreferencesDto } from "@shared/contracts/portal-resources";
import { PORTAL_NOTIFICATION_CATEGORIES } from "@shared/contracts/portal-resources";
import { translations, type TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalResourcesApi } from "./resources-api";
import { usePortal, portalGrantFingerprint } from "./context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  PortalEmpty,
  usePortalFormat,
  usePortalError,
  usePortalSuccess,
} from "./ui";

const categoryKeys: Record<string, TranslationKey> = {
  learning: "portalLearningNotifications",
  feedback: "portalFeedback",
  schedule: "portalScheduleNotifications",
  finance: "portalFinanceNotifications",
  family: "portalFamilyNotifications",
  security: "portalSecurityNotifications",
};
export function PortalNotifications({
  embedded = false,
  onNavigate,
}: {
  embedded?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const notify = usePortalSuccess();
  const { account, subjects, guarded, selectSubject } = usePortal();
  const [, navigate] = useLocation();
  const format = usePortalFormat();
  const [settings, setSettings] = useState(false);
  const client = useQueryClient();
  const refreshNotices = () => {
    void query.refetch();
    void client.invalidateQueries({
      queryKey: ["portal-account", account?.id, "notifications-badge"],
    });
    void client.invalidateQueries({
      queryKey: ["portal-account", account?.id, "day-notifications"],
    });
  };
  const query = useInfiniteQuery({
    queryKey: [
      "portal-account",
      account?.id,
      "notifications",
      portalGrantFingerprint(subjects),
    ],
    queryFn: ({ signal, pageParam }) =>
      portalResourcesApi.notifications(signal, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(account),
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: portalResourcesApi.readNotification,
    onSuccess: () => {
      notify("portalReadConfirmed");
      refreshNotices();
    },
  });
  const all = useMutation({
    mutationFn: portalResourcesApi.readAll,
    onSuccess: () => {
      notify("portalAllReadConfirmed");
      refreshNotices();
    },
  });
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
    <>
      {!embedded && <PortalTitle labelKey="portalNotifications" />}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setSettings(true)}
        >
          {t("portalNotificationSettings")}
        </Button>
        {query.data.pages[0].unreadCount > 0 && (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={all.isPending}
            onClick={() => all.mutate()}
          >
            {t("portalMarkAllRead")}
          </Button>
        )}
      </div>
      {(read.error || all.error) && (
        <p role="alert" className="text-destructive">
          {message(read.error || all.error, "portalSaveError")}
        </p>
      )}
      {query.data.pages.flatMap((page) => page.items).length === 0 && (
        <PortalEmpty labelKey="portalNoNotifications" />
      )}
      <div className="space-y-3">
        {query.data.pages
          .flatMap((page) => page.items)
          .map((item) => {
            const key = item.code as TranslationKey;
            let copy =
              key in translations
                ? t(key)
                : t(categoryKeys[item.category] ?? "portalNotifications");
            Object.entries(item.params).forEach(([name, value]) => {
              copy = copy.split(`{${name}}`).join(String(value));
            });
            const child = subjects.find(
              (subject) => subject.linkId === item.linkId,
            );
            return (
              <Card
                key={item.id}
                className={!item.readAt ? "border-primary/40" : ""}
              >
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <p className="break-words font-medium">{copy}</p>
                    {child && <p className="text-sm">{child.studentName}</p>}
                    <p className="text-sm text-muted-foreground">
                      {format.date(item.createdAt)} ·{" "}
                      {format.time(item.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.href?.startsWith("/learn") && (
                      <Button
                        className="min-h-11"
                        onClick={() =>
                          guarded(() => {
                            if (child) selectSubject(child.linkId);
                            read.mutate(item.id);
                            onNavigate?.();
                            navigate(item.href!);
                          })
                        }
                      >
                        {t("portalOpen")}
                      </Button>
                    )}
                    {!item.readAt && (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={read.isPending}
                        onClick={() => read.mutate(item.id)}
                      >
                        {t("portalMarkRead")}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>
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
        open={settings}
        onOpenChange={(value) => {
          if (!value) guarded(() => setSettings(false));
        }}
      >
        <DialogContent className="portal-ui max-w-2xl">
          <DialogTitle>{t("portalNotificationSettings")}</DialogTitle>
          <DialogDescription>{account?.fullName}</DialogDescription>
          {settings && <NotificationPreferences />}
        </DialogContent>
      </Dialog>
    </>
  );
}
function NotificationPreferences() {
  const { account } = usePortal();
  const query = useQuery({
    queryKey: ["portal-account", account?.id, "preferences"],
    queryFn: ({ signal }) => portalResourcesApi.preferences(signal),
    enabled: Boolean(account),
  });
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
  return <PreferencesForm initial={query.data} />;
}
function PreferencesForm({
  initial,
}: {
  initial: PortalNotificationPreferencesDto;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { setUnsaved } = usePortal();
  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  useEffect(() => {
    setUnsaved(JSON.stringify(values) !== baseline);
    return () => setUnsaved(false);
  }, [values, baseline, setUnsaved]);
  const action = useMutation({
    mutationFn: () => portalResourcesApi.savePreferences(values),
    onSuccess: (data) => {
      setValues(data);
      setBaseline(JSON.stringify(data));
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate();
      }}
    >
      <div className="space-y-3">
        {PORTAL_NOTIFICATION_CATEGORIES.map((category) => (
          <fieldset key={category} className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {t(categoryKeys[category])}
            </legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={values.categories[category].inApp}
                  disabled={category === "security"}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      categories: {
                        ...values.categories,
                        [category]: {
                          ...values.categories[category],
                          inApp: event.target.checked,
                        },
                      },
                    })
                  }
                />
                {t("portalInAppNotifications")}
              </label>

            </div>
          </fieldset>
        ))}
      </div>

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={values.weeklySummary}
          onChange={(event) =>
            setValues({ ...values, weeklySummary: event.target.checked })
          }
        />
        {t("portalWeeklySummary")}
      </label>
      {action.error && (
        <p role="alert" className="text-destructive">
          {message(action.error, "portalSaveError")}
        </p>
      )}
      {action.isSuccess && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("portalSaved")}
        </p>
      )}
      <Button className="min-h-11" disabled={action.isPending}>
        {t("portalSave")}
      </Button>
    </form>
  );
}
