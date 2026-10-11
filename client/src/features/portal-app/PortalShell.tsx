import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  Home,
  MoreHorizontal,
  Bell,
  User,
  TrendingUp,
  FolderHeart,
  Wallet,
  MessageCircle,
  Menu,
  LogOut,
} from "lucide-react";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { portalIdentityApi } from "./api";
import { usePortal, portalSessionKey, portalGrantFingerprint } from "./context";
import { useQueryClient } from "@tanstack/react-query";
import { PortalSheetContent as SheetContent, usePortalError } from "./ui";
import { Badge } from "@/components/ui/badge";
import { PortalNotifications } from "./notifications";
import { portalResourcesApi } from "./resources-api";

type NavItem = {
  route: string;
  key: TranslationKey;
  icon: typeof Home;
  permission?: PortalPermission;
  permissions?: PortalPermission[];
};
const studentNav: NavItem[] = [
  {
    route: "/learn",
    key: "portalToday",
    icon: Home,
    permission: "learning.read",
  },
  {
    route: "/learn/courses",
    key: "portalCourses",
    icon: BookOpen,
    permission: "learning.read",
  },
  {
    route: "/learn/assignments",
    key: "portalAssignments",
    icon: CheckSquare,
    permission: "learning.read",
  },
  {
    route: "/learn/schedule",
    key: "portalSchedule",
    icon: CalendarDays,
    permissions: ["learning.read", "attendance.read"],
  },
  {
    route: "/learn/progress",
    key: "portalProgress",
    icon: TrendingUp,
    permissions: ["learning.read", "feedback.read"],
  },
  {
    route: "/learn/portfolio",
    key: "portalPortfolio",
    icon: FolderHeart,
    permissions: ["learning.read", "portfolio.approve"],
  },
  {
    route: "/learn/payments",
    key: "portalPayments",
    icon: Wallet,
    permission: "finance.read",
  },
  {
    route: "/learn/makeup",
    key: "portalMakeup",
    icon: BookOpen,
    permissions: ["learning.read", "attendance.read"],
  },
  {
    route: "/learn/attendance",
    key: "portalAttendance",
    icon: CalendarDays,
    permission: "attendance.read",
  },
  {
    route: "/learn/feedback",
    key: "portalFeedback",
    icon: MessageCircle,
    permission: "feedback.read",
  },
  {
    route: "/learn/help",
    key: "portalHelp",
    icon: MessageCircle,
    permission: "communication.create",
  },
  { route: "/learn/notifications", key: "portalNotifications", icon: Bell },
  { route: "/learn/profile", key: "portalProfile", icon: User },
];
export function PortalShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [path, navigate] = useLocation();
  const { subject, subjects, selectSubject, guarded, account } = usePortal();
  const client = useQueryClient();
  const errorMessage = usePortalError();
  const [menu, setMenu] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifications = useQuery({
    queryKey: [
      "portal-account",
      account?.id,
      "notifications-badge",
      portalGrantFingerprint(subjects),
    ],
    queryFn: ({ signal }) => portalResourcesApi.notifications(signal),
    enabled: Boolean(account),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const parent =
    subject?.kind === "representative" ||
    (!subject && subjects.some((item) => item.kind === "representative"));
  const visible = studentNav
    .filter(
      (item) =>
        !(
          parent &&
          ["/learn/courses", "/learn/assignments"].includes(item.route)
        ),
    )
    .filter(
      (item) =>
        (parent && item.route === "/learn") ||
        (!item.permission && !item.permissions) ||
        Boolean(
          item.permission &&
          (subject
            ? subject.permissions.includes(item.permission)
            : subjects.some((link) =>
                link.permissions.includes(item.permission!),
              )),
        ) ||
        Boolean(
          item.permissions?.some((permission) =>
            subject
              ? subject.permissions.includes(permission)
              : subjects.some((link) => link.permissions.includes(permission)),
          ),
        ),
    );
  const mobileRoutes = parent
    ? ["/learn", "/learn/schedule", "/learn/progress", "/learn/help"]
    : ["/learn", "/learn/courses", "/learn/assignments", "/learn/schedule"];
  const mobile = visible.filter((item) => mobileRoutes.includes(item.route));
  const logout = useMutation({
    mutationFn: portalIdentityApi.logout,
    onSuccess: () => {
      void client.cancelQueries({
        predicate: (query) => query.queryKey[0] !== portalSessionKey[0],
      });
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== portalSessionKey[0],
      });
      client.setQueryData(portalSessionKey, {
        account: null,
        subjects: [],
        csrfToken: "",
      });
      void client.invalidateQueries({ queryKey: portalSessionKey });
      navigate("/learn/login");
    },
  });
  const go = (route: string) =>
    guarded(() => {
      setMenu(false);
      navigate(route);
    });
  function navigation(items: NavItem[], bottom = false) {
    return items.map((item) => (
      <Button
        key={item.route}
        variant={
          path === item.route ||
          (item.route !== "/learn" && path.startsWith(`${item.route}/`))
            ? "secondary"
            : "ghost"
        }
        className={
          bottom
            ? "flex min-h-14 min-w-0 flex-1 flex-col gap-1 px-1 text-[11px]"
            : "min-h-11 justify-start gap-3"
        }
        aria-current={path === item.route ? "page" : undefined}
        onClick={() => go(item.route)}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>
          {t(
            item.route === "/learn" && parent
              ? "portalFamilyOverview"
              : item.route === "/learn/progress" && parent
                ? "portalResults"
                : item.key,
          )}
        </span>
      </Button>
    ));
  }
  return (
    <div className="portal-ui min-h-dvh bg-muted/20 text-base">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-background px-4 py-6 lg:flex lg:flex-col print:hidden">
        <div className="mb-8 px-3 text-xl font-semibold">
          {t("publicAttendanceBrand")}
        </div>
        <nav aria-label={t("portalTitle")} className="flex flex-col gap-1">
          {navigation(visible)}
        </nav>
        <Button
          variant="ghost"
          className="mt-auto min-h-11 justify-start gap-3"
          disabled={logout.isPending}
          onClick={() => guarded(() => logout.mutate())}
        >
          <LogOut className="h-5 w-5" />
          {t("portalSignOut")}
        </Button>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-8 print:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="hidden min-h-11 min-w-11 md:flex lg:hidden"
              aria-label={t("portalMore")}
              onClick={() => setMenu(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="min-h-11 max-w-[65vw] justify-start gap-2"
                >
                  {subject && (
                    <Avatar aria-hidden="true" className="h-8 w-8">
                      <AvatarFallback className="text-sm">
                        {subject.studentName
                          .trim()
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => Array.from(part)[0] ?? "")
                          .join("")
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <span className="min-w-0 truncate">
                    {subject?.studentName ?? t("portalFamily")}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-[60dvh] overflow-auto"
              >
                <DropdownMenuLabel>{t("portalMyLearning")}</DropdownMenuLabel>
                {subjects
                  .filter((item) => item.kind === "self")
                  .map((item) => (
                    <DropdownMenuItem
                      key={item.linkId}
                      className="min-h-11"
                      onSelect={() => selectSubject(item.linkId)}
                    >
                      {item.studentName}
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("portalChildren")}</DropdownMenuLabel>
                {subjects.filter((item) => item.kind === "representative")
                  .length > 1 && (
                  <DropdownMenuItem
                    className="min-h-11"
                    onSelect={() => selectSubject(null)}
                  >
                    {t("portalFamilyOverview")}
                  </DropdownMenuItem>
                )}
                {subjects
                  .filter((item) => item.kind === "representative")
                  .map((item) => (
                    <DropdownMenuItem
                      key={item.linkId}
                      className="min-h-11"
                      onSelect={() => selectSubject(item.linkId)}
                    >
                      {item.studentName}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="relative min-h-11 min-w-11"
              aria-label={t("portalNotifications")}
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell className="h-5 w-5" />
              {Boolean(notifications.data?.unreadCount) && (
                <Badge
                  className="absolute -right-1 -top-1 px-1"
                  aria-label={t("portalUnreadCount").replace(
                    "{count}",
                    String(notifications.data?.unreadCount),
                  )}
                >
                  {notifications.data?.unreadCount}
                </Badge>
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="min-h-11 min-w-11"
              aria-label={t("portalProfile")}
              onClick={() => go("/learn/profile")}
            >
              <User className="h-5 w-5" />
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 pb-28 md:px-8 lg:pb-8 print:px-0 print:pb-0">
          {logout.error && (
            <p role="alert" className="text-destructive">
              {errorMessage(logout.error)}
            </p>
          )}
          {children}
        </main>
      </div>
      <nav
        aria-label={t("portalTitle")}
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        {navigation(mobile, true)}
        <Button
          variant="ghost"
          className="flex min-h-14 min-w-0 flex-1 flex-col gap-1 px-1 text-[11px]"
          onClick={() => setMenu(true)}
        >
          <MoreHorizontal className="h-5 w-5" />
          {t("portalMore")}
        </Button>
      </nav>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent
          side="left"
          className="portal-ui flex w-[min(320px,85vw)] flex-col"
        >
          <SheetHeader>
            <SheetTitle>{t("portalTitle")}</SheetTitle>
          </SheetHeader>
          <nav className="mt-4 flex flex-col gap-1">{navigation(visible)}</nav>
          <p className="mt-auto text-sm text-muted-foreground">
            {account?.fullName}
          </p>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={logout.isPending}
            onClick={() => guarded(() => logout.mutate())}
          >
            {t("portalSignOut")}
          </Button>
        </SheetContent>
      </Sheet>
      <Sheet
        open={notificationsOpen}
        onOpenChange={(open) => {
          if (open) setNotificationsOpen(true);
          else guarded(() => setNotificationsOpen(false));
        }}
      >
        <SheetContent
          side="right"
          className="portal-ui flex w-full max-w-none flex-col overflow-y-auto sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>{t("portalNotifications")}</SheetTitle>
          </SheetHeader>
          {notificationsOpen && (
            <div className="space-y-4">
              <PortalNotifications
                embedded
                onNavigate={() => setNotificationsOpen(false)}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
