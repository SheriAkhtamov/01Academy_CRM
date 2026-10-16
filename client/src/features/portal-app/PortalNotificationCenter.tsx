import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { PortalNotificationCollectionDto, PortalNotificationDto } from "@shared/contracts/portal-resources";
import type { PortalSessionDto } from "@shared/contracts/portal-identity";
import { learningModuleForSubject } from "@shared/platform-routes";
import { NotificationsMenuView, type NotificationsMenuViewItem } from "@/components/ux/NotificationsMenuView";
import { useTranslation } from "@/hooks/useTranslation";
import { toast } from "@/hooks/use-toast";
import { translations, type TranslationKey } from "@/lib/i18n";
import { allowNavigation } from "@/lib/navigationGuard";
import { getActivePlatformRealm } from "@/lib/platformSession";
import { portalGrantFingerprint, portalSessionKey, usePortal, usePortalFormScope } from "./context";
import { usePortalLocation } from "./navigation";
import { resolvePortalNotificationHref } from "./module-navigation";
import { portalResourcesApi } from "./resources-api";
import { usePortalFormMounted } from "./usePortalFormMounted";
import { isPortalAccessError, usePortalError } from "./ui";

type NoticeOrigin = { accountId: number; grants: string };
type NoticeCommand = { origin: NoticeOrigin; item: PortalNotificationDto };
type NoticePages = InfiniteData<PortalNotificationCollectionDto, number | undefined>;

export function PortalNotificationCenter({ navigationKey }: { navigationKey: string }) {
  const { t } = useTranslation();
  const errorMessage = usePortalError();
  const mounted = usePortalFormMounted();
  const { account, subject, subjects, allSubjects, learningModule, guarded, selectSubject } = usePortal();
  const [path, navigate] = usePortalLocation();
  const client = useQueryClient();
  const scope = usePortalFormScope();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NoticeCommand | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [clearTarget, setClearTarget] = useState<NoticeOrigin | null>(null);
  const [clearError, setClearError] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const focusOrigin = useRef<NoticeOrigin | null>(null);
  const grants = portalGrantFingerprint(allSubjects);
  const routeOpen = path === "/learn/notifications";
  const visible = open || routeOpen;
  const listKey = ["portal-account", account?.id, "notifications", grants] as const;
  const badgeKey = ["portal-account", account?.id, "notifications-badge", grants] as const;
  useEffect(() => { setOpen(false); }, [navigationKey]);
  useEffect(() => {
    setOpen(false);
    setDeleteTarget(null);
    setClearTarget(null);
    setDeleteError("");
    setClearError("");
  }, [account?.id, grants]);
  const unread = useQuery({
    queryKey: badgeKey,
    queryFn: ({ signal }) => portalResourcesApi.notifications(signal),
    enabled: Boolean(account),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const query = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ signal, pageParam }) => portalResourcesApi.notifications(signal, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(account && visible),
    refetchInterval: visible ? 30_000 : false,
    refetchOnWindowFocus: true,
  });
  const captureOrigin = (): NoticeOrigin | null => account ? { accountId: account.id, grants } : null;
  const isCurrent = (origin: NoticeOrigin) => {
    const realm = getActivePlatformRealm();
    const session = client.getQueryData<PortalSessionDto>(portalSessionKey);
    return mounted.current && (realm === null || realm === "portal") &&
      session?.account?.id === origin.accountId && portalGrantFingerprint(session.subjects) === origin.grants;
  };
  const requireCurrent = (origin: NoticeOrigin) => {
    if (!isCurrent(origin)) throw new DOMException("", "AbortError");
  };
  const invalidate = (origin: NoticeOrigin) => client.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === "portal-account" && queryKey[1] === origin.accountId &&
      ["notifications", "notifications-badge", "day-notifications"].includes(String(queryKey[2])),
  });
  const snapshot = async (origin: NoticeOrigin) => {
    if (!isCurrent(origin)) return undefined;
    const originListKey = ["portal-account", origin.accountId, "notifications", origin.grants];
    const originBadgeKey = ["portal-account", origin.accountId, "notifications-badge", origin.grants];
    await Promise.all([
      client.cancelQueries({ queryKey: originListKey, exact: true }),
      client.cancelQueries({ queryKey: originBadgeKey, exact: true }),
    ]);
    return { pages: client.getQueryData<NoticePages>(originListKey), badge: client.getQueryData<PortalNotificationCollectionDto>(originBadgeKey) };
  };
  const updateRead = (id?: number) => {
    const now = new Date().toISOString();
    const current = client.getQueryData<NoticePages>(listKey);
    const selected = current?.pages.flatMap((page) => page.items).find((item) => item.id === id);
    const update = (item: PortalNotificationDto) => id === undefined || item.id === id ? { ...item, readAt: item.readAt ?? now } : item;
    const count = (value: number) => id === undefined ? 0 : Math.max(0, value - (selected && !selected.readAt ? 1 : 0));
    client.setQueryData<NoticePages>(listKey, (data) => data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(update), unreadCount: count(page.unreadCount) })) } : data);
    client.setQueryData<PortalNotificationCollectionDto>(badgeKey, (data) => data ? { ...data, items: data.items.map(update), unreadCount: count(data.unreadCount) } : data);
  };
  const restore = (previous: Awaited<ReturnType<typeof snapshot>> | undefined) => {
    if (previous?.pages) client.setQueryData(listKey, previous.pages);
    if (previous?.badge) client.setQueryData(badgeKey, previous.badge);
  };
  const read = useMutation({
    mutationFn: ({ origin, item }: NoticeCommand) => { requireCurrent(origin); return portalResourcesApi.readNotification(item.id); },
    onMutate: async ({ origin, item }) => {
      const previous = await snapshot(origin);
      if (isCurrent(origin)) updateRead(item.id);
      return previous;
    },
    onError: (error, command, previous) => {
      if (!isCurrent(command.origin)) return;
      restore(previous);
      toast({ title: t("updateFailed"), description: errorMessage(error, "portalSaveError"), variant: "destructive" });
    },
    onSettled: (_data, _error, command) => { if (isCurrent(command.origin)) void invalidate(command.origin); },
  });
  const readAll = useMutation({
    mutationFn: (origin: NoticeOrigin) => { requireCurrent(origin); return portalResourcesApi.readAll(); },
    onMutate: async (origin) => {
      const previous = await snapshot(origin);
      if (isCurrent(origin)) updateRead();
      return previous;
    },
    onError: (error, origin, previous) => {
      if (!isCurrent(origin)) return;
      restore(previous);
      toast({ title: t("updateFailed"), description: errorMessage(error, "portalSaveError"), variant: "destructive" });
    },
    onSettled: (_data, _error, origin) => { if (isCurrent(origin)) void invalidate(origin); },
  });
  const remove = useMutation({
    mutationFn: ({ origin, item }: NoticeCommand) => { requireCurrent(origin); return portalResourcesApi.removeNotification(item.id); },
    onSuccess: (_data, command) => {
      if (!isCurrent(command.origin)) return;
      setDeleteTarget(null);
      void invalidate(command.origin);
    },
    onError: (error, command) => { if (isCurrent(command.origin)) setDeleteError(errorMessage(error, "portalSaveError")); },
  });
  const clear = useMutation({
    mutationFn: (origin: NoticeOrigin) => { requireCurrent(origin); return portalResourcesApi.clearNotifications(); },
    onSuccess: async (_data, origin) => {
      if (!isCurrent(origin)) return;
      const originListKey = ["portal-account", origin.accountId, "notifications", origin.grants];
      await client.cancelQueries({ queryKey: originListKey, exact: true });
      if (!isCurrent(origin)) return;
      const empty: PortalNotificationCollectionDto = { items: [], nextCursor: null, hasMore: false, unreadCount: 0 };
      client.setQueryData<NoticePages>(listKey, { pageParams: [undefined], pages: [empty] });
      client.setQueryData(badgeKey, empty);
      setClearTarget(null);
      void invalidate(origin);
    },
    onError: (error, origin) => { if (isCurrent(origin)) setClearError(errorMessage(error, "portalSaveError")); },
  });
  const accessDenied = isPortalAccessError(query.error) || isPortalAccessError(unread.error);
  const items = accessDenied ? [] : query.data?.pages.flatMap((page) => page.items) ?? [];
  const destination = (item: PortalNotificationDto) => resolvePortalNotificationHref(item, allSubjects, learningModule ?? learningModuleForSubject(subject));
  const present = (item: PortalNotificationDto): NotificationsMenuViewItem => {
    const key = item.code as TranslationKey;
    let title = key in translations ? t(key) : t("portalNotifications");
    Object.entries(item.params).forEach(([name, value]) => { title = title.split(`{${name}}`).join(String(value)); });
    return { id: item.id, title, message: allSubjects.find((child) => child.linkId === item.linkId)?.studentName ?? null,
      isRead: Boolean(item.readAt), hasDestination: Boolean(destination(item)) };
  };
  const changeOpen = (next: boolean) => {
    if (next) setOpen(true);
    else scope.guarded(() => {
      setOpen(false);
      if (routeOpen) allowNavigation(() => navigate(`/learn${window.location.search}`, { replace: true }));
    });
  };
  return (
    <NotificationsMenuView
      open={visible}
      onOpenChange={changeOpen}
      triggerRef={triggerRef}
      onConfirmationCloseAutoFocus={(event) => {
        event.preventDefault();
        if (focusOrigin.current && isCurrent(focusOrigin.current))
          triggerRef.current?.focus({ preventScroll: true });
      }}
      items={items.map(present)}
      unreadCount={unread.data?.unreadCount ?? 0}
      unreadError={unread.isError}
      loading={query.isLoading}
      listError={query.isError}
      hasNextPage={Boolean(query.hasNextPage)}
      fetchingNextPage={query.isFetchingNextPage}
      readPending={read.isPending || readAll.isPending || accessDenied}
      readAllPending={readAll.isPending}
      onReadAll={() => { const origin = captureOrigin(); if (origin) readAll.mutate(origin); }}
      onItemSelect={(id) => {
        const item = items.find((entry) => entry.id === id);
        const origin = captureOrigin();
        if (!item || !origin) return;
        const href = destination(item);
        if (href) guarded(() => {
          if (!isCurrent(origin)) return;
          const child = subjects.find((entry) => entry.linkId === item.linkId);
          if (child) selectSubject(child.linkId);
          if (!item.readAt) read.mutate({ origin, item });
          setOpen(false);
          navigate(href);
        });
        else if (!item.readAt) read.mutate({ origin, item });
      }}
      onRetry={() => {
        if (query.isFetchNextPageError) void query.fetchNextPage(); else void query.refetch();
        if (unread.isError) void unread.refetch();
      }}
      onLoadMore={() => { void query.fetchNextPage(); }}
      remove={{
        target: deleteTarget ? present(deleteTarget.item) : null,
        pending: remove.isPending,
        error: deleteError,
        onTargetChange: (item) => {
          setDeleteError("");
          const origin = captureOrigin();
          const notice = items.find((entry) => entry.id === item?.id);
          if (origin && notice) focusOrigin.current = origin;
          setDeleteTarget(origin && notice ? { origin, item: notice } : null);
        },
        onConfirm: () => { if (deleteTarget) { setDeleteError(""); remove.mutate(deleteTarget); } },
      }}
      clear={{
        open: Boolean(clearTarget), pending: clear.isPending, error: clearError,
        onOpenChange: (next) => {
          setClearError("");
          const origin = next ? captureOrigin() : null;
          if (origin) focusOrigin.current = origin;
          setClearTarget(origin);
        },
        onConfirm: () => { if (clearTarget) { setClearError(""); clear.mutate(clearTarget); } },
      }}
    />
  );
}
