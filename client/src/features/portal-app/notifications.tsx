import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePortalLocation as useLocation } from "./navigation";
import {
  learningModuleForSubject,
} from "@shared/platform-routes";
import { resolvePortalNotificationHref } from "./module-navigation";
import type { PortalNotificationPreferencesDto } from "@shared/contracts/portal-resources";
import { PORTAL_NOTIFICATION_CATEGORIES } from "@shared/contracts/portal-resources";
import { translations, type TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  portalGrantFingerprint,
} from "./context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  isPortalAccessError,
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
  const settingsScope = usePortalFormScope();
  const mounted = usePortalFormMounted();
  const { t } = useTranslation();
  const message = usePortalError();
  const notify = usePortalSuccess();
  const {
    account,
    subject,
    subjects,
    allSubjects = subjects,
    learningModule,
    guarded,
    selectSubject,
  } = usePortal();
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
      portalGrantFingerprint(allSubjects),
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
    onMutate: () => account?.id,
    onSuccess: (_data, _id, originAccount) => {
      if (!mounted.current || originAccount !== account?.id) return;
      notify("portalReadConfirmed");
      refreshNotices();
    },
  });
  const all = useMutation({
    mutationFn: portalResourcesApi.readAll,
    onMutate: () => account?.id,
    onSuccess: (_data, _variables, originAccount) => {
      if (!mounted.current || originAccount !== account?.id) return;
      notify("portalAllReadConfirmed");
      refreshNotices();
    },
  });
  if (query.isPending) return <PortalLoading variant={embedded ? "section" : "page"} />;
  if (query.error && (query.data === undefined || isPortalAccessError(query.error)))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const actions = (
    <>
      <Button variant="outline" onClick={() => setSettings(true)}>
        {t("portalNotificationSettings")}
      </Button>
      {query.data.pages[0].unreadCount > 0 && (
        <Button
          variant="outline"
          disabled={all.isPending}
          onClick={() => all.mutate()}
        >
          {t("portalMarkAllRead")}
        </Button>
      )}
    </>
  );
  return (
    <>
      {embedded ? (
        <div className="flex flex-wrap gap-2">{actions}</div>
      ) : (
        <PortalTitle labelKey="portalNotifications">{actions}</PortalTitle>
      )}
      {query.error && <PortalError error={query.error} retry={() => void query.refetch()} />}
      {(read.error || all.error) && (
        <p role="alert" className="text-destructive">
          {message(read.error || all.error, "portalSaveError")}
        </p>
      )}
      {query.data.pages.flatMap((page) => page.items).length === 0 && (
        <PortalEmpty labelKey="portalNoNotifications" />
      )}
      {query.data.pages.some((page) => page.items.length > 0) && (
        <Card className="overflow-hidden">
          <CardContent className="divide-y divide-border/60 p-0">
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
                const child = allSubjects.find(
                  (subject) => subject.linkId === item.linkId,
                );
                const href = resolvePortalNotificationHref(
                  item,
                  allSubjects,
                  learningModule ?? learningModuleForSubject(subject ?? allSubjects[0]),
                );
                return (
                  <div
                    key={item.id}
                    className={`flex flex-wrap items-start justify-between gap-3 p-4${!item.readAt ? " bg-primary/5" : ""}`}
                  >
                    <div className="min-w-0 flex-1 basis-60 space-y-1">
                      <p className="flex items-start gap-2 break-words text-sm font-medium">
                        {!item.readAt && (
                          <span
                            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                            aria-hidden="true"
                          />
                        )}
                        {copy}
                      </p>
                      {child && <p className="text-sm">{child.studentName}</p>}
                      <p className="text-xs text-muted-foreground">
                        {format.date(item.createdAt)} ·{" "}
                        {format.time(item.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {href && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            guarded(() => {
                              if (child && subjects.includes(child))
                                selectSubject(child.linkId);
                              read.mutate(item.id);
                              onNavigate?.();
                              navigate(href);
                            })
                          }
                        >
                          {t("portalOpen")}
                        </Button>
                      )}
                      {!item.readAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={read.isPending}
                          onClick={() => read.mutate(item.id)}
                        >
                          {t("portalMarkRead")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
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
      <PortalFormScope id={settingsScope.id}>
        <Dialog
          open={settings}
          onOpenChange={(value) => {
            if (!value) settingsScope.guarded(() => setSettings(false));
          }}
        >
          <DialogContent className="portal-ui max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("portalNotificationSettings")}</DialogTitle>
              <DialogDescription>{account?.fullName}</DialogDescription>
            </DialogHeader>
            {settings && <NotificationPreferences />}
          </DialogContent>
        </Dialog>
      </PortalFormScope>
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
    <>
      {query.error && <PortalError error={query.error} retry={() => void query.refetch()} />}
      <PreferencesForm initial={query.data} />
    </>
  );
}
function PreferencesForm({
  initial,
}: {
  initial: PortalNotificationPreferencesDto;
}) {
  const { t } = useTranslation();
  const mounted = usePortalFormMounted();
  const message = usePortalError();
  const { account, setUnsaved } = usePortal();
  const client = useQueryClient();
  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const action = useMutation({
    mutationFn: (submitted: PortalNotificationPreferencesDto) =>
      portalResourcesApi.savePreferences(submitted),
    onSuccess: (data, submitted) => {
      if (!mounted.current) {
        void client.invalidateQueries({ queryKey: ["portal-account", account?.id, "preferences"] });
        return;
      }
      setValues((current) =>
        JSON.stringify(current) === JSON.stringify(submitted) ? data : current,
      );
      setBaseline(JSON.stringify(data));
      client.setQueryData(["portal-account", account?.id, "preferences"], data);
    },
  });
  useEffect(() => {
    setUnsaved(JSON.stringify(values) !== baseline || action.isPending);
    return () => setUnsaved(false);
  }, [values, baseline, action.isPending, setUnsaved]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate(values);
      }}
    >
      <div className="divide-y divide-border/60 rounded-lg border border-border/70">
        {PORTAL_NOTIFICATION_CATEGORIES.map((category) => (
          <div
            key={category}
            className="flex items-center justify-between gap-4 p-4"
          >
            <Label
              htmlFor={`notification-${category}`}
              className="cursor-pointer"
            >
              {t(categoryKeys[category])}
            </Label>
            <Switch
              id={`notification-${category}`}
              checked={values.categories[category].inApp}
              disabled={category === "security"}
              onCheckedChange={(checked) =>
                setValues({
                  ...values,
                  categories: {
                    ...values.categories,
                    [category]: {
                      ...values.categories[category],
                      inApp: checked,
                    },
                  },
                })
              }
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 p-4">
        <Label htmlFor="notification-weekly" className="cursor-pointer">
          {t("portalWeeklySummary")}
        </Label>
        <Switch
          id="notification-weekly"
          checked={values.weeklySummary}
          onCheckedChange={(checked) =>
            setValues({ ...values, weeklySummary: checked })
          }
        />
      </div>
      {action.error && (
        <p role="alert" className="text-destructive">
          {message(action.error, "portalSaveError")}
        </p>
      )}
      {action.isSuccess && JSON.stringify(values) === baseline && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("portalSaved")}
        </p>
      )}
      <DialogFooter className="border-t border-border/70 pt-4">
        <Button disabled={action.isPending}>{t("portalSave")}</Button>
      </DialogFooter>
    </form>
  );
}
