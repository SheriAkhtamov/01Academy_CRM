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
import Logo from "@/components/Logo";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ux/ThemeToggle";
import { ModulePage } from "@/components/ux/ModulePage";
import { UnreadCountBadge } from "@/components/ux/UnreadCountBadge";
import { cn } from "@/lib/utils";
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
  const contextLabel = (
    <>
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
    </>
  );
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
      navigate("/login");
    },
  });
  const go = (route: string) =>
    guarded(() => {
      setMenu(false);
      navigate(route);
    });
  function navigation(items: NavItem[], bottom = false) {
    return items.map((item) => {
      const active =
        path === item.route ||
        (item.route !== "/learn" && path.startsWith(`${item.route}/`));
      return (
        <button
          key={item.route}
          type="button"
          className={cn(
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            bottom
              ? "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors"
              : "sidebar-nav-item w-full text-left",
            active && (bottom ? "bg-primary/10 text-primary" : "active"),
            bottom && !active && "hover:bg-accent hover:text-accent-foreground",
          )}
          aria-current={active ? "page" : undefined}
          onClick={() => go(item.route)}
        >
          {active && !bottom && (
            <span
              className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-r from-primary-50 to-primary-100"
              aria-hidden="true"
            >
              <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-600 shadow-[0_0_10px_0_var(--primary-glow)]" />
            </span>
          )}
          <item.icon
            className={bottom ? "h-5 w-5 shrink-0" : "sidebar-nav-item__icon"}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">
            {t(
              item.route === "/learn" && parent
                ? "portalFamilyOverview"
                : item.route === "/learn/progress" && parent
                  ? "portalResults"
                  : item.key,
            )}
          </span>
          {active && !bottom && (
            <span
              className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600"
              aria-hidden="true"
            />
          )}
        </button>
      );
    });
  }
  return (
    <div className="portal-ui min-h-dvh text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/70 bg-card/95 backdrop-blur-sm lg:flex print:hidden">
        <div className="flex shrink-0 items-center border-b border-border/70 px-3 py-4">
          <Logo size="sm" className="shrink-0" />
          <div className="ml-2 flex min-w-0 flex-col gap-0.5">
            <span className="whitespace-nowrap text-base font-semibold leading-tight tracking-tight">
              {t("platformName")}
            </span>
            <span className="text-[11px] leading-tight text-muted-foreground">
              {t("portalTitle")}
            </span>
          </div>
        </div>
        <nav
          aria-label={t("portalTitle")}
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 py-4"
        >
          {navigation(visible)}
        </nav>
        <div className="shrink-0 border-t border-border/70 p-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground"
            disabled={logout.isPending}
            onClick={() => guarded(() => logout.mutate())}
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            {t("portalSignOut")}
          </Button>
        </div>
      </aside>
      <div className="min-w-0 lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/70 bg-background/85 px-3 py-2.5 backdrop-blur-xl sm:gap-3 sm:px-4 sm:py-3 lg:px-6 print:hidden">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="hidden min-h-11 min-w-11 rounded-full md:flex lg:hidden"
              aria-label={t("portalMore")}
              onClick={() => setMenu(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            {subjects.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 max-w-full justify-start gap-2 px-2 py-1.5"
                  >
                    {contextLabel}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="portal-ui max-h-[60dvh] overflow-auto"
                >
                  <DropdownMenuLabel>{t("portalMyLearning")}</DropdownMenuLabel>
                  {subjects
                    .filter((item) => item.kind === "self")
                    .map((item) => (
                      <DropdownMenuItem
                        key={item.linkId}
                        onSelect={() => selectSubject(item.linkId)}
                      >
                        {item.studentName}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t("portalChildren")}</DropdownMenuLabel>
                  {subjects.filter((item) => item.kind === "representative")
                    .length > 1 && (
                    <DropdownMenuItem onSelect={() => selectSubject(null)}>
                      {t("portalFamilyOverview")}
                    </DropdownMenuItem>
                  )}
                  {subjects
                    .filter((item) => item.kind === "representative")
                    .map((item) => (
                      <DropdownMenuItem
                        key={item.linkId}
                        onSelect={() => selectSubject(item.linkId)}
                      >
                        {item.studentName}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex min-h-10 min-w-0 items-center gap-2">
                {contextLabel}
              </div>
            )}
          </div>
          <div className="portal-header-actions flex shrink-0 items-center gap-1 sm:gap-1.5">
            <LanguageSwitcher className="rounded-full" />
            <ThemeToggle />
            <Button
              size="icon"
              variant="ghost"
              className="relative rounded-full"
              aria-label={t("portalNotifications")}
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell className="h-5 w-5" />
              <UnreadCountBadge
                count={notifications.data?.unreadCount ?? 0}
                className="pointer-events-none absolute -right-1.5 -top-2"
                label={t("portalUnreadCount").replace(
                  "{count}",
                  String(notifications.data?.unreadCount ?? 0),
                )}
              />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="rounded-full"
              aria-label={t("portalProfile")}
              onClick={() => go("/learn/profile")}
            >
              <User className="h-5 w-5" />
            </Button>
          </div>
        </header>
        <main>
          <ModulePage className="space-y-6 pb-28 sm:pb-28 md:pb-6 lg:pb-8 print:p-0">
            {logout.error && (
              <p role="alert" className="text-destructive">
                {errorMessage(logout.error)}
              </p>
            )}
            {children}
          </ModulePage>
        </main>
      </div>
      <nav
        aria-label={t("portalTitle")}
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border/70 bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden print:hidden"
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
          className="portal-ui flex w-[min(320px,85vw)] flex-col gap-0 bg-card p-0"
        >
          <SheetHeader className="shrink-0 border-b border-border/70 px-3 py-4 pr-12">
            <SheetTitle className="flex items-center gap-2 text-left text-base">
              <Logo size="sm" className="shrink-0" />
              <span>{t("portalTitle")}</span>
            </SheetTitle>
          </SheetHeader>
          <nav
            aria-label={t("portalTitle")}
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 py-4"
          >
            {navigation(visible)}
          </nav>
          <div className="shrink-0 space-y-3 border-t border-border/70 p-3">
            <p className="truncate px-3 text-sm font-medium">
              {account?.fullName}
            </p>
            <Button
              variant="ghost"
              className="min-h-11 w-full justify-start gap-3 text-muted-foreground"
              disabled={logout.isPending}
              onClick={() => guarded(() => logout.mutate())}
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
              {t("portalSignOut")}
            </Button>
          </div>
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
